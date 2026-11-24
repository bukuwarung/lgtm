// The local server's routes (app/bin/lgtm.mjs) as app commands: same CLIs, same inputs, same validation, same
// results. Keep the two in step when either changes.
use crate::cli::{last_line, parse_json, plain, run, run_env, SECONDS_30};
use crate::config;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap()
}
const PR_REF: &str = r"^[\w.:-]+(/[\w.-]+)+#\d+$"; // owner/repo#12, or a GitLab MR: host/group/…/project#12
// A GitHub login, or a GitLab person as login@host (so a GitLab name never reaches a GitHub person's Slack).
const LOGIN: &str = r"^([\w-]{1,39}|[A-Za-z0-9_.-]{1,255}@[A-Za-z0-9.:-]{1,253})$";
const MENTION: &str = r"<@gh:([A-Za-z0-9_.-]{1,255}@[A-Za-z0-9.:-]{1,253}|[A-Za-z0-9-]{1,39}|\*)>";
/// Where a PR's own page is, for finding it in Slack messages: github.com's, or the GitLab MR's.
fn pr_page(repo: &str, n: &str) -> String {
    if repo.split('/').next().is_some_and(|h| h.contains('.')) { format!("{repo}/-/merge_requests/{n}") } else { format!("github.com/{repo}/pull/{n}") }
}
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
static SLACK_PROFILES: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new(); // Slack user → { name, image }

/// The workspace's custom emoji, name → image (an alias → ":its-name:", for the page to look up); the server's slackEmoji().
#[tauri::command]
pub async fn slack_emoji() -> Value {
    let r = slackcli(&["emoji", "list", "--json"], None);
    let all = if r.ok { parse_json(&r.stdout).map(|v| v["emoji"].clone()).unwrap_or(Value::Null) } else { Value::Null };
    let mut out = Map::new();
    for e in all.as_array().into_iter().flatten() {
        let (Some(name), alias) = (e["name"].as_str(), e["alias_for"].as_str()) else { continue };
        let v = if e["is_alias"] == json!(true) { alias.map(|a| format!(":{a}:")) } else { e["url"].as_str().map(String::from) };
        if let Some(v) = v {
            out.insert(name.to_string(), json!(v));
        }
    }
    Value::Object(out)
}

/// A Slack user's name and picture (a user ID, @handle or email), looked up once a run.
fn slack_profile(user: &str) -> Option<Value> {
    if !re(SLACK_TARGET).is_match(user) {
        return None;
    }
    let cache = SLACK_PROFILES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(v) = cache.lock().unwrap().get(user) {
        return Some(v.clone());
    }
    let r = slackcli(&["users", "info", user, "--json"], None);
    let u = if r.ok { parse_json(&r.stdout)? } else { return None };
    let u = if u["user"].is_object() { &u["user"] } else { &u };
    let p = &u["profile"];
    let name = [&p["display_name"], &p["real_name"], &u["real_name"], &u["name"]].into_iter().find_map(|v| v.as_str().filter(|s| !s.is_empty()));
    let v = json!({ "id": u["id"], "name": name, "image": p["image_72"].as_str().or(p["image_48"].as_str()) });
    cache.lock().unwrap().insert(user.to_string(), v.clone());
    Some(v)
}
static JIRA_SITE: OnceLock<Mutex<Option<String>>> = OnceLock::new(); // https://<site>.atlassian.net

// --- integrations (Settings → Accounts) ---

