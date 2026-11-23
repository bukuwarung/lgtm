// Running the CLIs lgtm borrows sign-ins from (gh, slackcli, acli): an argument vector (never a shell), optional stdin,
// and a timeout so a hung CLI can't hang the app.
use std::io::{BufRead, BufReader, Read, Write};
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
    run_env_in(program, args, input, timeout, env, None)
}

/// As run, in `dir` when given (a review's copy of the repo).
pub fn run_in(program: &str, args: &[&str], input: Option<&str>, timeout: Duration, dir: Option<&str>) -> Out {
    run_env_in(program, args, input, timeout, &[], dir)
}

fn run_env_in(program: &str, args: &[&str], input: Option<&str>, timeout: Duration, env: &[(&str, &str)], dir: Option<&str>) -> Out {
    let mut cmd = Command::new(program);
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    let child = cmd
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

/// As run, with stdout handed over a line at a time as the program writes it (stdout comes back empty).
/// In `dir` when given (a review's checkout), else here.
pub fn run_lines_in(program: &str, args: &[&str], input: &str, timeout: Duration, dir: Option<&str>, mut on_line: impl FnMut(&str)) -> Out {
    let mut cmd = Command::new(program);
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    let mut child = match cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => return Out { ok: false, missing: e.kind() == std::io::ErrorKind::NotFound, stdout: String::new(), stderr: e.to_string() },
    };
    let (mut stdin, stdout, mut stderr) = (child.stdin.take().unwrap(), child.stdout.take().unwrap(), child.stderr.take().unwrap());
    let text = input.to_string();
    std::thread::spawn(move || stdin.write_all(text.as_bytes())); // a big prompt can't block reading its answer
    let errs = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    // Stopped once it takes too long: reading ends when its stdout closes.
    let (pid, (tx, rx)) = (child.id(), mpsc::channel::<()>());
    let late = std::thread::spawn(move || {
        let late = rx.recv_timeout(timeout) == Err(mpsc::RecvTimeoutError::Timeout);
        if late {
            let _ = Command::new("kill").arg(pid.to_string()).status();
        }
        late
    });
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        on_line(&line);
    }
    let status = child.wait();
    drop(tx);
    let stderr = errs.join().unwrap_or_default();
    if late.join().unwrap_or(false) {
        return Out { ok: false, missing: false, stdout: String::new(), stderr: format!("{program} took too long and was stopped") };
    }
    Out { ok: status.is_ok_and(|s| s.success()), missing: false, stdout: String::new(), stderr }
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
    // The first JSON object: CLIs print a spinner line before it, and some (slackcli) an update notice after.
    let i = out.find('{')?;
    serde_json::Deserializer::from_str(&out[i..]).into_iter::<serde_json::Value>().next()?.ok()
}
