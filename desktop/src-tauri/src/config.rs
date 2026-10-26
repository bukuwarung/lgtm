// lgtm's files in ~/.config/lgtm (or $XDG_CONFIG_HOME/lgtm), shared with the browser version:
// config.json ({ "slackUsers": { "github-login": "U…" } }) and slack-threads.json ({ "o/r#12:login": { channel, ts } }).
use serde_json::{json, Value};
use std::path::PathBuf;

pub fn dir() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config"));
    base.join("lgtm")
}

/// A JSON file's contents; a missing file is `{}`. `strict`: a broken file is an error (the config) rather than `{}`
/// (the threads, which can be rebuilt).
pub fn read(name: &str, strict: bool) -> Result<Value, String> {
    let path = dir().join(name);
    match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str(&s) {
            Ok(v) => Ok(v),
            Err(e) if strict => Err(format!("Can't read {}: {e}", path.display())),
            Err(_) => Ok(json!({})),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) if strict => Err(format!("Can't read {}: {e}", path.display())),
        Err(_) => Ok(json!({})),
    }
}

/// Written to a temporary file, then renamed over: a crash mid-write can't leave half a file.
pub fn write(name: &str, value: &Value) -> Result<(), String> {
    let d = dir();
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let tmp = d.join(format!("{name}.tmp"));
    std::fs::write(&tmp, serde_json::to_string_pretty(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, d.join(name)).map_err(|e| e.to_string())
}