#[tauri::command]
pub async fn integrations() -> Value {
    let slack = std::thread::spawn(|| {
        let r = slackcli(&["auth", "whoami", "--json"], None);
        let d = if r.ok { parse_json(&r.stdout).unwrap_or(Value::Null) } else { Value::Null };
        // canSchedule: Slack schedules messages for app sign-ins, not a browser's.
        let can = d["auth_type"].as_str().is_some_and(|t| t != "browser");
        json!({ "ok": r.ok, "error": if r.ok { Value::Null } else { r.error.into() }, "who": d["user"], "team": d["workspace_id"], "canSchedule": can })
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

/// gh's token for one of the accounts it's signed in to (Settings → Accounts picks it); empty, its active one.
pub fn gh_token_of(user: &str) -> Result<String, String> {
    let mut args = vec!["auth", "token"];
    if !user.is_empty() {
        if !re(r"^[A-Za-z0-9-]{1,39}$").is_match(user) {
            return Err("Bad account".into());
        }
        args.extend(["--user", user]);
    }
    let o = run("gh", &args, None, SECONDS_30);
    if o.missing {
        return Err("The GitHub CLI isn't installed.".into());
    }
    if !o.ok {
        return Err(if user.is_empty() { "The GitHub CLI isn't signed in.".into() } else { format!("The GitHub CLI isn't signed in as {user}.") });
    }
    Ok(o.stdout.trim().to_string())
}

/// The accounts gh is signed in to on github.com, and which is its active one. (gh exits non-zero when any account
/// has a problem, but still prints them all.)
#[tauri::command]
pub async fn gh_accounts() -> Result<Value, String> {
    let o = run("gh", &["auth", "status", "--json", "hosts"], None, SECONDS_30);
    let v: Value = serde_json::from_str(&o.stdout).unwrap_or(Value::Null);
    let all = v["hosts"]["github.com"].as_array().cloned().unwrap_or_default();
    Ok(json!(all.iter().filter(|a| a["state"] == "success").map(|a| json!({ "login": a["login"], "active": a["active"] == json!(true) })).collect::<Vec<_>>()))
}

/// The hosts glab is signed in to, from its config file (glab-cli/config.yml): each with its user and where its API is.
/// Read directly, as `glab auth status` checks every token online (seconds); a bad token shows on the first request.
pub fn glab_hosts(text: &str) -> Vec<Value> {
    let host_ok = re(r"^[A-Za-z0-9.-]+(:\d+)?$");
    let (mut in_hosts, mut host_indent, mut out): (bool, Option<usize>, Vec<[String; 4]>) = (false, None, vec![]);
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if indent == 0 {
            in_hosts = t == "hosts:";
            continue;
        }
        if !in_hosts {
            continue;
        }
        let Some((k, v)) = t.split_once(':') else { continue };
        let unq = |x: &str| x.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
        let (k, v) = (unq(k), unq(v));
        if *host_indent.get_or_insert(indent) == indent {
            out.push([k, String::new(), String::new(), String::new()]); // host, user, api_host, api_protocol
        } else if let Some(cur) = out.last_mut() {
            match k.as_str() { "user" => cur[1] = v, "api_host" => cur[2] = v, "api_protocol" => cur[3] = v, _ => {} }
        }
    }
    out.into_iter()
        .filter(|[h, u, _, _]| !u.is_empty() && host_ok.is_match(h))
        .map(|[h, u, api, proto]| {
            let api = if api.is_empty() { h.clone() } else { api };
            let proto = if proto.is_empty() { "https".to_string() } else { proto };
            json!({ "host": h, "login": u, "api": format!("{proto}://{api}") })
        })
        .collect()
}

#[tauri::command]
pub async fn glab_accounts() -> Result<Value, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs = [
        std::env::var("GLAB_CONFIG_DIR").ok(),
        std::env::var("XDG_CONFIG_HOME").ok().map(|x| format!("{x}/glab-cli")),
        Some(format!("{home}/Library/Application Support/glab-cli")),
        Some(format!("{home}/.config/glab-cli")),
    ];
    for d in dirs.into_iter().flatten() {
        if let Ok(text) = std::fs::read_to_string(format!("{d}/config.yml")) {
            return Ok(json!(glab_hosts(&text)));
        }
    }
    Ok(json!([]))
}

/// glab's token for a host, read on every call so `glab auth login` applies on reload. `refresh`: first a request
/// through glab, which renews an expired OAuth token (glab renews only when it makes a request itself).
#[tauri::command]
pub async fn glab_token(host: String, refresh: Option<bool>) -> Result<String, String> {
    if !re(r"^[A-Za-z0-9.-]+(:\d+)?$").is_match(&host) {
        return Err("Bad host".into());
    }
    if refresh.unwrap_or(false) {
        let _ = run("glab", &["api", "user", "--hostname", &host], None, SECONDS_30);
    }
    let o = run("glab", &["config", "get", "token", "--host", &host], None, SECONDS_30);
    if o.missing {
        return Err("The GitLab CLI (glab) isn't installed.".into());
    }
    let token = o.stdout.trim();
    if !o.ok || token.is_empty() {
        return Err(format!("glab isn't signed in to {host}. Run `glab auth login --hostname {host}`, then reload."));
    }
    Ok(token.to_string())
}

#[tauri::command]
pub async fn job_log(repo: String, job: u64, user: Option<String>) -> Result<String, String> {
    if !re(r"^[\w.-]+/[\w.-]+$").is_match(&repo) {
        return Err("Bad job".into());
    }
    let path = format!("repos/{repo}/actions/jobs/{job}/logs");
    // gh api as the account lgtm uses.
    let token = match user.as_deref().filter(|u| !u.is_empty()) {
        Some(u) => Some(gh_token_of(u)?),
        None => None,
    };
    let env: Vec<(&str, &str)> = token.as_deref().map(|t| ("GH_TOKEN", t)).into_iter().collect();
    // Newer gh refuses to print escape sequences without --allow-escape-sequences; older gh doesn't know the flag.
    let mut o = run_env("gh", &["api", "--allow-escape-sequences", &path], None, SECONDS_30, &env);
    if !o.ok && o.stderr.contains("unknown flag") {
        o = run_env("gh", &["api", &path], None, SECONDS_30, &env);
    }
    if !o.ok {
        return Err(last_line(&o.stderr));
    }
    Ok(log_tail(&o.stdout))
}

// --- Slack: status, threads, messages ---

/// A message's own links: its text, and the URLs its previews unfurl (not their text: a stacked PR's preview lists the
/// other layers).
fn own_links(m: &Value) -> String {
    let mut text = m["text"].as_str().unwrap_or("").to_string();
    for a in m["attachments"].as_array().into_iter().flatten() {
        for k in ["from_url", "original_url", "app_unfurl_url", "title_link"] {
            text += &format!(" {}", a[k].as_str().unwrap_or(""));
        }
    }
    text
}

/// DMs you've already had about this PR (its link in a direct message, newest first): each becomes your thread with that
/// person for it, when Slack people knows who they are on GitHub, so lgtm's messages to them reply there. Searched once
/// a run per PR; saved with the threads lgtm starts itself. The server's dmThreads().
fn dm_threads(pr: &str) -> Vec<(String, Value)> {
    let searched = DM_SEARCH.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(v) = searched.lock().unwrap().get(pr) {
        return v.clone();
    }
    let (repo, n) = pr.split_once('#').unwrap_or((pr, ""));
    let page = pr_page(repo, n);
    let link = re(&format!(r"{}(\D|$)", regex::escape(&page)));
    let r = slackcli(&["search", "messages", &page, "--json", "--limit", "40"], None);
    let users = config::read("config.json", true).map(|c| c["slackUsers"].clone()).unwrap_or(Value::Null);
    let login_of = |id: &str| users.as_object().and_then(|m| m.iter().find(|(_, v)| v.as_str() == Some(id)).map(|(l, _)| l.clone()));
    let threads = config::read("slack-threads.json", false).unwrap_or(json!({}));
    let mut found: Vec<(String, Value)> = vec![];
    let matches = if r.ok { parse_json(&r.stdout).and_then(|v| v["matches"].as_array().cloned()).unwrap_or_default() } else { vec![] };
    for m in &matches {
        if m["channel"]["is_im"] != json!(true) || !link.is_match(&own_links(m)) {
            continue;
        }
        let Some(other) = m["channel"]["name"].as_str() else { continue }; // a DM's name is the other person's user ID
        let Some(login) = login_of(other) else { continue };
        let key = format!("{pr}:{login}");
        if !threads[&key].is_null() || found.iter().any(|(k, _)| *k == key) {
            continue;
        }
        let root = m["permalink"].as_str().and_then(|p| re(r"thread_ts=([\d.]+)").captures(p).map(|c| c[1].to_string()));
        let ts = root.or_else(|| m["ts"].as_str().map(String::from)).unwrap_or_default();
        found.push((key, json!({ "channel": m["channel"]["id"], "ts": ts, "user": other })));
    }
    if !found.is_empty() && !dry_run() {
        let mut all = threads.clone();
        for (k, v) in &found {
            all[k] = v.clone();
        }
        let _ = config::write("slack-threads.json", &all);
    }
    searched.lock().unwrap().insert(pr.to_string(), found.clone());
    found
}
static DM_SEARCH: OnceLock<Mutex<HashMap<String, Vec<(String, Value)>>>> = OnceLock::new();

/// A ticket moved to another status (after its PR merges: the merge box), by the status's name as Jira shows it.
#[tauri::command]
pub async fn jira_move(key: String, status: String) -> Result<(), String> {
    let status = status.trim().to_string();
    if !re(r"^[A-Z][A-Z0-9]+-\d+$").is_match(&key) || status.is_empty() || status.chars().count() > 60 || status.contains(['\n', '\r']) || status.starts_with('-') {
        return Err("Bad request".into());
    }
    acli(&["jira", "workitem", "transition", "--key", &key, "--status", &status, "--yes"]).map(|_| ())
}

/// A project's statuses (Jira's names, and their category: new, indeterminate or done), for the after-merge pickers.
/// acli can't list them, so: a ticket in none of the ones found so far, again and again (each query finds one more),
/// the three categories side by side.
#[tauri::command]
pub async fn jira_statuses(project: String) -> Result<Vec<Value>, String> {
    if !re(r"^[A-Z][A-Z0-9]+$").is_match(&project) {
        return Err("Bad project".into());
    }
    let in_category = |cat: &str, key: &str| -> Result<Vec<Value>, String> {
        let mut found: Vec<String> = Vec::new();
        for _ in 0..25 {
            let not = if found.is_empty() { String::new() } else { format!(" AND status not in ({})", found.iter().map(|s| Value::from(s.as_str()).to_string()).collect::<Vec<_>>().join(", ")) };
            let jql = format!("project = {project} AND statusCategory = \"{cat}\"{not}");
            let out = acli(&["jira", "workitem", "search", "--jql", &jql, "--fields", "status", "--limit", "1", "--json"])?;
            match serde_json::from_str::<Value>(&out).ok().and_then(|v| v[0]["fields"]["status"]["name"].as_str().map(String::from)) {
                Some(name) => found.push(name),
                None => break,
            }
        }
        Ok(found.into_iter().map(|name| json!({ "name": name, "category": key })).collect())
    };
    std::thread::scope(|s| {
        let parts: Vec<_> = [("To Do", "new"), ("In Progress", "indeterminate"), ("Done", "done")].iter().map(|(c, k)| s.spawn(move || in_category(c, k))).collect();
        let mut all = Vec::new();
        for p in parts {
            all.extend(p.join().map_err(|_| "Couldn't list the statuses".to_string())??);
        }
        Ok(all)
    })
}

/// Links to this PR's Slack threads (one per person messaged), as permalinks on the workspace's own URL.
fn pr_threads(pr: &str) -> Vec<Value> {
    if !re(PR_REF).is_match(pr) {
        return vec![];
    }
    let mut threads = config::read("slack-threads.json", false).unwrap_or(json!({}));
    for (k, v) in dm_threads(pr) {
        if threads[&k].is_null() {
            threads[&k] = v;
        }
    }
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
    let users = config::read("config.json", true).map(|c| c["slackUsers"].clone()).unwrap_or(Value::Null);
    mine.into_iter()
        .filter_map(|(k, t)| {
            let (channel, ts) = (t["channel"].as_str()?, t["ts"].as_str()?);
            let login = &k[prefix.len()..];
            // Who it's with: as saved with the thread, else the Slack people mapping (threads from before it was saved).
            // "#qa": the QA request, in a channel: its name, no one's picture.
            let who = if login.starts_with('#') { Value::Null } else { t["user"].as_str().or(users[login].as_str()).and_then(slack_profile).unwrap_or(Value::Null) };
            let name = if who["name"].is_null() { t["name"].clone() } else { who["name"].clone() };
            // last: a message lgtm can take back (slack_delete)
            Some(json!({ "login": login, "url": format!("{base}archives/{channel}/p{}", ts.replace('.', "")), "name": name, "image": who["image"], "last": !t["last"].is_null() }))
        })
        .collect()
}

#[tauri::command]
pub async fn slack_status(pr: Option<String>) -> Value {
    let r = slackcli(&["auth", "whoami"], None);
    let threads = pr.map(|p| pr_threads(&p)).unwrap_or_default();
    json!({ "configured": r.ok, "error": if r.ok { Value::Null } else { r.error.into() }, "threads": threads })
}

/// The message's GitHub mentions as Slack ones: <@gh:login> (and <@gh:*>, the one it's for) becomes <@U…> for whoever
/// that is on Slack (the Slack people mapping, or for the recipient their email), else stays @login.
fn mentions(text: &str, r: &Recipient, users: &Value) -> String {
    if !text.contains("<@gh:") {
        return text.to_string();
    }
    re(MENTION)
        .replace_all(text, |c: &regex::Captures| {
            let login = if &c[1] == "*" { r.login.as_str() } else { &c[1] };
            let who = users[login].as_str().map(String::from).or_else(|| if login == r.login { r.emails.first().cloned() } else { None });
            let id = who.and_then(|w| if re(r"^U[A-Z0-9]+$").is_match(&w) { Some(w) } else { slack_profile(&w)?["id"].as_str().map(String::from) });
            id.map_or(format!("@{login}"), |id| format!("<@{id}>"))
        })
        .into_owned()
}

/// The PRs' Slack threads (slack-threads.json), for Settings → Backup: all of them, or a backup's merged in (its
/// entries replace ones with the same key).
#[tauri::command]
pub async fn slack_threads(merge: Option<HashMap<String, Value>>) -> Result<Value, String> {
    let mut threads = config::read("slack-threads.json", false).unwrap_or(json!({}));
    let Some(incoming) = merge else { return Ok(threads) };
    let (key, ch, ts) = (re(r"^[\w.:-]+(/[\w.-]+)+#\d+:(#qa|[\w-]{1,39}|[A-Za-z0-9_.-]{1,255}@[A-Za-z0-9.:-]{1,253})$"), re(r"^[CDG][A-Z0-9]+$"), re(r"^\d+\.\d+$"));
    let text = |v: &Value| v.is_null() || v.as_str().is_some_and(|s| s.chars().count() <= 200);
    if incoming.len() > 5000 || !incoming.iter().all(|(k, v)| key.is_match(k) && v["channel"].as_str().is_some_and(|c| ch.is_match(c)) && v["ts"].as_str().is_some_and(|t| ts.is_match(t)) && text(&v["user"]) && text(&v["name"])) {
        return Err("Bad request".into());
    }
    if !threads.is_object() {
        threads = json!({});
    }
    for (k, v) in incoming {
        let mut t = json!({ "channel": v["channel"], "ts": v["ts"] });
        for f in ["user", "name"] {
            if v[f].is_string() {
                t[f] = v[f].clone();
            }
        }
        threads[&k] = t;
    }
    config::write("slack-threads.json", &threads)?;
    Ok(threads)
}

/// A #name as its channel (Slack's channel search, exact name): slackcli's own lookup by name pages through every
/// channel, slower than its time limit. An ID or link as it is. Ok((id, name when known)).
fn channel_id(channel: &str) -> Result<(String, Option<String>), String> {
    let Some(name) = channel.strip_prefix('#') else { return Ok((channel.to_string(), None)) };
    let r = slackcli(&["search", "channels", name, "--json", "--limit", "20"], None);
    if !r.ok {
        return Err(r.error);
    }
    let all = parse_json(&r.stdout).and_then(|v| v["channels"].as_array().cloned()).unwrap_or_default();
    let named = |c: &Value| c["name"].as_str().unwrap_or("").to_string();
    if let Some(id) = all.iter().find(|c| named(c) == name).and_then(|c| c["id"].as_str().map(String::from)) {
        return Ok((id, Some(channel.to_string())));
    }
    // Not that name: the one it most likely meant (one starting with it, else one containing it), to offer.
    let near = all.iter().map(named).find(|n| n.starts_with(name)).or_else(|| all.iter().map(named).find(|n| n.contains(name)));
    Err(match near {
        Some(n) => format!("no channel named {channel} (did you mean #{n}?)"),
        None => format!("no channel named {channel}"),
    })
}

/// ✅ on the posts outside DMs where the PR's author linked it (their review request), once it's approved or merged
/// (Settings → Slack). author: a GitHub login matched on Slack; none: you. Not your QA request. Searched fresh each
/// time; back: where they were. The server's markDone().
#[tauri::command]
pub async fn slack_done(pr: String, author: Option<String>) -> Result<Value, String> {
    let mut done: Vec<String> = vec![];
    for m in request_posts(&pr, &author)? {
        let ch = format!("--channel-id={}", m["channel"]["id"].as_str().unwrap_or(""));
        let ts = format!("--timestamp={}", m["ts"].as_str().unwrap_or(""));
        let mut args = vec!["messages", "react", ch.as_str(), ts.as_str(), "--emoji", "white_check_mark", "--json"];
        if dry_run() {
            args.push("--dry-run");
        }
        let x = slackcli(&args, None);
        let at = posted_in(&m);
        if (x.ok || x.error.contains("already_reacted")) && !done.contains(&at) {
            done.push(at);
        }
    }
    Ok(json!({ "done": done }))
}

fn posted_in(m: &Value) -> String {
    if m["channel"]["is_mpim"] == json!(true) { "a group message".to_string() } else { format!("#{}", m["channel"]["name"].as_str().unwrap_or("")) }
}

/// The PR's review request (the latest of those slack_done finds): where it is, or with text, a reply in its thread.
/// The server's requestReply().
#[tauri::command]
pub async fn slack_request(pr: String, author: Option<String>, text: Option<String>, replies: Option<bool>) -> Result<Value, String> {
    if text.as_ref().is_some_and(|t| t.trim().is_empty() || t.chars().count() > 4000) {
        return Err("Bad Slack request".into());
    }
    let Some(m) = request_posts(&pr, &author)?.into_iter().next() else { return Ok(json!({ "where": null })) };
    // The thread it's in: its own, or, when the request is itself a reply, that one.
    let own_ts = m["ts"].as_str().unwrap_or("").to_string();
    let root = m["thread_ts"].as_str().map(String::from)
        .or_else(|| m["permalink"].as_str().and_then(|p| re(r"thread_ts=(\d+\.\d+)").captures(p).map(|c| c[1].to_string())))
        .unwrap_or_else(|| own_ts.clone());
    if let Some(t) = &text {
        let ch = format!("--recipient-id={}", m["channel"]["id"].as_str().unwrap_or(""));
        let ts = format!("--thread-ts={root}");
        let mut args = vec!["messages", "send", ch.as_str(), ts.as_str(), "--message-file", "-", "--json"];
        if dry_run() {
            args.push("--dry-run");
        }
        let users = config::read("config.json", true)?["slackUsers"].clone();
        let body = mentions(t, &Recipient { login: String::new(), emails: vec![], at: None }, &users); // <@gh:login> tags them
        let r = slackcli(&args, Some(&body));
        if !r.ok {
            return Err(r.error);
        }
    }
    if replies != Some(true) {
        return Ok(json!({ "where": posted_in(&m) }));
    }
    let ch = m["channel"]["id"].as_str().unwrap_or("");
    let r = slackcli(&["conversations", "read", ch, "--thread-ts", &root, "--json", "--limit", "200"], None);
    let said = if r.ok { parse_json(&r.stdout).and_then(|v| v["messages"].as_array().cloned()).unwrap_or_default() } else { vec![] };
    let at = |v: &Value| v.as_str().and_then(|t| t.parse::<f64>().ok()).unwrap_or(0.0);
    let mine = at(&m["ts"]);
    let others: Vec<&Value> = said.iter().filter(|x| at(&x["ts"]) > mine && x["user"] != m["user"]).map(|x| &x["ts"]).collect();
    Ok(json!({ "where": posted_in(&m), "url": m["permalink"], "replies": others }))
}

/// GitHub PRs someone asked you about on Slack in the last 7 days: a PR link in a DM to you, or beside a tag of you, from
/// someone else. One per PR, newest first. The server's slackAsked().
#[tauri::command]
pub async fn slack_asked(lab: Option<bool>) -> Value {
    let lab = lab == Some(true);
    let Some(me) = cached(&SLACK_ME, || {
        let r = slackcli(&["auth", "whoami", "--json"], None);
        parse_json(&r.stdout).and_then(|v| v["user_id"].as_str().map(String::from))
    })
    .filter(|m| re(r"^U[A-Z0-9]+$").is_match(m)) else { return json!([]) };
    let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0) - 7.0 * 86_400.0;
    let users = config::read("config.json", true).map(|c| c["slackUsers"].clone()).unwrap_or(Value::Null);
    let login_of = |id: &str| users.as_object().and_then(|o| o.iter().find(|(_, v)| v.as_str() == Some(id)).map(|(l, _)| l.clone()));
    let link = if lab { re(r"https://([\w.-]+)/([\w./-]+?)/-/merge_requests/(\d+)(\D|$)") } else { re(r"https://github\.com/([\w.-]+)/([\w.-]+)/pull/(\d+)(\D|$)") };
    let tag = format!("<@{me}>");
    let words = if lab { "merge_requests" } else { "github.com pull" };
    let mut out: Vec<Value> = vec![];
    for (q, dm) in [(format!("{words} to:me"), true), (format!("{words} {tag}"), false)] {
        let r = slackcli(&["search", "messages", &q, "--json", "--limit", "50"], None);
        let matches = if r.ok { parse_json(&r.stdout).and_then(|v| v["matches"].as_array().cloned()).unwrap_or_default() } else { vec![] };
        for m in &matches {
            let Some(user) = m["user"].as_str().filter(|u| *u != me) else { continue };
            if if dm { m["channel"]["is_im"] != json!(true) } else { !m["text"].as_str().unwrap_or("").contains(&tag) } {
                continue;
            }
            let ts = m["ts"].as_str().unwrap_or("").to_string();
            if ts.parse::<f64>().unwrap_or(0.0) < since {
                continue;
            }
            let thread = m["thread_ts"].as_str().map(String::from)
                .or_else(|| m["permalink"].as_str().and_then(|p| re(r"thread_ts=(\d+\.\d+)").captures(p).map(|c| c[1].to_string())))
                .unwrap_or_else(|| ts.clone());
            for c in link.captures_iter(&own_links(m)) {
                let pr = format!("{}/{}#{}", &c[1], &c[2], &c[3]);
                let ask = json!({ "pr": pr, "user": user, "url": m["permalink"], "ts": ts, "channel": m["channel"]["id"], "thread": thread });
                match out.iter_mut().find(|a| a["pr"] == json!(pr)) {
                    Some(a) if a["ts"].as_str().unwrap_or("") >= ts.as_str() => {}
                    Some(a) => *a = ask,
                    None => out.push(ask),
                }
            }
        }
    }
    out.sort_by(|a, b| b["ts"].as_str().cmp(&a["ts"].as_str()));
    out.truncate(20);
    for a in out.iter_mut() {
        let user = a["user"].as_str().unwrap_or("").to_string();
        let login = login_of(&user);
        a["name"] = if login.is_some() { Value::Null } else { slack_profile(&user).map(|p| p["name"].clone()).unwrap_or(Value::Null) };
        a["login"] = json!(login);
    }
    json!(out)
}

