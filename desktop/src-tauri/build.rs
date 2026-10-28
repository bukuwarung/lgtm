// Only lgtm's own commands are callable from the page, each granted by name in capabilities/default.json.
const COMMANDS: &[&str] = &[
    "gh_token", "integrations", "jira_issue", "job_log", "slack_status", "slack_notify",
    "slack_people_get", "slack_people_find", "slack_people_save", "export_settings", "claude_sessions", "clipboard_pr", "copy_text", "self_update", "claude_text", "claude_skill", "claude_outbox", "claude_session", "gh_accounts", "slack_emoji", "jira_move",
];

fn main() {
    // The Claude Code skill lives with the UI (app/claude-skill.md); the app builds it in from OUT_DIR.
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let skill = manifest.parent().unwrap().parent().unwrap().join("app").join("claude-skill.md");
    println!("cargo:rerun-if-changed={}", skill.display());
    std::fs::copy(&skill, std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("claude-skill.md")).expect("app/claude-skill.md");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to build the Tauri app manifest");
}
