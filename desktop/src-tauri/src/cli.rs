// Running the CLIs lgtm borrows sign-ins from (gh, slackcli, acli): an argument vector (never a shell), optional stdin,
// and a timeout so a hung CLI can't hang the app.
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

pub struct Out {
    pub ok: bool,
    pub missing: bool, // the program isn't installed (or not on PATH)
    pub stdout: String,
    pub stderr: String,
}

pub fn run(program: &str, args: &[&str], input: Option<&str>, timeout: Duration) -> Out {
    run_env(program, args, input, timeout, &[])
}

/// As run, with these environment variables set for it.
pub fn run_env(program: &str, args: &[&str], input: Option<&str>, timeout: Duration, env: &[(&str, &str)]) -> Out {
    let child = Command::new(program)
        .args(args)
        .envs(env.iter().copied())
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            let missing = e.kind() == std::io::ErrorKind::NotFound;
            return Out { ok: false, missing, stdout: String::new(), stderr: e.to_string() };
        }
    };
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        let _ = stdin.write_all(text.as_bytes());
    }
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(o)) => Out {
            ok: o.status.success(),
            missing: false,
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        },
        Ok(Err(e)) => Out { ok: false, missing: false, stdout: String::new(), stderr: e.to_string() },
        Err(_) => {
            let _ = Command::new("kill").arg(pid.to_string()).status();
            Out { ok: false, missing: false, stdout: String::new(), stderr: format!("{program} took too long and was stopped") }
        }
    }
}

pub const SECONDS_30: Duration = Duration::from_secs(30);

/// The last non-empty line, where these CLIs put their error.
pub fn last_line(s: &str) -> String {
    s.trim().lines().last().unwrap_or("").to_string()
}

/// Drop terminal colours (the CLIs colour their human-readable output).
pub fn plain(s: &str) -> String {
    let re = regex::Regex::new(r"\x1b\[[0-9;]*m").unwrap();
    re.replace_all(s, "").into_owned()
}

/// slackcli may print a spinner line before its JSON, and prints nothing at all for an empty search.
pub fn parse_json(out: &str) -> Option<serde_json::Value> {
    out.find('{').and_then(|i| serde_json::from_str(&out[i..]).ok())
}