/// Who I sent this PR's link to in a DM (Settings → Slack, slackSent): their GitHub logins, newest first, with the
/// message. The server's slackSentTo().
#[tauri::command]
pub async fn slack_sent(pr: String) -> Result<Value, String> {
    if !re(PR_REF).is_match(&pr) {
        return Err("Bad Slack request".into());
    }
    let Some(me) = cached(&SLACK_ME, || {
        let r = slackcli(&["auth", "whoami", "--json"], None);
        parse_json(&r.stdout).and_then(|v| v["user_id"].as_str().map(String::from))
    })
    .filter(|m| re(r"^U[A-Z0-9]+$").is_match(m)) else { return Ok(json!([])) };
    let (repo, n) = pr.split_once('#').unwrap_or((&pr, ""));
    let page = pr_page(repo, n);
    let link = re(&format!(r"{}(\D|$)", regex::escape(&page)));
    let users = config::read("config.json", true).map(|c| c["slackUsers"].clone()).unwrap_or(Value::Null);
    let r = slackcli(&["search", "messages", &page, "--json", "--limit", "40"], None);
    let matches = if r.ok { parse_json(&r.stdout).and_then(|v| v["matches"].as_array().cloned()).unwrap_or_default() } else { vec![] };
    let mut out: Vec<Value> = vec![];
    for m in &matches {
        if m["channel"]["is_im"] != json!(true) || m["user"].as_str() != Some(me.as_str()) || !link.is_match(&own_links(m)) {
            continue;
        }
        let them = m["channel"]["name"].as_str().unwrap_or(""); // a DM's name is the other person's user ID
        let login = users.as_object().and_then(|o| o.iter().find(|(_, v)| v.as_str() == Some(them)).map(|(l, _)| l.clone()));
        if let Some(l) = login.filter(|l| !out.iter().any(|o| o["login"] == json!(l))) {
            out.push(json!({ "login": l, "url": m["permalink"] }));
        }
    }
    Ok(json!(out))
}

/// A reply in a thread (where you were asked: Settings → Slack). The server's slackReply().
#[tauri::command]
pub async fn slack_reply(channel: String, thread: String, text: String) -> Result<Value, String> {
    if !re(r"^[CDG][A-Z0-9]+$").is_match(&channel) || !re(r"^\d+\.\d+$").is_match(&thread) || text.trim().is_empty() || text.chars().count() > 4000 {
        return Err("Bad Slack request".into());
    }
    let users = config::read("config.json", true)?["slackUsers"].clone();
    let body = mentions(&text, &Recipient { login: String::new(), emails: vec![], at: None }, &users);
    let (ch, ts) = (format!("--recipient-id={channel}"), format!("--thread-ts={thread}"));
    let mut args = vec!["messages", "send", ch.as_str(), ts.as_str(), "--message-file", "-", "--json"];
    if dry_run() {
        args.push("--dry-run");
    }
    let r = slackcli(&args, Some(&body));
    if !r.ok {
        return Err(r.error);
    }
    Ok(json!({ "ok": true }))
}

fn request_posts(pr: &str, author: &Option<String>) -> Result<Vec<Value>, String> {
    if !re(PR_REF).is_match(pr) || author.as_ref().is_some_and(|a| a.len() > 100) {
        return Err("Bad Slack request".into());
    }
    let by = match &author {
        Some(a) => config::read("config.json", true).ok().and_then(|c| c["slackUsers"][a.as_str()].as_str().map(String::from)),
        None => cached(&SLACK_ME, || {
            let r = slackcli(&["auth", "whoami", "--json"], None);
            parse_json(&r.stdout).and_then(|v| v["user_id"].as_str().map(String::from))
        }),
    };
    let Some(by) = by.filter(|b| re(r"^U[A-Z0-9]+$").is_match(b)) else { return Ok(vec![]) };
    let (repo, n) = pr.split_once('#').unwrap_or((pr, ""));
    let page = pr_page(repo, n);
    let link = re(&format!(r"{}(\D|$)", regex::escape(&page)));
    let qa = config::read("slack-threads.json", false).ok().and_then(|t| t[&format!("{pr}:#qa")]["ts"].as_str().map(String::from));
    let r = slackcli(&["search", "messages", &page, "--json", "--limit", "40"], None);
    let matches = if r.ok { parse_json(&r.stdout).and_then(|v| v["matches"].as_array().cloned()).unwrap_or_default() } else { vec![] };
    Ok(matches.into_iter().filter(|m| m["channel"].is_object() && m["channel"]["is_im"] != json!(true) && m["user"].as_str() == Some(&by) && m["ts"].as_str() != qa.as_deref() && link.is_match(&own_links(m))).take(3).collect())
}

/// A message in a channel (the QA request, Settings → Slack): its ID, #name or link. Back: its permalink.
#[tauri::command]
pub async fn slack_post(channel: String, text: String, pr: String, kind: Option<String>) -> Result<Value, String> {
    if !re(r"^([CG][A-Z0-9]+|#[\w.-]+|https://[\w-]+\.slack\.com/archives/[CG][A-Z0-9]+/?)$").is_match(&channel) || text.trim().is_empty() || text.chars().count() > 4000 || !re(PR_REF).is_match(&pr) {
        return Err("Bad Slack request".into());
    }
    let (id, name) = channel_id(&channel)?;
    let users = config::read("config.json", true)?["slackUsers"].clone();
    let body = mentions(&text, &Recipient { login: String::new(), emails: vec![], at: None }, &users);
    let recipient = format!("--recipient-id={id}");
    let mut args = vec!["messages", "send", recipient.as_str(), "--message-file", "-", "--json"];
    if dry_run() {
        args.push("--dry-run");
    }
    let r = slackcli(&args, Some(&body));
    if !r.ok {
        return Err(r.error);
    }
    if dry_run() {
        return Ok(json!({ "url": null, "dryRun": r.stdout.trim() }));
    }
    let sent = parse_json(&r.stdout).unwrap_or(Value::Null);
    // Kept with the PR's DM threads (slack-threads.json, as "<pr>:#qa": no GitHub login has a #), shown beside its title.
    if let (Some(ch), Some(ts), false) = (sent["channel_id"].as_str(), sent["ts"].as_str(), kind.as_deref() == Some("review")) {
        let mut threads = config::read("slack-threads.json", false).unwrap_or(json!({}));
        threads[&format!("{pr}:#qa")] = json!({ "channel": ch, "ts": ts, "name": name.unwrap_or(channel.clone()) });
        config::write("slack-threads.json", &threads)?;
    }
    let base = cached(&SLACK_URL, || {
        let r = slackcli(&["team", "info", "--json"], None);
        if r.ok { parse_json(&r.stdout).and_then(|v| v["url"].as_str().map(String::from)) } else { None }
    });
    let url = match (base, sent["channel_id"].as_str(), sent["ts"].as_str()) {
        (Some(b), Some(ch), Some(ts)) => json!(format!("{b}archives/{ch}/p{}", ts.replace('.', ""))),
        _ => Value::Null,
    };
    Ok(json!({ "url": url }))
}

