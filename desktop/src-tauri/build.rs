// Only lgtm's own commands are callable from the page, each granted by name in capabilities/default.json.
const COMMANDS: &[&str] = &[
    "gh_token", "integrations", "jira_issue", "job_log", "slack_status", "slack_notify", "slack_post", "slack_channel", "slack_qa", "slack_threads",
    "slack_people_get", "slack_people_find", "slack_people_save", "export_settings", "claude_sessions", "clipboard_pr", "copy_text", "set_tray", "self_update", "agent_text", "agent_skill", "agent_mod", "agent_outbox", "claude_session", "gh_accounts", "glab_accounts", "glab_token", "agents", "slack_emoji", "jira_move", "jira_statuses", "slack_presence", "notify",
];

fn main() {
    // The lgtm-review skills live with the UI (app/claude-skill.md, app/codex-skill.md); the app builds them in from OUT_DIR.
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    for name in ["claude-skill.md", "codex-skill.md"] {
        let skill = manifest.parent().unwrap().parent().unwrap().join("app").join(name);
        println!("cargo:rerun-if-changed={}", skill.display());
        std::fs::copy(&skill, std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join(name)).expect(name);
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to build the Tauri app manifest");
}
