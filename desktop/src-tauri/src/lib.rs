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
/// directories if the shell is slow or fails. Asking the shell takes 100ms or more at every launch, so the answer is
/// kept (~/Library/Caches/com.bukuwarung.lgtm/login-path): later launches use it at once and ask again in the
/// background for the next one (a PATH changed since applies from then).
fn adopt_login_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let ask = move || -> Option<String> {
        let o = Command::new(&shell).args(["-lc", "printf %s \"$PATH\""]).output().ok()?;
        (o.status.success() && !o.stdout.is_empty()).then(|| String::from_utf8_lossy(&o.stdout).into_owned())
    };
    let keep = |path: &str| {
        if let Some(k) = kept_file() {
            let _ = std::fs::create_dir_all(k.parent().unwrap()).and_then(|_| std::fs::write(k, path));
        }
    };
    if let Some(path) = kept_file().and_then(|k| std::fs::read_to_string(k).ok()).filter(|p| !p.trim().is_empty()) {
        std::env::set_var("PATH", path);
        std::thread::spawn(move || ask().map(|p| keep(&p)));
        return;
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(ask());
    });
    let path = match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Some(p)) => (keep(&p), p).1,
        _ => format!("/opt/homebrew/bin:/usr/local/bin:{}", std::env::var("PATH").unwrap_or_default()),
    };
    std::env::set_var("PATH", path);
}
fn kept_file() -> Option<std::path::PathBuf> {
    Some(std::path::PathBuf::from(std::env::var_os("HOME")?).join("Library/Caches/com.bukuwarung.lgtm/login-path"))
}

/// The GitHub CLI's token, read on every call so `gh auth login` / `gh auth switch` apply on reload; `user`, the
/// account Settings → Accounts picked (none: gh's active one).
#[tauri::command]
async fn gh_token(user: Option<String>) -> Result<String, String> {
    commands::gh_token_of(user.as_deref().unwrap_or(""))
}