/// The QA requests' replies, per PR asked ("owner/repo#n", ones with a request): the times of replies from others, and
/// the latest that signs it off ("signed off", "sign-off", "signoff"…) or raises an issue ("bug", "error", "crash"),
/// which says so; a reply's forwarded message counts as its text. Read from Slack each time.
#[tauri::command]
pub async fn slack_qa(prs: Vec<String>) -> Value {
    let threads = config::read("slack-threads.json", false).unwrap_or(json!({}));
    let me = cached(&SLACK_ME, || {
        let r = slackcli(&["auth", "whoami", "--json"], None);
        parse_json(&r.stdout).and_then(|v| v["user_id"].as_str().map(String::from))
    });
    let (signed, issue) = (re(r"(?i)\bsign(?:ed)?[\s-]?off\b"), re(r"(?i)\b(bugs?|errors?|crash(?:es|ed|ing)?)\b"));
    let mut out = json!({});
    for pr in prs.iter().take(100).filter(|p| re(PR_REF).is_match(p)) {
        let t = &threads[&format!("{pr}:#qa")];
        let (Some(ch), Some(ts)) = (t["channel"].as_str(), t["ts"].as_str()) else { continue };
        if !re(r"^[CG][A-Z0-9]+$").is_match(ch) || !re(r"^\d+\.\d+$").is_match(ts) {
            continue;
        }
        let r = slackcli(&["conversations", "read", ch, "--thread-ts", ts, "--json", "--limit", "200"], None);
        if !r.ok {
            continue;
        }
        let msgs = parse_json(&r.stdout).and_then(|v| v["messages"].as_array().cloned()).unwrap_or_default();
        let replies: Vec<&Value> = msgs.iter().filter(|m| m["ts"].as_str() != Some(ts) && m["user"].as_str() != me.as_deref()).collect();
        let said = |m: &Value| {
            let mut s = m["text"].as_str().unwrap_or("").to_string();
            for a in m["attachments"].as_array().into_iter().flatten() {
                s.push('\n');
                s.push_str(a["fallback"].as_str().or(a["text"].as_str()).unwrap_or(""));
            }
            s
        };
        let last = replies.iter().rev().map(|m| said(m)).find(|s| signed.is_match(s) || issue.is_match(s));
        let status = last.map(|s| if signed.is_match(&s) { "signed" } else { "issue" });
        out[pr.as_str()] = json!({ "replies": replies.iter().map(|m| m["ts"].clone()).collect::<Vec<_>>(), "status": status });
    }
    out
}

