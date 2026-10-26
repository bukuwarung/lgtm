// The local server's routes (app/bin/lgtm.mjs) as app commands: same CLIs, same inputs, same validation, same
// results. Keep the two in step when either changes.
use crate::cli::{last_line, parse_json, plain, run, SECONDS_30};
use crate::config;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap()
}
const PR_REF: &str = r"^[\w.-]+/[\w.-]+#\d+$"; // owner/repo#12
const LOGIN: &str = r"^[\w-]{1,39}$";
const SLACK_ID: &str = r"^U[A-Z0-9]{6,}$";
const EMAIL: &str = r"^[^\s@-][^\s@]*@[^\s@]+$";
// User ID, @handle or email: the forms slackcli resolves to a person. Also keeps flags out of the argument.
const SLACK_TARGET: &str = r"^(U[A-Z0-9]+|@[\w.-]+|[^\s@-][^\s@]*@[^\s@]+)$";

fn dry_run() -> bool {
    std::env::var("LGTM_SLACK_DRY_RUN").as_deref() == Ok("1")
}

// --- slackcli ---

struct Slack {
    ok: bool,
    stdout: String,
    error: String,
}

/// With --json, slackcli puts one JSON error object on the last stderr line: { "error": { "message", "hint" } }.
fn slack_error(stderr: &str) -> String {
    let last = last_line(stderr);
    match serde_json::from_str::<Value>(&last).ok().and_then(|v| v.get("error").cloned()) {
        Some(e) => {
            let msg = e["message"].as_str().unwrap_or("").to_string();
            match e["hint"].as_str() {
                Some(h) if !h.is_empty() => format!("{msg} ({h})"),
                _ => msg,
            }
        }
        None => last,
    }
}

fn slackcli(args: &[&str], input: Option<&str>) -> Slack {
    let o = run("slackcli", args, input, SECONDS_30);
    if o.missing {
        return Slack { ok: false, stdout: String::new(), error: "slackcli is not installed (brew install shaharia-lab/tap/slackcli)".into() };
    }
    let error = if o.ok { String::new() } else { slack_error(&o.stderr) };
    Slack { ok: o.ok, stdout: o.stdout, error }
}

// --- acli ---

fn acli(args: &[&str]) -> Result<String, String> {
    let o = run("acli", args, None, SECONDS_30);
    if o.missing {
        return Err("acli is not installed (brew install atlassian/homebrew-acli/acli)".into());
    }
    if !o.ok {
        let text = if o.stderr.trim().is_empty() { &o.stdout } else { &o.stderr };
        return Err(last_line(text).trim_start_matches("✗ Error: ").to_string());
    }
    Ok(o.stdout)
}

// Asked once per run: the workspace / site URLs only change with a new sign-in.
fn cached(cell: &'static OnceLock<Mutex<Option<String>>>, load: impl FnOnce() -> Option<String>) -> Option<String> {
    let m = cell.get_or_init(|| Mutex::new(None));
    let mut v = m.lock().unwrap();
    if v.is_none() {
        *v = load();
    }
    v.clone()
}
static SLACK_URL: OnceLock<Mutex<Option<String>>> = OnceLock::new(); // https://<workspace>.slack.com/
static JIRA_SITE: OnceLock<Mutex<Option<String>>> = OnceLock::new(); // https://<site>.atlassian.net

// --- integrations (Settings → Accounts) ---

#[tauri::command]
pub async fn integrations() -> Value {
    let slack = std::thread::spawn(|| {
        let r = slackcli(&["auth", "whoami"], None);
        let who = re(r"User:\s*(\S+)").captures(&plain(&r.stdout)).map(|c| c[1].to_string());
        json!({ "ok": r.ok, "error": if r.ok { Value::Null } else { r.error.into() }, "who": who })
    });
    let jira = match acli(&["jira", "auth", "status"]) {
        Ok(out) => json!({ "ok": true, "site": re(r"Site:\s*(\S+)").captures(&plain(&out)).map(|c| c[1].to_string()) }),
        Err(e) => json!({ "ok": false, "error": e }),
    };
    json!({ "slack": slack.join().unwrap_or(json!({ "ok": false })), "jira": jira })
}

// --- Jira ---

