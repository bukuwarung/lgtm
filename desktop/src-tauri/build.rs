// Only lgtm's own commands are callable from the page, each granted by name in capabilities/default.json.
const COMMANDS: &[&str] = &[
    "gh_token", "integrations", "jira_issue", "job_log", "slack_status", "slack_notify",
    "slack_people_get", "slack_people_find", "slack_people_save", "export_settings", "claude_sessions",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to build the Tauri app manifest");
}