/// The menu bar. Custom items reach the UI as a "menu" event carrying the item's id (main.tsx handles them); the
/// predefined ones (Edit, Window) are macOS's own.
fn menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let item = |id: &str, text: &str, keys: Option<&str>| MenuItem::with_id(app, id, text, true, keys);
    let key = |action: &str, text: &str| MenuItem::with_id(app, format!("key:{action}"), text, false, None::<&str>);
    let sep = || P::separator(app);
    // macOS fills the Window menu (Fill, Center, Move & Resize, the window list) once it knows which menu that is.
    let window = Submenu::with_items(app, "Window", true, &[&P::minimize(app, None)?, &P::maximize(app, None)?, &sep()?, &P::bring_all_to_front(app, None)?])?;
    #[cfg(target_os = "macos")]
    window.set_as_windows_menu_for_nsapp()?;
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "LGTM",
                true,
                &[
                    &P::about(app, None, Some(AboutMetadata {
                        name: Some("LGTM".into()),
                        version: Some(app.package_info().version.to_string()),
                        short_version: Some(String::new()), // no "(0.16.0)" after the version: the build number is the same
                        credits: Some("Say LGTM and mean it.\ngithub.com/bukuwarung/lgtm".into()),
                        copyright: Some("© 2026 PT Buku Usaha Digital · MIT License".into()),
                        ..Default::default()
                    }))?,
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
                    &item("palette", "Go to…", Some("CmdOrCtrl+K"))?,
                    &item("review-mode", "Start Review Mode", Some("CmdOrCtrl+Shift+R"))?,
                    &sep()?,
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
                    &item("recent", "Recently Viewed", Some("CmdOrCtrl+Y"))?,
                    &sep()?,
                    &item("refresh", "Refresh", Some("CmdOrCtrl+R"))?,
                    &item("reload", "Reload LGTM", Some("CmdOrCtrl+Alt+R"))?,
                    &sep()?,
                    &item("inbox", "Inbox", Some("CmdOrCtrl+Shift+I"))?,
                    &item("toggle-prs", "Show or Hide the List", Some("CmdOrCtrl+Shift+L"))?,
                    &key("index", "Show or Hide the Index")?,
                    &sep()?,
                    &key("whitespace", "Ignore Whitespace")?, &key("threads", "Show or Hide Threads")?, &key("myThreads", "Your Threads")?,
                    &key("ownFiles", "Only Files You Own")?, &key("githubDev", "Open in github.dev")?,
                    &sep()?,
                    &item("text-bigger", "Bigger Text", Some("CmdOrCtrl+="))?,
                    &item("text-smaller", "Smaller Text", Some("CmdOrCtrl+-"))?,
                    &item("text-reset", "Actual Size", Some("CmdOrCtrl+0"))?,
                    &sep()?,
                    &P::fullscreen(app, None)?,
                ],
            )?,
            // The review page's actions, each with its key from Settings → Keyboard shortcuts (set by the page:
            // commands.rs menu_keys) and greyed out off a PR. Picking one presses that key for you.
            &Submenu::with_items(
                app,
                "Go",
                true,
                &[
                    &key("nextFile", "Next File")?, &key("prevFile", "Previous File")?, &key("nextUnviewed", "Next Unviewed File")?,
                    &sep()?,
                    &key("nextChange", "Next Change")?, &key("prevChange", "Previous Change")?,
                    &key("nextThread", "Next Thread")?, &key("prevThread", "Previous Thread")?, &key("agentDraft", "Next Agent Draft")?,
                    &sep()?,
                    &key("docCode", "Specs ↔ Code")?, &key("usages", "Where It's Used")?,
                    &sep()?,
                    &key("prevCommit", "Previous Commit")?, &key("nextCommit", "Next Commit")?, &key("newCommits", "Commits Since Your Review")?,
                    &sep()?,
                    &key("nextPR", "Next in the List")?, &key("prevPR", "Previous in the List")?,
                    &key("stackPrev", "Previous in the Stack")?, &key("stackNext", "Next in the Stack")?,
                    &key("skip", "Skip (Review Mode)")?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Review",
                true,
                &[
                    &key("finish", "Finish Review…")?, &key("approve", "Approve…")?,
                    &sep()?,
                    &key("viewed", "Mark File Viewed")?, &key("fileComment", "Comment on File…")?, &key("comment", "Comment on Line…")?,
                    &key("quoteReply", "Quote in a Reply")?, &key("react", "React 👍")?, &key("editComment", "Edit Your Comment…")?,
                    &sep()?,
                    &key("merge", "Merge…")?, &key("prActions", "Close, Reopen or Draft…")?, &key("ready", "Ready for Review")?,
                    &key("updateBranch", "Update Branch")?, &key("changeBase", "Change Base…")?, &key("revertCommit", "Revert Commit…")?,
                    &key("fixedAll", "Reply \"Fixed in\" and Resolve")?,
                    &sep()?,
                    &key("assign", "Assign…")?, &key("milestone", "Milestone…")?, &key("subscribe", "Subscribe or Unsubscribe")?,
                    &key("lock", "Lock or Unlock Conversation")?,
                    &sep()?,
                    &key("agents", "Coding Agents…")?, &key("agentSession", "Agent Review Session")?, &key("askQa", "Ask QA…")?,
                ],
            )?,
            &window,
            &Submenu::with_items(
                app,
                "Help",
                true,
                &[&item("shortcuts", "Keyboard Shortcuts", None)?, &sep()?, &item("help", "LGTM on GitHub", None)?, &item("diagnostics", "Copy Diagnostics", None)?],
            )?,
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    adopt_login_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init()) // web links open in the default browser
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init()) // lgtm://<owner>/<repo>/pull/<n>
        // window size and position, remembered; not whether it shows (it opens hidden: below)
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE).build())
        // The window opens hidden and the page shows it once it has drawn, in its theme (platform.ts), so a dark app
        // never flashes white; if the page can't, it shows anyway after 3 seconds.
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    let _ = w.show();
                });
            }
            Ok(())
        })
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
            commands::gh_accounts,
            commands::glab_accounts,
            commands::glab_token,
            commands::agents,
            commands::slack_emoji,
            commands::jira_move,
            commands::jira_statuses,
            commands::jira_priorities,
            commands::jira_create,
            commands::slack_presence,
            commands::slack_status,
            commands::slack_notify,
            commands::slack_post,
            commands::slack_done,
            commands::slack_delete,
            commands::agent_session,
            commands::slack_request,
            commands::slack_asked,
            commands::slack_reply,
            commands::slack_sent,
            commands::save_media,
            commands::download_media,
            commands::open_media,
            commands::copy_media,
            commands::slack_channel,
            commands::slack_qa,
            commands::slack_threads,
            commands::slack_people_get,
            commands::slack_people_find,
            commands::slack_people_save,
            commands::export_settings,
            commands::claude_sessions,
            commands::clipboard_pr,
            commands::copy_text,
            commands::set_tray,
            commands::menu_keys,
            commands::display_prefs,
            commands::self_update,
            commands::agent_text,
            commands::agent_skill,
            commands::agent_mod,
            commands::agent_outbox,
            commands::archive_session,
            commands::claude_session,
            commands::notify,
        ])
        .run(tauri::generate_context!())
        .expect("error while running lgtm");
}
