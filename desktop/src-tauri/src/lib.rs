// lgtm as a macOS app: the review UI (app/dist) in a window, with the local server's routes as commands that run
// the same CLIs. See openspec/changes/add-desktop-app.
mod cli;
mod commands;
mod config;

use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

/// Apps started from Finder or the Dock get a bare PATH without Homebrew, so `gh`, `slackcli` and `acli` aren't
/// found. Take the PATH of the user's login shell (where Homebrew is set up), falling back to Homebrew's usual
/// directories if the shell is slow or fails.
fn adopt_login_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let out = Command::new(shell).args(["-lc", "printf %s \"$PATH\""]).output();
        let _ = tx.send(out);
    });
    let path = match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(o)) if o.status.success() && !o.stdout.is_empty() => String::from_utf8_lossy(&o.stdout).into_owned(),
        _ => format!("/opt/homebrew/bin:/usr/local/bin:{}", std::env::var("PATH").unwrap_or_default()),
    };
    std::env::set_var("PATH", path);
}

/// The GitHub CLI's token, read on every call so `gh auth login` / `gh auth switch` apply on reload.
#[tauri::command]
async fn gh_token() -> Result<String, String> {
    let out = Command::new("gh").args(["auth", "token"]).output().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => "The GitHub CLI isn't installed.".to_string(),
        _ => e.to_string(),
    })?;
    if !out.status.success() {
        return Err("The GitHub CLI isn't signed in.".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The menu bar. Custom items reach the UI as a "menu" event carrying the item's id (main.tsx handles them); the
/// predefined ones (Edit, Window) are macOS's own.
fn menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let item = |id: &str, text: &str, keys: Option<&str>| MenuItem::with_id(app, id, text, true, keys);
    let sep = || P::separator(app);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "lgtm",
                true,
                &[
                    &P::about(app, None, Some(AboutMetadata { version: Some(app.package_info().version.to_string()), ..Default::default() }))?,
                    &sep()?,
                    &item("settings", "Settings…", Some("CmdOrCtrl+,"))?,
                    &sep()?,
                    &P::hide(app, None)?,
                    &P::hide_others(app, None)?,
                    &P::show_all(app, None)?,
                    &sep()?,
                    &P::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &item("open-url", "Open PR Link…", Some("CmdOrCtrl+L"))?,
                    &item("palette", "Go to…", Some("CmdOrCtrl+K"))?,
                    &sep()?,
                    &item("reload", "Reload", Some("CmdOrCtrl+R"))?,
                    &P::close_window(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &P::undo(app, None)?,
                    &P::redo(app, None)?,
                    &sep()?,
                    &P::cut(app, None)?,
                    &P::copy(app, None)?,
                    &P::paste(app, None)?,
                    &P::select_all(app, None)?,
                    &sep()?,
                    &item("find", "Find…", Some("CmdOrCtrl+F"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &item("back", "Back", Some("CmdOrCtrl+["))?,
                    &item("forward", "Forward", Some("CmdOrCtrl+]"))?,
                    &sep()?,
                    &item("toggle-prs", "Show or Hide the PR List", Some("CmdOrCtrl+Shift+L"))?,
                    &sep()?,
                    &P::fullscreen(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "Window", true, &[&P::minimize(app, None)?, &P::maximize(app, None)?])?,
            &Submenu::with_items(
                app,
                "Help",
                true,
                &[&item("help", "lgtm on GitHub", None)?, &item("diagnostics", "Copy Diagnostics", None)?],
            )?,
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    adopt_login_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init()) // web links open in the default browser
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init()) // lgtm://<owner>/<repo>/pull/<n>
        .plugin(tauri_plugin_window_state::Builder::default().build()) // window size and position, remembered
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .menu(menu)
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let _ = app.emit("menu", event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            gh_token,
            commands::integrations,
            commands::jira_issue,
            commands::job_log,
            commands::slack_status,
            commands::slack_notify,
            commands::slack_people_get,
            commands::slack_people_find,
            commands::slack_people_save,
            commands::export_settings,
            commands::claude_sessions,
            commands::clipboard_pr,
            commands::copy_text,
            commands::self_update,
            commands::claude_text,
            commands::claude_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running lgtm");
}