/// Does the channel exist (Settings → Slack → QA channel)? A dry run of a message names it; an ID it can't name is read
/// (one message) to tell. Nothing is sent.
#[tauri::command]
pub async fn slack_channel(channel: String) -> Value {
    if !re(r"^([CG][A-Z0-9]+|#[\w.-]+|https://[\w-]+\.slack\.com/archives/[CG][A-Z0-9]+/?)$").is_match(&channel) {
        return json!({ "ok": false, "error": "not a channel ID, #name or link" });
    }
    let channel = match channel_id(&channel) {
        Ok((id, Some(name))) => return json!({ "ok": true, "name": name, "id": id }),
        Ok((id, None)) => id,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let recipient = format!("--recipient-id={channel}");
    let r = slackcli(&["messages", "send", recipient.as_str(), "--message-file", "-", "--json", "--dry-run"], Some("."));
    if !r.ok {
        return json!({ "ok": false, "error": r.error });
    }
    let target = parse_json(&r.stdout).map(|v| v["target"].clone()).unwrap_or(Value::Null);
    if let Some(name) = target["name"].as_str() {
        return json!({ "ok": true, "name": name, "id": target["id"] });
    }
    let id = target["id"].as_str().unwrap_or(&channel).to_string();
    let read = slackcli(&["conversations", "read", &id, "--limit", "1", "--json", "--fields", "ts"], None);
    if read.ok { json!({ "ok": true, "id": id }) } else { json!({ "ok": false, "error": read.error }) }
}

#[derive(Deserialize)]
pub struct Recipient {
    login: String,
    emails: Vec<String>,
    #[serde(default)]
    at: Option<i64>, // Slack posts it then (Unix seconds), lgtm needn't be running; its thread is known once it's posted
}

/// DM each recipient: the mapping first, then their GitHub emails. Each PR gets one thread per person; later reviews
/// reply in it (a fresh DM starts a new thread if the old one is gone). `check`: a dry run that sends nothing, so the
/// submit panel can tell before you submit whether each recipient can be reached.
#[tauri::command]
pub async fn slack_notify(recipients: Vec<Recipient>, text: String, thread: String, check: Option<bool>) -> Result<Vec<Value>, String> {
    if recipients.len() > 10 || text.chars().count() > 4000 || !re(PR_REF).is_match(&thread) {
        return Err("Bad Slack request".into());
    }
    let users = config::read("config.json", true)?["slackUsers"].clone();
    let threads = Mutex::new(config::read("slack-threads.json", false).unwrap_or(json!({})));
    let dry = dry_run() || check == Some(true);
    let target = re(SLACK_TARGET);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    if recipients.iter().any(|r| r.at.is_some_and(|at| at <= now || at >= now + 120 * 86400)) {
        return Err("Bad Slack request".into());
    }
    let send = |args: Vec<String>, text: &str, at: Option<i64>| {
        let at = at.map(|a| a.to_string());
        let mut all: Vec<&str> = vec!["messages", if at.is_some() { "schedule" } else { "send" }];
        all.extend(args.iter().map(String::as_str));
        if let Some(a) = &at {
            all.extend(["--at", a]);
        }
        all.extend(["--message-file", "-", "--json"]);
        if dry {
            all.push("--dry-run");
        }
        slackcli(&all, Some(text))
    };
    let text = &text;
    let thread = &thread;
    let results: Vec<Value> = std::thread::scope(|s| {
        let handles: Vec<_> = recipients
            .iter()
            .map(|r| {
                let (send, threads, users, target) = (&send, &threads, &users, &target);
                s.spawn(move || {
                    let text = &mentions(text, r, users);
                    let key = format!("{thread}:{}", r.login);
                    let prev = threads.lock().unwrap()[&key].clone();
                    if let (Some(ch), Some(ts)) = (prev["channel"].as_str(), prev["ts"].as_str()) {
                        if re(r"^[CDG][A-Z0-9]+$").is_match(ch) && re(r"^\d+\.\d+$").is_match(ts) {
                            let out = send(vec![format!("--recipient-id={ch}"), format!("--thread-ts={ts}")], text, r.at);
                            if out.ok {
                                let sent = if dry { Value::Null } else { sent_of(&out.stdout, r.at) };
                                if !sent["ts"].is_null() {
                                    threads.lock().unwrap()[&key]["last"] = json!({ "channel": sent["channel"], "ts": sent["ts"] }); // to take back
                                }
                                return json!({ "login": r.login, "ok": true, "threaded": true, "at": r.at, "sent": sent });
                            }
                        }
                    }
                    let targets: Vec<String> = users[&r.login].as_str().map(String::from).into_iter().chain(r.emails.iter().cloned()).filter(|t| target.is_match(t)).collect();
                    if targets.is_empty() {
                        return json!({ "login": r.login, "ok": false, "error": format!("no Slack user known: map @{} in Settings → Slack people", r.login) });
                    }
                    let mut error = String::new();
                    for t in targets {
                        let out = send(vec![format!("--recipient-id={t}")], text, r.at);
                        if out.ok {
                            let sent = if dry { Value::Null } else { sent_of(&out.stdout, r.at) };
                            if !sent["ts"].is_null() {
                                // Who it's with too, for their name and picture on the PR (pr_threads).
                                threads.lock().unwrap()[&key] = json!({ "channel": sent["channel"], "ts": sent["ts"], "user": t, "last": { "channel": sent["channel"], "ts": sent["ts"] } });
                            }
                            return json!({ "login": r.login, "ok": true, "threaded": false, "at": r.at, "sent": sent });
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

/// What a send put in Slack (slackcli --json): a message (channel, ts), or scheduled, its id until it's posted.
fn sent_of(stdout: &str, at: Option<i64>) -> Value {
    let Some(d) = parse_json(stdout) else { return Value::Null };
    let Some(ch) = d["channel_id"].as_str() else { return Value::Null };
    match (at, d["scheduled_message_id"].as_str(), d["ts"].as_str()) {
        (Some(_), Some(id), _) => json!({ "channel": ch, "scheduled": id }),
        (None, _, Some(ts)) => json!({ "channel": ch, "ts": ts }),
        _ => Value::Null,
    }
}

/// Take back the message lgtm last sent someone about a PR (a review ask undone or withdrawn): `sent` as slack_notify
/// gave it, else the last one kept with their thread. One that started the thread takes the thread with it. The
/// server's slackDelete().
#[tauri::command]
pub async fn slack_delete(pr: String, login: String, sent: Option<Value>) -> Result<Value, String> {
    if !re(PR_REF).is_match(&pr) || !re(r"^[\w.-]{1,100}$").is_match(&login) {
        return Err("Bad Slack request".into());
    }
    let mut threads = config::read("slack-threads.json", false).unwrap_or(json!({}));
    let key = format!("{pr}:{login}");
    let msg = sent.filter(|v| !v.is_null()).unwrap_or_else(|| threads[&key]["last"].clone());
    if msg.is_null() {
        return Ok(json!({ "ok": false, "error": "no message from lgtm to take back" }));
    }
    let ch = msg["channel"].as_str().unwrap_or("");
    if !re(r"^[CDG][A-Z0-9]+$").is_match(ch) {
        return Err("Bad Slack request".into());
    }
    let dry = dry_run();
    let out = if let Some(id) = msg["scheduled"].as_str() {
        if !re(r"^Q[A-Z0-9]+$").is_match(id) {
            return Err("Bad Slack request".into());
        }
        let mut args = vec!["messages", "delete-scheduled", id, "--yes", "--json"];
        if dry {
            args.push("--dry-run");
        }
        slackcli(&args, None)
    } else {
        let ts = msg["ts"].as_str().unwrap_or("");
        if !re(r"^\d+\.\d+$").is_match(ts) {
            return Err("Bad Slack request".into());
        }
        let (c, t) = (format!("--channel-id={ch}"), format!("--timestamp={ts}"));
        let mut args = vec!["messages", "delete", c.as_str(), t.as_str(), "--yes", "--json"];
        if dry {
            args.push("--dry-run");
        }
        let out = slackcli(&args, None);
        if !out.ok {
            // Some workspaces don't let people delete their messages; while it can still be edited, it's emptied to "-".
            let mut args = vec!["messages", "edit", c.as_str(), t.as_str(), "--message", "-", "--json"];
            if dry {
                args.push("--dry-run");
            }
            let e = slackcli(&args, None);
            if !e.ok {
                // Neither: a reply under it (in its thread) saying the ask is off.
                let root = match (threads[&key]["ts"].as_str(), threads[&key]["channel"].as_str()) {
                    (Some(r), Some(c)) if c == ch && re(r"^\d+\.\d+$").is_match(r) => r.to_string(),
                    _ => ts.to_string(),
                };
                let (rc, rt) = (format!("--recipient-id={ch}"), format!("--thread-ts={root}"));
                let mut args = vec!["messages", "send", rc.as_str(), rt.as_str(), "--message-file", "-", "--json"];
                if dry {
                    args.push("--dry-run");
                }
                let f = slackcli(&args, Some("No need to review this anymore, sorry for the noise."));
                if !f.ok {
                    return Ok(json!({ "ok": false, "error": format!("Slack lets lgtm neither delete it ({}) nor edit it ({}), and replying failed too ({}): delete it in Slack yourself", out.error, e.error, f.error) }));
                }
                if !dry && threads[&key]["last"]["ts"] == msg["ts"] {
                    threads[&key].as_object_mut().map(|m| m.remove("last"));
                    config::write("slack-threads.json", &threads)?;
                }
                return Ok(json!({ "ok": true, "followedUp": true }));
            }
            if !dry && threads[&key]["last"]["ts"] == msg["ts"] {
                threads[&key].as_object_mut().map(|m| m.remove("last"));
                config::write("slack-threads.json", &threads)?;
            }
            return Ok(json!({ "ok": true, "edited": true }));
        }
        out
    };
    if !out.ok {
        return Ok(json!({ "ok": false, "error": out.error }));
    }
    if !dry && msg["scheduled"].is_null() && threads[&key].is_object() {
        if threads[&key]["ts"] == msg["ts"] {
            threads.as_object_mut().map(|m| m.remove(&key));
        } else if threads[&key]["last"]["ts"] == msg["ts"] {
            threads[&key].as_object_mut().map(|m| m.remove("last"));
        }
        config::write("slack-threads.json", &threads)?;
    }
    Ok(json!({ "ok": true }))
}

// --- Slack people (Settings) ---

fn people() -> Result<Value, String> {
    let c = config::read("config.json", true)?;
    Ok(json!({ "mine": if c["slackUsers"].is_object() { c["slackUsers"].clone() } else { json!({}) } }))
}

/// Slack statuses ("🌴 Vacation", "Out sick") of GitHub people, through their Slack mapping, for picking a reviewer.
/// Asked fresh each time: statuses change during the day.
#[tauri::command]
pub async fn slack_presence(logins: Vec<String>) -> Result<Value, String> {
    let users = config::read("config.json", true).map(|c| c["slackUsers"].clone()).unwrap_or(Value::Null);
    let asks: Vec<(String, String)> = logins
        .into_iter()
        .take(20)
        .filter_map(|l| users[&l].as_str().filter(|id| re(r"^U[A-Z0-9]{6,}$").is_match(id)).map(|id| (l.clone(), id.to_string())))
        .collect();
    let found: Vec<(String, Value)> = std::thread::scope(|s| {
        let runs: Vec<_> = asks
            .iter()
            .map(|(l, id)| {
                s.spawn(move || {
                    let r = slackcli(&["users", "info", id, "--json"], None);
                    let u = if r.ok { parse_json(&r.stdout)? } else { return None };
                    let u = if u["user"].is_object() { u["user"].clone() } else { u };
                    let p = u["profile"].clone();
                    // Their name, picture (only one they set: Slack's default face says nothing) and time zone too.
                    let name = p["real_name"].as_str().filter(|s| !s.is_empty()).or(p["display_name"].as_str()).unwrap_or("");
                    let face = if p["is_custom_image"].as_bool().unwrap_or(false) { p["image_72"].as_str().unwrap_or("") } else { "" };
                    Some((l.clone(), json!({ "text": p["status_text"].as_str().unwrap_or(""), "emoji": p["status_emoji"].as_str().unwrap_or(""), "until": p["status_expiration"].as_i64().unwrap_or(0), "name": name, "face": face, "tz": u["tz"].as_str().unwrap_or("") })))
                })
            })
            .collect();
        runs.into_iter().filter_map(|h| h.join().ok().flatten()).collect()
    });
    Ok(Value::Object(found.into_iter().collect()))
}

#[tauri::command]
pub async fn slack_people_get() -> Result<Value, String> {
    people()
}

#[derive(Deserialize)]
pub struct Person {
    login: String,
    name: Option<String>,
    #[serde(default)]
    emails: Vec<String>,
    query: Option<String>, // a search typed in Settings, to find them by
    #[serde(default, rename = "emailOnly")]
    email_only: bool, // lgtm matching people by itself, which saves only what's certain: no searches
}

/// Best guesses for people without a mapping: an exact email match first, then their GitHub name, then their login's
/// first word, each only when Slack finds exactly one live person.
/// The Slack user a link or ID points to: a profile (…/team/U…), a user ID (U…, <@U…>), or a DM (…/archives/D…), whose
/// other member it is (the one that isn't you); the server's slackUserIn().
fn slack_user_in(q: &str) -> Option<String> {
    if let Some(c) = re(r"(?:/team/|^<?@?)(U[A-Z0-9]{6,})>?$").captures(q) {
        return Some(c[1].to_string());
    }
    let dm = re(r"(?:/archives/|^)(D[A-Z0-9]{6,})\b").captures(q)?[1].to_string();
    let me = cached(&SLACK_ME, || {
        let r = slackcli(&["auth", "whoami", "--json"], None);
        parse_json(&r.stdout).and_then(|v| v["user_id"].as_str().map(String::from))
    });
    let r = slackcli(&["conversations", "members", "list", &dm, "--json"], None);
    let members = parse_json(&r.stdout)?["members"].as_array()?.clone();
    members.iter().filter_map(|m| m.as_str()).find(|m| Some(*m) != me.as_deref()).map(String::from)
}
static SLACK_ME: OnceLock<Mutex<Option<String>>> = OnceLock::new(); // your own Slack user ID

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
            let mut u = r.ok.then(|| parse_json(&r.stdout)).flatten().filter(|u| u["id"].is_string());
            // Slack looks people up by email for app tokens only: with a person's sign-in, a people search for it, and
            // the one whose email it is.
            if u.is_none() {
                let s = slackcli(&["search", "people", email, "--json", "--limit", "5"], None);
                u = s.ok.then(|| parse_json(&s.stdout)).flatten().and_then(|v| v["people"].as_array().cloned()).unwrap_or_default().into_iter().find(|x| x["profile"]["email"].as_str().is_some_and(|e| e.eq_ignore_ascii_case(email)));
            }
            if let Some(u) = u {
                if u["id"].is_string() && u["deleted"] != json!(true) {
                    found = Some(one(&u, "email"));
                    break;
                }
            }
        }
        let stem = p.login.split('@').next().unwrap_or("").split(['-', '_', '.']).next().unwrap_or("").to_string(); // a GitLab person's key is login@host
        // Who else it could be, when there's no single match, to pick from (and a search typed by hand, first).
        let mut candidates: Vec<Value> = vec![];
        // A Slack link or ID typed in: that person, a DM's other member, or a profile.
        let typed = p.query.clone().unwrap_or_default();
        let linked = slack_user_in(typed.trim());
        if let Some(id) = &linked {
            let r = slackcli(&["users", "info", id, "--json"], None);
            if let Some(u) = r.ok.then(|| parse_json(&r.stdout)).flatten() {
                if u["id"].is_string() && u["deleted"] != json!(true) {
                    candidates.push(one(&u, "search"));
                }
            }
        }
        let typed = if linked.is_some() { String::new() } else { typed };
        for (query, via) in [(typed, "search"), (p.name.clone().unwrap_or_default(), "name"), (stem, "username")] {
            if found.is_some() || p.email_only || query.trim().chars().count() < 2 || query.starts_with('-') {
                continue;
            }
            let q: String = query.chars().take(100).collect();
            let r = slackcli(&["search", "people", &q, "--json", "--limit", "5"], None);
            let live: Vec<Value> = if r.ok {
                parse_json(&r.stdout).and_then(|v| v["people"].as_array().cloned()).unwrap_or_default().into_iter().filter(|u| u["deleted"] != json!(true) && u["is_bot"] != json!(true)).collect()
            } else {
                vec![]
            };
            if live.len() == 1 && via != "search" {
                found = Some(one(&live[0], via));
            }
            for u in &live {
                if candidates.len() < 6 && !candidates.iter().any(|c| c["id"] == u["id"]) {
                    candidates.push(one(u, via));
                }
            }
        }
        let mut row = json!({ "login": p.login });
        if let Some(Value::Object(m)) = found {
            row.as_object_mut().unwrap().extend(m);
        } else if !candidates.is_empty() {
            row["candidates"] = json!(candidates);
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

/// PR links and owner/repo#123 references in a text, as links; GitLab merge request links as they are.
pub fn prs_in(text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for c in re(r"https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)|https://([\w-]+(?:\.[\w-]+)+(?::\d+)?(?:/[\w.-]+){2,}?)/-/merge_requests/(\d+)|\b([\w.-]+/[\w.-]+)#(\d+)\b").captures_iter(text) {
        let url = match (c.get(3), c.get(4)) {
            (Some(path), Some(n)) => format!("https://{}/-/merge_requests/{}", path.as_str(), n.as_str()),
            _ => format!("https://github.com/{}/pull/{}", c.get(1).or(c.get(5)).unwrap().as_str(), c.get(2).or(c.get(6)).unwrap().as_str()),
        };
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
            Some(json!({ "id": id, "cli": cli, "title": s["title"].as_str().unwrap_or(""), "lastActivityAt": last, "prs": prs }))
        })
        .collect();
    out.sort_by(|a, b| b["lastActivityAt"].as_f64().partial_cmp(&a["lastActivityAt"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
    out
}

// --- A PR link on the clipboard (offered when the app comes to the front) ---
// Only the first PR link (GitHub's, or a GitLab merge request's) goes to the UI, never the rest of the clipboard.

pub fn pr_link(text: &str) -> Option<String> {
    re(r"https://github\.com/[\w.-]+/[\w.-]+/pull/\d+|https://[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:/[\w.-]+){2,}?/-/merge_requests/\d+").find(text).map(|m| m.as_str().to_string())
}

#[tauri::command]
pub async fn clipboard_pr() -> Option<String> {
    let out = std::process::Command::new("/usr/bin/pbpaste").output().ok()?;
    pr_link(&String::from_utf8_lossy(&out.stdout[..out.stdout.len().min(1 << 16)]))
}

/// Ask Claude: the page's prompt through Claude Code's CLI, without tools or a saved session (as the server's
/// agentText()). `on_text`: each piece of Claude's answer as it's written (Codex's comes whole, at the end).
#[tauri::command]
/// Its answer, and with a checkout read, the repo files it opened there (`read`, relative; a skill as "skill: name").
pub async fn agent_text(input: String, model: Option<String>, effort: Option<String>, agent: Option<String>, local: Option<Local>, keep: Option<bool>, on_text: tauri::ipc::Channel<String>) -> Result<Value, String> {
    if input.is_empty() || input.len() > 800_000 {
        return Err("Bad request for Claude".into());
    }
    // A checkout of the repo here: the agent reads it, with the prompt made for that. Claude restricted to it; Codex's
    // shell under a profile that reads only it (codex_text).
    let wt = local.as_ref().and_then(|l| review_worktree(l, None));
    let keep = keep == Some(true); // its session kept to open later (Settings → Coding agents)
    let mut session_id: Option<String> = None;
    let input = match (&wt, &local) {
        (Some(_), Some(l)) if !l.input.is_empty() && l.input.len() <= 800_000 => l.input.clone(),
        _ => input,
    };
    let cwd = wt.as_ref().map(|w| w.dir.clone());
    let mut read: Vec<String> = vec![];
    let codex = agent.as_deref() == Some("codex");
    let res = if codex { codex_text(&input, model, effort, cwd.clone(), &mut read, keep, &mut session_id) } else { claude_text(&input, model, effort, cwd.clone(), &on_text, &mut read, keep, &mut session_id) };
    if let Some(w) = wt {
        w.done();
    }
    // The session kept: its agent, id, and where it ran (the review's copy: made again there to open it).
    let session = session_id.map(|id| match (&cwd, &local) {
        (Some(d), Some(l)) => json!({ "agent": if codex { "codex" } else { "claude" }, "id": id, "dir": d, "repo": l.repo, "sha": l.sha }),
        _ => json!({ "agent": if codex { "codex" } else { "claude" }, "id": id }),
    });
    res.map(|text| json!({ "text": text, "read": if cwd.is_some() { json!(read) } else { Value::Null }, "session": session }))
}

/// A path inside `dir` (as given, or as macOS resolves /var to /private/var), relative to it; None outside it.
fn rel_to(dir: &str, p: &str) -> Option<String> {
    let full = if p.starts_with('/') { std::path::PathBuf::from(p) } else { std::path::Path::new(dir).join(p) };
    let mut parts: Vec<String> = vec![];
    for c in full.components() {
        match c {
            std::path::Component::ParentDir => {
                parts.pop();
            }
            std::path::Component::Normal(x) => parts.push(x.to_string_lossy().to_string()),
            _ => {}
        }
    }
    let n = format!("/{}", parts.join("/"));
    let real = std::fs::canonicalize(dir).map(|r| r.to_string_lossy().to_string()).unwrap_or_default();
    [dir.to_string(), real].iter().filter(|d| !d.is_empty()).find_map(|d| n.strip_prefix(&format!("{d}/")).map(String::from))
}

fn claude_text(input: &str, model: Option<String>, effort: Option<String>, cwd: Option<String>, on_text: &tauri::ipc::Channel<String>, read: &mut Vec<String>, keep: bool, session_id: &mut Option<String>) -> Result<String, String> {
    // The model and effort Settings picked for this prompt; none, Claude Code's own.
    let model = model.filter(|m| !m.is_empty());
    let effort = effort.filter(|e| !e.is_empty());
    if model.as_deref().is_some_and(|m| !re(r"^[\w.\[\]-]{1,80}$").is_match(m)) || effort.as_deref().is_some_and(|e| !["low", "medium", "high", "xhigh", "max"].contains(&e)) {
        return Err("Bad request for Claude".into());
    }
    let mut args = vec!["-p"];
    if cwd.is_some() {
        args.extend(["--restricted", "--tools", "Read,Grep,Glob,Skill", "--allowedTools", "Read,Grep,Glob,Skill", "--strict-mcp-config"]);
    } else {
        args.extend(["--tools", ""]);
    }
    let id = keep.then(new_uuid);
    match id.as_deref() {
        Some(i) => args.extend(["--session-id", i]),
        None => args.push("--no-session-persistence"),
    }
    *session_id = id.clone();
    args.extend(["--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
    if let Some(m) = model.as_deref() {
        args.extend(["--model", m]);
    }
    if let Some(e) = effort.as_deref() {
        args.extend(["--effort", e]);
    }
    let (mut text, mut result) = (String::new(), Value::Null);
    let secs = if cwd.is_some() { 600 } else { 300 }; // reading the repo takes longer
    let out = crate::cli::run_lines_in("claude", &args, input, std::time::Duration::from_secs(secs), cwd.as_deref(), |line| {
        let Ok(e) = serde_json::from_str::<Value>(line) else { return };
        if e["type"] == "stream_event" && e["event"]["delta"]["type"] == "text_delta" {
            let d = e["event"]["delta"]["text"].as_str().unwrap_or("");
            text.push_str(d);
            let _ = on_text.send(d.to_string());
        } else if e["type"] == "result" {
            result = e;
        } else if let (Some(dir), "assistant") = (cwd.as_deref(), e["type"].as_str().unwrap_or("")) {
            for c in e["message"]["content"].as_array().into_iter().flatten() {
                let f = match (c["type"].as_str(), c["name"].as_str()) {
                    (Some("tool_use"), Some("Read")) => c["input"]["file_path"].as_str().and_then(|p| rel_to(dir, p)),
                    (Some("tool_use"), Some("Skill")) => c["input"]["skill"].as_str().map(|n| format!("skill: {n}")),
                    _ => None,
                };
                if let Some(f) = f {
                    if !read.contains(&f) {
                        read.push(f);
                    }
                }
            }
        }
    });
    if out.missing {
        return Err("Claude Code isn't installed (see claude.com/code), or not on the PATH".into());
    }
    if !out.ok || result["is_error"] == true {
        let mut last = last_line(&plain(&out.stderr));
        if last.is_empty() {
            last = last_line(result["result"].as_str().unwrap_or("Claude Code stopped"));
        }
        if re(r"(?i)authenticat|log ?in|oauth|unauthori[sz]ed").is_match(&last) {
            return Err("Claude Code isn't signed in: run `claude` in Terminal and sign in (/login), then try again".into());
        }
        return Err(last);
    }
    Ok(result["result"].as_str().map(String::from).unwrap_or(text).trim().to_string())
}

/// A repo to read for a review: "owner/name" (GitHub) or "host/group/name" (GitLab), the PR's base commit, the folder
/// Settings names for it, and the prompt for reading it there.
#[derive(Deserialize)]
pub struct Local {
    repo: String,
    sha: String,
    folder: Option<String>,
    input: String,
}

fn git(dir: &str, args: &[&str]) -> Result<String, String> {
    let mut all = vec!["-C", dir];
    all.extend(args);
    let out = run_env("git", &all, None, std::time::Duration::from_secs(120), &[("GIT_TERMINAL_PROMPT", "0")]);
    if out.ok { Ok(out.stdout) } else { Err(last_line(&out.stderr)) }
}

static FOLDERS: OnceLock<Mutex<(u64, Vec<String>)>> = OnceLock::new();
/// Where you've worked, newest first, from the tools' own records (so wherever they put things, on any machine): Claude
/// desktop's sessions (originCwd, cwd), Claude Code's transcripts ($CLAUDE_CONFIG_DIR or ~/.claude, projects/*/*.jsonl,
/// their first "cwd") and Codex's ($CODEX_HOME or ~/.codex, sessions/**/*.jsonl, its session_meta's cwd). Kept ten
/// minutes; the newest 400 files read, each from its start only. The server's sessionFolders().
fn session_folders() -> Vec<String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let cache = FOLDERS.get_or_init(|| Mutex::new((0, vec![])));
    if let Ok(c) = cache.lock() {
        if c.0 > 0 && now - c.0 < 600 {
            return c.1.clone();
        }
    }
    let mut files: Vec<(std::path::PathBuf, std::time::SystemTime)> = vec![];
    let mut walk = |root: std::path::PathBuf, depth: usize, ok: &dyn Fn(&str) -> bool| {
        let mut stack = vec![(root, depth)];
        while let Some((dir, d)) = stack.pop() {
            for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let p = e.path();
                if p.is_dir() {
                    if d > 0 {
                        stack.push((p, d - 1));
                    }
                } else if ok(&e.file_name().to_string_lossy()) {
                    let t = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
                    files.push((p, t));
                }
            }
        }
    };
    let env_or = |k: &str, d: &str| std::env::var(k).map(std::path::PathBuf::from).unwrap_or_else(|_| home().join(d));
    walk(home().join("Library/Application Support/Claude/claude-code-sessions"), 3, &|n| n.starts_with("local_") && n.ends_with(".json"));
    walk(env_or("CLAUDE_CONFIG_DIR", ".claude").join("projects"), 1, &|n| n.ends_with(".jsonl"));
    walk(env_or("CODEX_HOME", ".codex").join("sessions"), 4, &|n| n.ends_with(".jsonl"));
    files.sort_by(|a, b| b.1.cmp(&a.1));
    let cwd = re(r#""cwd":\s*"([^"\\]+)""#);
    let mut dirs: Vec<String> = vec![];
    for (f, _) in files.into_iter().take(400) {
        let found: Vec<String> = if f.extension().is_some_and(|x| x == "json") {
            let j: Value = std::fs::read_to_string(&f).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
            ["originCwd", "cwd"].iter().filter_map(|k| j[*k].as_str().map(String::from)).collect()
        } else {
            use std::io::Read;
            let mut buf = vec![0u8; 65536];
            let n = std::fs::File::open(&f).and_then(|mut h| h.read(&mut buf)).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            cwd.captures(&head).map(|c| vec![c[1].to_string()]).unwrap_or_default()
        };
        for d in found {
            if d.starts_with('/') && !dirs.contains(&d) {
                dirs.push(d);
            }
        }
    }
    if let Ok(mut c) = cache.lock() {
        *c = (now, dirs.clone());
    }
    dirs
}

/// A checkout of the repo here (Settings' folder first, then where you've worked), whose remote is the repo: its main
/// folder (worktrees share its git data) and the remote's name. The server's localCheckout().
fn local_checkout(repo: &str, folder: Option<&str>) -> Option<(String, String)> {
    let parts: Vec<&str> = repo.split('/').collect();
    let (host, path) = if parts[0].contains('.') && parts.len() > 2 { (parts[0].to_string(), parts[1..].join("/")) } else { ("github.com".to_string(), repo.to_string()) };
    let url = Regex::new(&format!(r"(?i){}[:/]{}(\.git)?/?$", regex::escape(&host), regex::escape(&path))).ok()?;
    for dir in folder.map(String::from).into_iter().chain(session_folders()) {
        let Ok(remotes) = git(&dir, &["remote", "-v"]) else { continue };
        let hit = remotes.lines().find_map(|l| {
            let mut w = l.split_whitespace();
            let (name, u) = (w.next()?, w.next()?);
            url.is_match(u).then(|| name.to_string())
        });
        if let Some(remote) = hit {
            let common = git(&dir, &["rev-parse", "--path-format=absolute", "--git-common-dir"]).ok()?;
            let main = common.trim().trim_end_matches("/.git").to_string();
            return Some((main, remote));
        }
    }
    None
}

pub struct Worktree {
    dir: String,
    main: String,
}
impl Worktree {
    fn done(&self) {
        if git(&self.main, &["worktree", "remove", "--force", &self.dir]).is_err() {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}
/// The repo at the PR's base commit (its rules as they were before the PR), as a detached worktree of your checkout in a
/// folder of its own: your branch and files untouched. The commit fetched first when the checkout hasn't it. The
/// server's reviewWorktree().
fn review_worktree(l: &Local, at: Option<String>) -> Option<Worktree> {
    if !re(r"^[\w.-]+(/[\w.-]+)+$").is_match(&l.repo) || !re(r"^[0-9a-f]{40}$").is_match(&l.sha) || l.folder.as_deref().is_some_and(|f| !f.starts_with('/')) {
        return None;
    }
    let (main, remote) = local_checkout(&l.repo, l.folder.as_deref())?;
    let commit = format!("{}^{{commit}}", l.sha);
    if git(&main, &["cat-file", "-e", &commit]).is_err() {
        git(&main, &["fetch", "--quiet", "--no-tags", &remote, &l.sha]).ok()?;
    }
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = at.unwrap_or_else(|| std::env::temp_dir().join(format!("lgtm-review-{}-{nonce}", std::process::id())).to_string_lossy().to_string());
    let _ = git(&main, &["worktree", "prune"]); // a copy of it removed before: its old record goes first
    git(&main, &["worktree", "add", "--detach", "--quiet", &dir, &l.sha]).ok()?;
    Some(Worktree { dir, main })
}

fn new_uuid() -> String {
    let mut b = [0u8; 16];
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0) ^ ((std::process::id() as u128) << 64);
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut b);
    } else {
        b = n.to_le_bytes();
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

#[derive(Deserialize)]
pub struct Session {
    agent: String,
    id: String,
    dir: Option<String>,
    repo: Option<String>,
    sha: Option<String>,
}
/// A kept agent-review session, resumed where it ran (Claude's in the Claude desktop app, else Terminal): its copy of the repo made again there first (same
/// path and commit; not removed after, it's yours to explore), else your home folder. The server's openAgentSession().
#[tauri::command]
pub async fn agent_session(session: Session, folder: Option<String>) -> Result<(), String> {
    let s = session;
    if !["claude", "codex"].contains(&s.agent.as_str()) || !re(r"^[\w-]{8,64}$").is_match(&s.id) {
        return Err("Bad session".into());
    }
    let mut at = home().to_string_lossy().to_string();
    if let Some(dir) = s.dir {
        if !re(r"^/[\w./-]+/lgtm-review-[\w-]+$").is_match(&dir) {
            return Err("Bad session".into());
        }
        if !std::path::Path::new(&dir).exists() {
            let l = Local { repo: s.repo.unwrap_or_default(), sha: s.sha.unwrap_or_default(), folder, input: String::new() };
            let repo = l.repo.clone();
            review_worktree(&l, Some(dir.clone())).ok_or(format!("No checkout of {repo} here to open it in"))?;
        }
        at = dir;
    }
    // Claude's: in the Claude desktop app, which imports a CLI session from its claude://resume link (where it ran: the
    // copy made again above). Codex's, or with no desktop app: Terminal.
    if s.agent == "claude" && re(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").is_match(&s.id) && run("open", &[&format!("claude://resume?session={}", s.id)], None, std::time::Duration::from_secs(15)).ok {
        return Ok(());
    }
    // A .command file Terminal opens and runs: no permission to script Terminal needed.
    let file = std::env::temp_dir().join(format!("lgtm-session-{}.command", s.id));
    std::fs::write(&file, format!("#!/bin/zsh -l\ncd '{at}' && {} {}\n", if s.agent == "codex" { "codex resume" } else { "claude --resume" }, s.id)).map_err(|e| e.to_string())?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let path = file.to_string_lossy().to_string();
    let out = run("open", &["-a", "Terminal", &path], None, std::time::Duration::from_secs(15));
    if out.ok { Ok(()) } else { Err(last_line(&out.stderr)) }
}

/// The coding agents' CLIs installed (Settings → Coding agents): each one's --version, or null. The server's detectAgents().
#[tauri::command]
pub async fn agents() -> Result<Value, String> {
    let version = |bin: &str| {
        let o = run(bin, &["--version"], None, std::time::Duration::from_secs(15));
        let v = o.stdout.lines().next().unwrap_or("").trim().trim_start_matches("codex-cli ").trim_end_matches(" (Claude Code)").to_string();
        if o.ok && !v.is_empty() { Value::String(v) } else { Value::Null }
    };
    Ok(json!([{ "id": "claude", "version": version("claude") }, { "id": "codex", "version": version("codex"), "models": codex_models() }]))
}

const CODEX_EFFORTS: [&str; 7] = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
/// Codex's models as its CLI last fetched them (~/.codex/models_cache.json): the ones it lists, each with the efforts it
/// takes; null without the cache. The server's codexModels().
fn codex_models() -> Value {
    let dir = std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| home().join(".codex"));
    let Some(cache) = std::fs::read_to_string(dir.join("models_cache.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { return Value::Null };
    let models = cache["models"].as_array().cloned().unwrap_or_default();
    Value::Array(
        models
            .iter()
            .filter(|m| m["visibility"] == "list" && m["slug"].is_string())
            .map(|m| {
                let efforts: Vec<Value> = m["supported_reasoning_levels"].as_array().into_iter().flatten().filter_map(|e| e["effort"].as_str()).filter(|e| CODEX_EFFORTS.contains(e)).map(|e| json!(e)).collect();
                json!({ "id": m["slug"], "name": m["display_name"].as_str().unwrap_or(m["slug"].as_str().unwrap_or("")), "efforts": efforts })
            })
            .collect(),
    )
}

/// The same through Codex's CLI (`codex login`): its last message back. Every tool it has switched off (shell, browser,
/// computer use, apps, images, MCP servers, web search), read-only, in an empty folder: like Claude above, it only
/// reads what it's given. The server's codexText().
fn codex_text(input: &str, model: Option<String>, effort: Option<String>, cwd: Option<String>, read: &mut Vec<String>, keep: bool, session_id: &mut Option<String>) -> Result<String, String> {
    let model = model.filter(|m| !m.is_empty());
    let effort = effort.filter(|e| !e.is_empty());
    if model.as_deref().is_some_and(|m| !re(r"^[\w.\[\]-]{1,80}$").is_match(m)) || effort.as_deref().is_some_and(|e| !CODEX_EFFORTS.contains(&e)) {
        return Err("Bad request for Codex".into());
    }
    let dir = std::env::temp_dir().join(format!("lgtm-codex-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join("answer.txt");
    let (dir_s, out_s) = (dir.to_string_lossy().to_string(), out.to_string_lossy().to_string());
    let effort_c = effort.as_deref().map(|e| format!("model_reasoning_effort={e}"));
    let at = cwd.clone().unwrap_or_else(|| dir_s.clone());
    // Reading the repo's copy: its shell on, under a permission profile that reads only that copy, the system's basics
    // (:minimal) and Codex's own install (its helper runs from there), writes nothing, no network: not your home folder
    // (your GitHub token, keys). Otherwise no shell at all. The server's codexText().
    let fs = cwd.as_ref().map(|_| {
        let bin = std::env::var("PATH").unwrap_or_default().split(':').map(|d| std::path::Path::new(d).join("codex")).find(|p| p.is_file());
        let mut read = vec![":minimal".to_string(), ":workspace_roots".to_string()];
        if let Some(b) = bin {
            if let Some(d) = b.parent() {
                read.push(d.to_string_lossy().to_string());
            }
            if let Some(d) = std::fs::canonicalize(&b).ok().and_then(|r| r.parent().and_then(|p| p.parent()).map(|p| p.to_string_lossy().to_string())) {
                read.push(d);
            }
        }
        format!("permissions.lgtm_review.filesystem={{{}}}", read.iter().map(|p| format!("{}=\"read\"", serde_json::to_string(p).unwrap_or_default())).collect::<Vec<_>>().join(","))
    });
    let mut args: Vec<&str> = vec!["exec", "--skip-git-repo-check"];
    if !keep {
        args.push("--ephemeral");
    }
    match fs.as_deref() {
        Some(f) => args.extend(["-c", "default_permissions=\"lgtm_review\"", "-c", f]),
        None => args.extend(["--sandbox", "read-only"]),
    }
    args.extend(["--color", "never", "-C", &at]);
    for f in ["shell_tool", "unified_exec", "browser_use", "browser_use_external", "computer_use", "in_app_browser", "apps", "view_image"] {
        if cwd.is_some() && (f == "shell_tool" || f == "unified_exec") {
            continue;
        }
        args.extend(["--disable", f]);
    }
    args.extend(["-c", "mcp_servers={}", "-c", "web_search=\"disabled\""]);
    if let Some(m) = model.as_deref() {
        args.extend(["-m", m]);
    }
    if let Some(e) = effort_c.as_deref() {
        args.extend(["-c", e]);
    }
    if cwd.is_some() || keep {
        args.push("--json"); // its events: the commands it ran (what it read), its session's id
    }
    args.extend(["-o", &out_s, "-"]);
    let res = crate::cli::run_in("codex", &args, Some(input), std::time::Duration::from_secs(if cwd.is_some() { 600 } else { 300 }), cwd.as_deref());
    let text = std::fs::read_to_string(&out).unwrap_or_default();
    let _ = std::fs::remove_dir_all(&dir);
    if res.missing {
        return Err("Codex isn't installed (brew install codex), or not on the PATH".into());
    }
    if !res.ok {
        let last = last_line(&plain(if res.stderr.trim().is_empty() { &res.stdout } else { &res.stderr }));
        if re(r"(?i)log ?in|auth|unauthori[sz]ed|401").is_match(&last) {
            return Err("Codex isn't signed in: run `codex login` in Terminal, then try again".into());
        }
        return Err(last);
    }
    if keep {
        *session_id = res.stdout.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).find(|e| e["type"] == "thread.started").and_then(|e| e["thread_id"].as_str().map(String::from));
    }
    // Reading the repo: each command's words that are files of the repo, as what it read.
    if let Some(dir) = cwd.as_deref() {
        let split = Regex::new(r#"[\s'"|;&<>()]+"#).unwrap();
        for line in res.stdout.lines().filter(|l| l.contains("command_execution")) {
            let Ok(e) = serde_json::from_str::<Value>(line) else { continue };
            for w in split.split(e["item"]["command"].as_str().unwrap_or("")) {
                if w.is_empty() || w.starts_with('-') {
                    continue;
                }
                if let Some(f) = rel_to(dir, w) {
                    if std::path::Path::new(dir).join(&f).is_file() && !read.contains(&f) {
                        read.push(f);
                    }
                }
            }
        }
    }
    Ok(text.trim().to_string())
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

/// Messages for a Claude Code session, read by its skill ("check lgtm"); as the server's leaveForSession().
fn session_id_ok(id: &str) -> bool {
    re(r"^(local_[A-Za-z0-9-]{1,64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$").is_match(id)
}
#[tauri::command]
pub async fn agent_outbox(id: String, text: String) -> Result<Value, String> {
    if !session_id_ok(&id) || text.trim().is_empty() || text.len() > 50_000 {
        return Err("Bad message for Claude".into());
    }
    let dir = home().join(".config").join("lgtm").join("outbox");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{id}.md"));
    let before = std::fs::read_to_string(&file).unwrap_or_default();
    let stamp = std::process::Command::new("date").args(["-u", "+%Y-%m-%dT%H:%M:%SZ"]).output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    let sep = if before.is_empty() { "" } else { "\n\n---\n\n" };
    std::fs::write(&file, format!("{before}{sep}<!-- from lgtm, {stamp} -->\n{}\n", text.trim())).map_err(|e| e.to_string())?;
    Ok(json!({ "path": file.to_string_lossy() }))
}

/// A session's title and state from the Claude app's record; as the server's claudeSession().
#[tauri::command]
pub async fn claude_session(id: String) -> Result<Value, String> {
    if !session_id_ok(&id) {
        return Err("Bad session id".into());
    }
    let read = |p: &std::path::Path| {
        let s = std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())?;
        let prior = s["priorCliSessionIds"].as_array().map_or(false, |a| a.iter().any(|x| x.as_str() == Some(&id)));
        (s["sessionId"].as_str() == Some(&id) || s["cliSessionId"].as_str() == Some(&id) || prior).then_some(s)
    };
    // Polled every few seconds: the file it was found in last time first, before looking through them all.
    let known = SESSION_FILES.lock().unwrap().iter().find(|(k, _)| *k == id).map(|(_, p)| p.clone());
    let mut hit = known.as_deref().and_then(|p| read(p));
    let mut stack = vec![(home().join("Library").join("Application Support").join("Claude").join("claude-code-sessions"), 0)];
    while hit.is_none() {
        let Some((dir, depth)) = stack.pop() else { break };
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let (p, name) = (e.path(), e.file_name().to_string_lossy().to_string());
            if p.is_dir() && depth < 3 {
                stack.push((p, depth + 1));
                continue;
            }
            if !(name.starts_with("local_") && name.ends_with(".json")) || (id.starts_with("local_") && name != format!("{id}.json")) {
                continue;
            }
            if let Some(s) = read(&p) {
                let mut files = SESSION_FILES.lock().unwrap();
                files.retain(|(k, _)| *k != id);
                files.push((id.clone(), p));
                hit = Some(s);
                break;
            }
        }
    }
    if let Some(s) = hit {
        if s["isArchived"] == json!(true) {
            return Ok(Value::Null);
        }
        let num = |k: &str| s[k].as_f64().unwrap_or(0.0);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0);
        let state = if !s["interruptedAwaitingPerson"].is_null() {
            "waiting"
        } else if num("lastActivityAt") - num("lastTurnEdgeAt") > 2000.0 && now - num("lastActivityAt") < 120_000.0 {
            "working"
        } else {
            "idle"
        };
        return Ok(json!({ "id": s["sessionId"], "title": s["title"].as_str().unwrap_or(""), "state": state }));
    }
    Ok(Value::Null)
}
/// Where each polled session's record was found last time.
static SESSION_FILES: std::sync::Mutex<Vec<(String, std::path::PathBuf)>> = std::sync::Mutex::new(Vec::new());

/// Is the lgtm-links mod (mods/lgtm-links in the repo) installed in Claude Code? Its record of installed plugins
/// (~/.claude, or CLAUDE_CONFIG_DIR) names it as lgtm-links@<marketplace>; as the server's agentMod().
/// Codex's (agent "codex"): its config.toml names lgtm-links@<marketplace> among its plugins, switched on.
#[tauri::command]
pub async fn agent_mod(agent: Option<String>) -> Value {
    if agent.as_deref() == Some("codex") {
        let dir = std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| home().join(".codex"));
        let config = std::fs::read_to_string(dir.join("config.toml")).unwrap_or_default();
        return json!({ "installed": codex_plugin_on(&config) });
    }
    let dir = std::env::var("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from).unwrap_or_else(|_| home().join(".claude"));
    let d: Value = std::fs::read_to_string(dir.join("plugins").join("installed_plugins.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let installed = d["plugins"].as_object().is_some_and(|p| p.keys().any(|k| k.starts_with("lgtm-links@")));
    json!({ "installed": installed })
}

/// Whether a Codex config.toml has a [plugins."lgtm-links@…"] table that isn't switched off.
fn codex_plugin_on(config: &str) -> bool {
    let mut inside = false;
    let mut found = false;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            if inside {
                return true;
            }
            inside = line.starts_with("[plugins.\"lgtm-links@");
            found |= inside;
        } else if inside && line.replace(' ', "") == "enabled=false" {
            return false;
        }
    }
    found
}

/// The Claude Code skill that sends PRs ready for review to lgtm (app/claude-skill.md, built in by build.rs),
/// installed for the user in ~/.claude/skills; as the server's agentSkill().
const SKILL: &str = include_str!(concat!(env!("OUT_DIR"), "/claude-skill.md"));
const CODEX_SKILL: &str = include_str!(concat!(env!("OUT_DIR"), "/codex-skill.md"));
/// Codex's (agent "codex") goes in $CODEX_HOME/skills.
#[tauri::command]
pub async fn agent_skill(install: bool, agent: Option<String>) -> Result<Value, String> {
    let codex = agent.as_deref() == Some("codex");
    let (root, text) = if codex {
        (std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| home().join(".codex")), CODEX_SKILL)
    } else {
        (home().join(".claude"), SKILL)
    };
    let path = root.join("skills").join("lgtm-review").join("SKILL.md");
    if install {
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&path, text).map_err(|e| e.to_string())?;
    }
    let have = std::fs::read_to_string(&path).ok();
    Ok(json!({ "installed": have.is_some(), "current": have.as_deref() == Some(text), "path": path.to_string_lossy() }))
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
        assert!(re(PR_REF).is_match("gitlab.com/group/sub/proj#12") && re(LOGIN).is_match("jo.e@gitlab.com") && !re(LOGIN).is_match("a@b/c"));
        assert_eq!(pr_page("gitlab.com/g/p", "7"), "gitlab.com/g/p/-/merge_requests/7");
        let hosts = glab_hosts("git_protocol: ssh\nhosts:\n    gitlab.com:\n        user: ana\n        api_host: gitlab.com\n    git.acme.io:\n        token: x\n");
        assert_eq!(hosts, vec![json!({ "host": "gitlab.com", "login": "ana", "api": "https://gitlab.com" })]);
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
        assert_eq!(prs_in("see https://gitlab.com/g/s/p/-/merge_requests/9#note_1"), vec!["https://gitlab.com/g/s/p/-/merge_requests/9"]);
        assert_eq!(pr_link("x https://gitlab.com/g/p/-/merge_requests/3 y").as_deref(), Some("https://gitlab.com/g/p/-/merge_requests/3"));
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
        let sent = block_on(slack_notify(vec![Recipient { login: "nobody-unmapped".into(), emails: vec![], at: None }], "test".into(), "bukuwarung/lgtm#1".into(), None)).expect("notify");
        println!("slack_notify (dry run, unmapped): {}", sent[0]["error"]);
        assert_eq!(sent[0]["ok"], json!(false));
        assert!(block_on(job_log("bad repo".into(), 1, None)).is_err());
    }
}

// A desktop notification that, once clicked, brings the window forward and opens `route` (a PR's "/owner/repo/pull/n";
// empty: just the window). Each waits for its click on a thread of its own.
// ponytail: one parked thread per notification left unclicked, until it's dismissed or lgtm quits; few a day.
#[tauri::command]
pub fn notify(app: tauri::AppHandle, title: String, body: String, sound: bool, route: String) {
    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        {
            use mac_notification_sys::{Notification, NotificationResponse, Sound};
            use tauri::{Emitter, Manager};
            let _ = mac_notification_sys::set_application(&app.config().identifier);
            let mut n = Notification::new();
            n.title(&title).message(&body).wait_for_click(true);
            if sound {
                n.sound(Sound::Default);
            }
            if let Ok(NotificationResponse::Click) = n.send() {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                if !route.is_empty() {
                    let _ = app.emit("open-route", route);
                }
            }
        }
    });
}

// --- Menu bar: the PRs waiting on me, and mine, a click away ---

#[derive(Deserialize)]
pub struct TrayItem {
    title: String,
    route: String, // "/owner/repo/pull/n"
    section: String, // "needs": waiting for my review; "mine": my own PRs
    note: Option<String>, // a PR of mine: where it stands (ready to merge, CI failing…)
}

/// The menu bar item: how many PRs wait on my review beside its icon, and a menu of those, then my own PRs and where
/// they stand, then lgtm's actions. None: no menu bar item (Settings turned it off).
#[tauri::command]
pub fn set_tray(app: tauri::AppHandle, items: Option<Vec<TrayItem>>) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri::{Emitter, Manager};
    let Some(items) = items else {
        app.remove_tray_by_id("lgtm");
        return Ok(());
    };
    let e = |e: tauri::Error| e.to_string();
    let cut = |t: &str, n: usize| if t.chars().count() > n { t.chars().take(n - 1).collect::<String>() + "…" } else { t.to_string() };
    let menu = Menu::new(&app).map_err(e)?;
    let add = |id: String, text: String, on: bool| -> Result<(), String> { menu.append(&MenuItem::with_id(&app, id, text, on, None::<&str>).map_err(e)?).map_err(e) };
    let needs: Vec<&TrayItem> = items.iter().filter(|i| i.section == "needs").collect();
    let mine: Vec<&TrayItem> = items.iter().filter(|i| i.section == "mine").collect();
    add("h-needs".into(), if needs.is_empty() { "Nothing needs your review".into() } else { format!("Needs your review ({})", needs.len()) }, false)?;
    for i in &needs {
        add(format!("pr:{}", i.route), format!("    {}", cut(&i.title, 60)), true)?;
    }
    if !mine.is_empty() {
        menu.append(&PredefinedMenuItem::separator(&app).map_err(e)?).map_err(e)?;
        add("h-mine".into(), format!("Your PRs ({})", mine.len()), false)?;
        for i in &mine {
            let note = i.note.as_deref().map(|n| format!(" — {n}")).unwrap_or_default();
            add(format!("pr:{}", i.route), format!("    {}{}", cut(&i.title, 50), note), true)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(&app).map_err(e)?).map_err(e)?;
    add("menu:review-mode".into(), "Start Review Mode".into(), !needs.is_empty())?;
    add("menu:refresh-list".into(), "Refresh".into(), true)?;
    add("menu:settings".into(), "Settings…".into(), true)?;
    add("open".into(), "Open lgtm".into(), true)?;
    let title = if needs.is_empty() { None } else { Some(needs.len().to_string()) };
    if let Some(tray) = app.tray_by_id("lgtm") {
        tray.set_menu(Some(menu)).map_err(e)?;
        tray.set_title(title).map_err(e)?;
        return Ok(());
    }
    // A template image: macOS draws it in the menu bar's own colour, light or dark, like its other items.
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png")).map_err(e)?;
    let mut b = TrayIconBuilder::with_id("lgtm").icon(icon).icon_as_template(true).menu(&menu).show_menu_on_left_click(true).tooltip("lgtm");
    if let Some(t) = title {
        b = b.title(t);
    }
    b.on_menu_event(|app, ev| {
        let id = ev.id().as_ref();
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        if let Some(route) = id.strip_prefix("pr:") {
            let _ = app.emit("open-route", route.to_string());
        } else if let Some(action) = id.strip_prefix("menu:") {
            let _ = app.emit("menu", action.to_string()); // as the app's own menus do
        }
    })
    .build(&app)
    .map_err(e)?;
    Ok(())
}

#[cfg(test)]
mod codex_plugin_tests {
    use super::codex_plugin_on;
    #[test]
    fn lgtm_links_on_unless_switched_off() {
        assert!(codex_plugin_on("model = \"x\"\n\n[plugins.\"lgtm-links@lgtm\"]\nenabled = true\n\n[mcp_servers.a]\n"));
        assert!(codex_plugin_on("[plugins.\"lgtm-links@lgtm\"]\n"));
        assert!(!codex_plugin_on("[plugins.\"lgtm-links@lgtm\"]\nenabled = false\n[plugins.\"pdf@x\"]\nenabled = true\n"));
        assert!(!codex_plugin_on("[plugins.\"pdf@x\"]\nenabled = true\n"));
    }
}

// Images and videos from a PR, opened in the Mac's own apps (Preview, the default video player) rather than the browser:
// each saved under its own name in a temp folder first.
fn media_dir() -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join("lgtm-images");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn media_name(given: &str, fallback_ext: &str) -> String {
    let mut name: String = given.chars().filter(|c| c.is_alphanumeric() || "._- ".contains(*c)).take(120).collect();
    name = name.trim_start_matches('.').to_string();
    if name.is_empty() {
        name = "file".into();
    }
    if !name.contains('.') {
        name = format!("{name}.{fallback_ext}");
    }
    name
}
fn in_media_dir(path: &str) -> bool {
    media_dir().map(|d| std::path::Path::new(path).starts_with(&d) && !path.contains("..")).unwrap_or(false)
}

/// The bytes the page already shows (sent raw, not as JSON) saved as a temp file named by the x-name header. Back: its path.
#[tauri::command]
pub async fn save_media(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Nothing to save".into()) };
    let given = request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("");
    let path = media_dir()?.join(media_name(given, "png"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// A file the page plays from its address (a video), downloaded into the temp folder. Back: its path.
#[tauri::command]
pub async fn download_media(url: String, name: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Not a web address".into());
    }
    let path = media_dir()?.join(media_name(&name, "mp4"));
    let file = path.to_string_lossy().to_string();
    let got = run("curl", &["-fsSL", "--max-time", "300", "-o", &file, &url], None, std::time::Duration::from_secs(310));
    if got.ok { Ok(file) } else { Err("Couldn't download it".into()) }
}

/// Saved files opened together: in Preview (one window, in this order), or with each one's default app (no app).
#[tauri::command]
pub async fn open_media(paths: Vec<String>, app: Option<String>) -> Result<(), String> {
    if paths.is_empty() || !paths.iter().all(|p| in_media_dir(p)) || app.as_deref().is_some_and(|a| a != "Preview") {
        return Err("Not lgtm's files".into());
    }
    let mut args: Vec<&str> = vec![];
    if let Some(a) = app.as_deref() {
        args.extend(["-a", a]);
    }
    args.extend(paths.iter().map(|p| p.as_str()));
    let shown = run("open", &args, None, std::time::Duration::from_secs(15));
    if shown.ok { Ok(()) } else { Err("It didn't open".into()) }
}

/// A saved image on the clipboard, as a PNG (what other apps paste): converted with sips, set through AppleScript.
#[tauri::command]
pub async fn copy_media(path: String) -> Result<(), String> {
    if !in_media_dir(&path) {
        return Err("Not lgtm's file".into());
    }
    let png = format!("{path}.clip.png");
    if !run("sips", &["-s", "format", "png", &path, "--out", &png], None, std::time::Duration::from_secs(20)).ok {
        return Err("Couldn't read the image".into());
    }
    let script = format!("set the clipboard to (read (POSIX file \"{}\") as «class PNGf»)", png.replace('"', ""));
    if run("osascript", &["-e", &script], None, std::time::Duration::from_secs(10)).ok { Ok(()) } else { Err("Couldn't copy it".into()) }
}