#[tauri::command]
pub async fn jira_issue(key: String) -> Result<Value, String> {
    if !re(r"^[A-Z][A-Z0-9]+-\d+$").is_match(&key) {
        return Err("Bad issue key".into());
    }
    let site = cached(&JIRA_SITE, || acli(&["jira", "auth", "status"]).ok().map(|out| format!("https://{}", re(r"Site:\s*(\S+)").captures(&plain(&out)).map(|c| c[1].to_string()).unwrap_or_default())))
        .unwrap_or_default();
    let out = acli(&["jira", "workitem", "view", &key, "--json", "--fields", "summary,status,issuetype,description"])?;
    let v: Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let f = &v["fields"];
    Ok(json!({
        "key": key, "url": format!("{site}/browse/{key}"), "summary": f["summary"], "status": f["status"]["name"],
        "statusCategory": f["status"]["statusCategory"]["key"], "type": f["issuetype"]["name"], "description": f["description"],
    }))
}

// --- CI job logs ---

/// The tail of a GitHub Actions job log: colours and timestamps dropped, ending at the last ##[error] (not the cleanup
/// after it), at most 60 lines.
pub fn log_tail(raw: &str) -> String {
    let plain = re(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)").replace_all(raw, "").replace('\r', "");
    let stamp = re(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ?");
    let lines: Vec<String> = plain.trim_end().split('\n').map(|l| stamp.replace(l, "").into_owned()).collect();
    let end = lines.iter().rposition(|l| l.starts_with("##[error]")).map(|i| i + 1).unwrap_or(lines.len());
    lines[end.saturating_sub(60)..end].join("\n")
}

#[tauri::command]
pub async fn job_log(repo: String, job: u64) -> Result<String, String> {
    if !re(r"^[\w.-]+/[\w.-]+$").is_match(&repo) {
        return Err("Bad job".into());
    }
    let path = format!("repos/{repo}/actions/jobs/{job}/logs");
    // Newer gh refuses to print escape sequences without --allow-escape-sequences; older gh doesn't know the flag.
    let mut o = run("gh", &["api", "--allow-escape-sequences", &path], None, SECONDS_30);
    if !o.ok && o.stderr.contains("unknown flag") {
        o = run("gh", &["api", &path], None, SECONDS_30);
    }
    if !o.ok {
        return Err(last_line(&o.stderr));
    }
    Ok(log_tail(&o.stdout))
}

// --- Slack: status, threads, messages ---

/// Links to this PR's Slack threads (one per person messaged), as permalinks on the workspace's own URL.
fn pr_threads(pr: &str) -> Vec<Value> {
    if !re(PR_REF).is_match(pr) {
        return vec![];
    }
    let threads = config::read("slack-threads.json", false).unwrap_or(json!({}));
    let prefix = format!("{pr}:");
    let mine: Vec<(String, Value)> = threads.as_object().map(|m| m.iter().filter(|(k, _)| k.starts_with(&prefix)).map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
    if mine.is_empty() {
        return vec![];
    }
    let Some(base) = cached(&SLACK_URL, || {
        let r = slackcli(&["team", "info", "--json"], None);
        if r.ok { parse_json(&r.stdout).and_then(|v| v["url"].as_str().map(String::from)) } else { None }
    }) else {
        return vec![];
    };
    mine.into_iter()
        .filter_map(|(k, t)| {
            let (channel, ts) = (t["channel"].as_str()?, t["ts"].as_str()?);
            Some(json!({ "login": &k[prefix.len()..], "url": format!("{base}archives/{channel}/p{}", ts.replace('.', "")) }))
        })
        .collect()
}

#[tauri::command]
pub async fn slack_status(pr: Option<String>) -> Value {
    let r = slackcli(&["auth", "whoami"], None);
    let threads = pr.map(|p| pr_threads(&p)).unwrap_or_default();
    json!({ "configured": r.ok, "error": if r.ok { Value::Null } else { r.error.into() }, "threads": threads })
}

#[derive(Deserialize)]
pub struct Recipient {
    login: String,
    emails: Vec<String>,
}

/// DM each recipient: the mapping first, then their GitHub emails. Each PR gets one thread per person; later reviews
/// reply in it (a fresh DM starts a new thread if the old one is gone).
#[tauri::command]
pub async fn slack_notify(recipients: Vec<Recipient>, text: String, thread: String) -> Result<Vec<Value>, String> {
    if recipients.len() > 10 || text.chars().count() > 4000 || !re(PR_REF).is_match(&thread) {
        return Err("Bad Slack request".into());
    }
    let users = config::read("config.json", true)?["slackUsers"].clone();
    let threads = Mutex::new(config::read("slack-threads.json", false).unwrap_or(json!({})));
    let dry = dry_run();
    let target = re(SLACK_TARGET);
    let send = |args: Vec<String>| {
        let mut all: Vec<&str> = vec!["messages", "send"];
        all.extend(args.iter().map(String::as_str));
        all.extend(["--message-file", "-", "--json"]);
        if dry {
            all.push("--dry-run");
        }
        slackcli(&all, Some(&text))
    };
    let thread = &thread;
    let results: Vec<Value> = std::thread::scope(|s| {
        let handles: Vec<_> = recipients
            .iter()
            .map(|r| {
                let (send, threads, users, target) = (&send, &threads, &users, &target);
                s.spawn(move || {
                    let key = format!("{thread}:{}", r.login);
                    let prev = threads.lock().unwrap()[&key].clone();
                    if let (Some(ch), Some(ts)) = (prev["channel"].as_str(), prev["ts"].as_str()) {
                        if re(r"^[CDG][A-Z0-9]+$").is_match(ch) && re(r"^\d+\.\d+$").is_match(ts) {
                            let out = send(vec![format!("--recipient-id={ch}"), format!("--thread-ts={ts}")]);
                            if out.ok {
                                return json!({ "login": r.login, "ok": true, "threaded": true });
                            }
                        }
                    }
                    let targets: Vec<String> = users[&r.login].as_str().map(String::from).into_iter().chain(r.emails.iter().cloned()).filter(|t| target.is_match(t)).collect();
                    if targets.is_empty() {
                        return json!({ "login": r.login, "ok": false, "error": format!("no Slack user known: map @{} in Settings → Slack people", r.login) });
                    }
                    let mut error = String::new();
                    for t in targets {
                        let out = send(vec![format!("--recipient-id={t}")]);
                        if out.ok {
                            if !dry {
                                if let Some(sent) = parse_json(&out.stdout) {
                                    threads.lock().unwrap()[&key] = json!({ "channel": sent["channel_id"], "ts": sent["ts"] });
                                }
                            }
                            return json!({ "login": r.login, "ok": true, "threaded": false });
                        }
                        error = out.error;
                    }
                    json!({ "login": r.login, "ok": false, "error": error })
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or(json!({ "ok": false, "error": "crashed" }))).collect()
    });
    if !dry {
        config::write("slack-threads.json", &threads.into_inner().unwrap())?;
    }
    Ok(results)
}

// --- Slack people (Settings) ---

fn people() -> Result<Value, String> {
    let c = config::read("config.json", true)?;
    Ok(json!({ "mine": if c["slackUsers"].is_object() { c["slackUsers"].clone() } else { json!({}) } }))
}

#[tauri::command]
pub async fn slack_people_get() -> Result<Value, String> {
    people()
}

#[derive(Deserialize)]
pub struct Person {
    login: String,
    name: Option<String>,
    emails: Vec<String>,
}

/// Best guesses for people without a mapping: an exact email match first, then their GitHub name, then their login's
/// first word, each only when Slack finds exactly one live person.
#[tauri::command]
pub async fn slack_people_find(people: Vec<Person>) -> Result<Vec<Value>, String> {
    if people.len() > 50 {
        return Err("Bad request".into());
    }
    let (login_re, email_re) = (re(LOGIN), re(EMAIL));
    let one = |u: &Value, via: &str| {
        let label = [&u["real_name"], &u["profile"]["real_name"], &u["name"]].iter().find_map(|v| v.as_str().filter(|s| !s.is_empty())).unwrap_or("").to_string();
        json!({ "id": u["id"], "label": label, "display": u["profile"]["display_name"].as_str().unwrap_or(""), "via": via })
    };
    let mut out = vec![];
    for p in people.iter().filter(|p| login_re.is_match(&p.login)) {
        let mut found: Option<Value> = None;
        for email in p.emails.iter().take(5).filter(|e| email_re.is_match(e)) {
            let r = slackcli(&["users", "info", email, "--json"], None);
            if let Some(u) = r.ok.then(|| parse_json(&r.stdout)).flatten() {
                if u["id"].is_string() && u["deleted"] != json!(true) {
                    found = Some(one(&u, "email"));
                    break;
                }
            }
        }
        let stem = p.login.split(['-', '_']).next().unwrap_or("").to_string();
        for (query, via) in [(p.name.clone().unwrap_or_default(), "name"), (stem, "username")] {
            if found.is_some() || query.trim().chars().count() < 3 || query.starts_with('-') {
                continue;
            }
            let q: String = query.chars().take(100).collect();
            let r = slackcli(&["search", "people", &q, "--json", "--limit", "5"], None);
            let live: Vec<Value> = if r.ok {
                parse_json(&r.stdout).and_then(|v| v["people"].as_array().cloned()).unwrap_or_default().into_iter().filter(|u| u["deleted"] != json!(true) && u["is_bot"] != json!(true)).collect()
            } else {
                vec![]
            };
            if live.len() == 1 {
                found = Some(one(&live[0], via));
            }
        }
        let mut row = json!({ "login": p.login });
        if let Some(Value::Object(m)) = found {
            row.as_object_mut().unwrap().extend(m);
        }
        out.push(row);
    }
    Ok(out)
}

/// Saves to the config; an empty ID removes the entry.
#[tauri::command]
pub async fn slack_people_save(map: HashMap<String, String>) -> Result<Value, String> {
    let (login_re, id_re) = (re(LOGIN), re(SLACK_ID));
    if map.is_empty() || map.len() > 100 || map.iter().any(|(l, id)| !login_re.is_match(l) || (!id.is_empty() && !id_re.is_match(id))) {
        return Err("Bad request".into());
    }
    let mut c = config::read("config.json", true)?;
    if !c.is_object() {
        c = json!({});
    }
    let mut mine: Map<String, Value> = c["slackUsers"].as_object().cloned().unwrap_or_default();
    for (l, id) in map {
        if id.is_empty() {
            mine.remove(&l);
        } else {
            mine.insert(l, Value::String(id));
        }
    }
    c["slackUsers"] = Value::Object(mine);
    config::write("config.json", &c)?;
    people()
}

// --- Claude Code sessions per PR (Settings → Claude Code) ---
// Same as the server's claudeSessions(): Claude desktop's record per Code session (desktop id, title, transcript id)
// plus the transcript's first prompt; a session belongs to the PRs linked in that prompt. Internal formats: if they
// change, this finds nothing rather than failing.

fn home() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default())
}

/// PR links and owner/repo#123 references in a text, as links.
pub fn prs_in(text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for c in re(r"https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)|\b([\w.-]+/[\w.-]+)#(\d+)\b").captures_iter(text) {
        let (repo, n) = (c.get(1).or(c.get(3)).unwrap().as_str(), c.get(2).or(c.get(4)).unwrap().as_str());
        let url = format!("https://github.com/{repo}/pull/{n}");
        if !out.contains(&url) {
            out.push(url);
        }
    }
    out
}

/// The first user message of a transcript (reading at most 4 MB to get there).
fn first_prompt(path: &std::path::Path) -> String {
    use std::io::Read;
    let Ok(f) = std::fs::File::open(path) else { return String::new() };
    let mut buf = Vec::new();
    let _ = f.take(4 << 20).read_to_end(&mut buf);
    for line in String::from_utf8_lossy(&buf).lines().filter(|l| l.contains("\"type\":\"user\"")) {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            let c = &v["message"]["content"];
            return match c {
                Value::String(s) => s.clone(),
                Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n"),
                _ => String::new(),
            };
        }
    }
    String::new()
}

#[tauri::command]
pub async fn claude_sessions() -> Vec<Value> {
    let root = home().join("Library/Application Support/Claude/claude-code-sessions");
    let projects: Vec<std::path::PathBuf> = std::fs::read_dir(home().join(".claude/projects")).map(|d| d.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    let mut records = vec![];
    let mut stack = vec![(root, 0)];
    while let Some((dir, depth)) = stack.pop() {
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() && depth < 3 {
                stack.push((p, depth + 1));
            } else if name.starts_with("local_") && name.ends_with(".json") {
                records.push(p);
            }
        }
    }
    let (id_re, cli_re) = (re(r"^local_[A-Za-z0-9-]{1,64}$"), re(r"^[\w-]+$"));
    let mut out: Vec<Value> = records
        .iter()
        .filter_map(|f| {
            let s: Value = serde_json::from_str(&std::fs::read_to_string(f).ok()?).ok()?;
            let (id, cli) = (s["sessionId"].as_str()?, s["cliSessionId"].as_str()?);
            if s["isArchived"] == json!(true) || !id_re.is_match(id) || !cli_re.is_match(cli) {
                return None;
            }
            let transcript = projects.iter().map(|d| d.join(format!("{cli}.jsonl"))).find(|t| t.exists())?;
            let prs = prs_in(&first_prompt(&transcript));
            let last = s["lastActivityAt"].as_str().and_then(|v| v.parse::<f64>().ok()).or(s["lastActivityAt"].as_f64()).unwrap_or(0.0);
            (!prs.is_empty()).then(|| json!({ "id": id, "title": s["title"].as_str().unwrap_or(""), "lastActivityAt": last, "prs": prs }))
        })
        .collect();
    out.sort_by(|a, b| b["lastActivityAt"].as_f64().partial_cmp(&a["lastActivityAt"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
    out
}

// --- A PR link on the clipboard (offered when the app comes to the front) ---
// Only the first GitHub PR link goes to the UI, never the rest of the clipboard.

pub fn pr_link(text: &str) -> Option<String> {
    re(r"https://github\.com/[\w.-]+/[\w.-]+/pull/\d+").find(text).map(|m| m.as_str().to_string())
}

#[tauri::command]
pub async fn clipboard_pr() -> Option<String> {
    let out = std::process::Command::new("/usr/bin/pbpaste").output().ok()?;
    pr_link(&String::from_utf8_lossy(&out.stdout[..out.stdout.len().min(1 << 16)]))
}

/// The PR walkthrough: the page's prompt through Claude Code's CLI, without tools or a saved session (as the server's
/// claudeText()).
#[tauri::command]
pub async fn walkthrough(input: String) -> Result<String, String> {
    if input.is_empty() || input.len() > 800_000 {
        return Err("Bad walkthrough request".into());
    }
    let args = ["-p", "--tools", "", "--no-session-persistence", "--output-format", "text"];
    let out = run("claude", &args, Some(&input), std::time::Duration::from_secs(300));
    if out.missing {
        return Err("Claude Code isn't installed (see claude.com/code), or not on the PATH".into());
    }
    if !out.ok {
        return Err(last_line(&plain(if out.stderr.trim().is_empty() { &out.stdout } else { &out.stderr })));
    }
    Ok(out.stdout.trim().to_string())
}

/// Settings → "Update now": Homebrew refreshes its taps and upgrades the cask, then lgtm restarts as the new version.
#[tauri::command]
pub async fn self_update(app: tauri::AppHandle) -> Result<(), String> {
    let installed = run("brew", &["list", "--cask", "lgtm"], None, SECONDS_30);
    if installed.missing {
        return Err("Homebrew isn't installed.".into());
    }
    if !installed.ok {
        return Err("This copy of lgtm wasn't installed with Homebrew: update it the way you installed it.".into());
    }
    let minutes = |m: u64| std::time::Duration::from_secs(60 * m);
    let update = run("brew", &["update", "--quiet"], None, minutes(5));
    if !update.ok {
        return Err(format!("brew update failed: {}", last_line(&plain(&update.stderr))));
    }
    let upgrade = run("brew", &["upgrade", "--cask", "lgtm"], None, minutes(10));
    if !upgrade.ok {
        return Err(format!("brew upgrade failed: {}", last_line(&plain(&upgrade.stderr))));
    }
    app.restart()
}

/// Text onto the clipboard (Help → Copy Diagnostics comes from the menu, without the click a web page needs).
#[tauri::command]
pub async fn copy_text(text: String) -> Result<(), String> {
    use std::io::Write;
    let mut child = std::process::Command::new("/usr/bin/pbcopy").stdin(std::process::Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("no stdin")?.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

// --- Settings export (Settings → Backup) ---

/// Saves the page's settings file to ~/Downloads as lgtm-settings-<date>.json (-2, -3… if taken). The app picks the
/// path, so the page can't write anywhere else; returns where it went.
#[tauri::command]
pub async fn export_settings(json: String, date: String) -> Result<String, String> {
    if json.len() > 20_000_000 || !re(r"^\d{4}-\d{2}-\d{2}$").is_match(&date) {
        return Err("Bad export".into());
    }
    match serde_json::from_str::<Value>(&json) {
        Ok(v) if v["lgtm"] == json!(1) => {}
        _ => return Err("Bad export".into()),
    }
    let dir = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = (1..100)
        .map(|n| dir.join(if n == 1 { format!("lgtm-settings-{date}.json") } else { format!("lgtm-settings-{date}-{n}.json") }))
        .find(|p| !p.exists())
        .ok_or("Too many exports today in Downloads")?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slack_error_reads_the_json_line() {
        assert_eq!(slack_error("- Sending…\n{\"error\":{\"message\":\"channel_not_found\",\"hint\":\"check the ID\"}}"), "channel_not_found (check the ID)");
        assert_eq!(slack_error("plain failure"), "plain failure");
    }

    #[test]
    fn log_tail_ends_at_the_last_error() {
        let raw = "2026-10-26T01:02:03.456Z \x1b[31mstep 1\x1b[0m\r\n2026-10-26T01:02:04Z ##[error]boom\n2026-10-26T01:02:05Z cleanup";
        assert_eq!(log_tail(raw), "step 1\n##[error]boom");
    }

    #[test]
    fn patterns_keep_flags_and_junk_out() {
        assert!(re(SLACK_TARGET).is_match("U012ABC") && re(SLACK_TARGET).is_match("@isfa") && re(SLACK_TARGET).is_match(&format!("{}@{}", "a", "b.co")));
        assert!(!re(SLACK_TARGET).is_match("--dry-run") && !re(SLACK_TARGET).is_match("-x@y"));
        assert!(re(PR_REF).is_match("bukuwarung/bukuwarung-edc-app#1725") && !re(PR_REF).is_match("a/b#1;rm"));
        assert!(re(LOGIN).is_match("isfa-buku") && !re(LOGIN).is_match("../etc"));
        assert!(re(SLACK_ID).is_match("U0ABCDEF12") && !re(SLACK_ID).is_match("C123456"));
    }

    #[test]
    fn export_refuses_odd_input() {
        use tauri::async_runtime::block_on;
        assert!(block_on(export_settings("{\"lgtm\":1}".into(), "today/evil".into())).is_err());
        assert!(block_on(export_settings("{\"other\":1}".into(), "2026-10-26".into())).is_err());
        assert!(block_on(export_settings("not json".into(), "2026-10-26".into())).is_err());
    }

    #[test]
    fn pr_link_takes_only_the_link() {
        assert_eq!(pr_link("see https://github.com/o/r/pull/12#discussion_r1 thanks").as_deref(), Some("https://github.com/o/r/pull/12"));
        assert_eq!(pr_link("https://github.com/o/r/issues/12"), None);
    }

    #[test]
    fn prs_in_finds_links_and_refs_once() {
        let t = "Look at https://github.com/o/r/pull/7 (o/r#7) and acme/app#12, not o/r#7x";
        assert_eq!(prs_in(t), vec!["https://github.com/o/r/pull/7", "https://github.com/acme/app/pull/12"]);
    }

    #[test]
    fn json_after_a_spinner_line() {
        assert_eq!(parse_json("- Searching…\n{\"people\":[]}").unwrap()["people"], json!([]));
        assert!(parse_json("").is_none());
    }
}
// Against the real CLIs and your sign-ins (read-only; Slack in dry-run): cargo test -- --ignored --nocapture
#[cfg(test)]
mod live {
    use super::*;
    use tauri::async_runtime::block_on;

    #[test]
    #[ignore]
    fn commands_against_real_clis() {
        std::env::set_var("LGTM_SLACK_DRY_RUN", "1");
        let ints = block_on(integrations());
        println!("integrations: slack ok={} jira ok={}", ints["slack"]["ok"], ints["jira"]["ok"]);
        assert_eq!(ints["slack"]["ok"], json!(true));
        let issue = block_on(jira_issue("BUKU-14650".into())).expect("jira");
        println!("jira: {} {} {}", issue["key"], issue["status"], issue["url"]);
        assert!(issue["summary"].is_string());
        let status = block_on(slack_status(Some("bukuwarung/bukuwarung-edc-app#1725".into())));
        println!("slack_status: configured={} threads={}", status["configured"], status["threads"].as_array().map(|a| a.len()).unwrap_or(0));
        assert_eq!(status["configured"], json!(true));
        let people = block_on(slack_people_get()).expect("people");
        println!("slack people mapped: {}", people["mine"].as_object().map(|m| m.len()).unwrap_or(0));
        let sent = block_on(slack_notify(vec![Recipient { login: "nobody-unmapped".into(), emails: vec![] }], "test".into(), "bukuwarung/lgtm#1".into())).expect("notify");
        println!("slack_notify (dry run, unmapped): {}", sent[0]["error"]);
        assert_eq!(sent[0]["ok"], json!(false));
        assert!(block_on(job_log("bad repo".into(), 1)).is_err());
    }
}
