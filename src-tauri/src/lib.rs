use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};

#[derive(Serialize, Deserialize)]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

#[derive(Default)]
struct State {
    pending: Mutex<Vec<String>>,
    allowed: Mutex<HashSet<PathBuf>>,
    storage: Mutex<()>,
    exit_approved: AtomicBool,
}
const LIMIT: u64 = 8 * 1024 * 1024;
fn supported(p: &Path) -> bool {
    matches!(
        p.extension()
            .and_then(|x| x.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("mmd" | "mermaid" | "md")
    )
}
fn grant(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    let state = app.state::<State>();
    if paths.iter().any(|p| !supported(p)) {
        let _ = app.emit(
            "file-error",
            "One or more files are not supported. Use .mmd, .mermaid, or .md.",
        );
    }
    let paths: Vec<_> = paths.into_iter().filter(|p| supported(p)).collect();
    state.allowed.lock().unwrap().extend(paths.clone());
    state
        .pending
        .lock()
        .unwrap()
        .extend(paths.iter().map(|p| p.to_string_lossy().into_owned()));
    let _ = app.emit("files-pending", ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
#[tauri::command]
fn pending_files(state: tauri::State<State>) -> Vec<String> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}
#[tauri::command]
async fn choose_files(app: tauri::AppHandle) -> Vec<String> {
    let files = rfd::AsyncFileDialog::new()
        .add_filter("Mermaid / Markdown", &["mmd", "mermaid", "md"])
        .pick_files()
        .await;
    let paths: Vec<PathBuf> = files
        .unwrap_or_default()
        .iter()
        .map(|p| p.path().to_path_buf())
        .collect();
    app.state::<State>()
        .allowed
        .lock()
        .unwrap()
        .extend(paths.clone());
    paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}
#[derive(Serialize)]
struct FileData {
    path: String,
    text: String,
}
#[tauri::command]
fn read_file(path: String, state: tauri::State<State>) -> Result<FileData, String> {
    let p = PathBuf::from(&path);
    if !supported(&p) || !state.allowed.lock().unwrap().contains(&p) {
        return Err("Unauthorized file: reopen it from the file picker.".into());
    }
    let meta = fs::metadata(&p).map_err(|e| format!("File unavailable: {e}"))?;
    if meta.len() > LIMIT {
        return Err("The file exceeds the 8 MiB limit.".into());
    }
    Ok(FileData {
        path,
        text: fs::read_to_string(&p).map_err(|e| e.to_string())?,
    })
}
#[tauri::command]
fn reveal_in_folder(path: String, state: tauri::State<State>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !state.allowed.lock().unwrap().contains(&p) {
        return Err("Unauthorized file.".into());
    }
    if !p.exists() {
        return Err("File not found on disk.".into());
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-R")
        .arg(&p)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", p.display()))
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    if let Some(parent) = p.parent() {
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid path")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn write_file(
    path: String,
    text: String,
    expected: String,
    state: tauri::State<State>,
) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !state.allowed.lock().unwrap().contains(&p)
        || !matches!(
            p.extension()
                .and_then(|x| x.to_str())
                .map(str::to_lowercase)
                .as_deref(),
            Some("mmd" | "mermaid")
        )
    {
        return Err("Unauthorized save: use Save As.".into());
    }
    checked_write(&p, &text, &expected)
}
fn checked_write(p: &Path, text: &str, expected: &str) -> Result<(), String> {
    let current =
        fs::read_to_string(p).map_err(|_| "File removed or unreadable: use Save As.")?;
    if current != expected {
        return Err("CONFLICT: The file was modified externally. Reload it or use Save As to keep both versions.".into());
    }
    atomic_write(p, text.as_bytes())
}
#[tauri::command]
async fn save_as(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
    extension: String,
) -> Result<Option<String>, String> {
    if !["mmd", "mermaid", "svg", "png", "pdf"].contains(&extension.as_str()) {
        return Err("Unsupported format".into());
    }
    let file = rfd::AsyncFileDialog::new()
        .set_file_name(&name)
        .add_filter(&extension, &[&extension])
        .save_file()
        .await;
    if let Some(file) = file {
        atomic_write(file.path(), &bytes)?;
        app.state::<State>()
            .allowed
            .lock()
            .unwrap()
            .insert(file.path().to_path_buf());
        Ok(Some(file.path().to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}
fn archive_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("archive.json"))
}
fn window_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("window-state.json"))
}
fn save_window_state(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    if w.is_minimized().unwrap_or(false) {
        return;
    }
    let Ok(pos) = w.outer_position() else {
        return;
    };
    let Ok(size) = w.inner_size() else {
        return;
    };
    if size.width < 320 || size.height < 240 {
        return;
    }
    let state = WindowState {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: w.is_maximized().unwrap_or(false),
    };
    if let Ok(path) = window_state_path(app) {
        if let Ok(bytes) = serde_json::to_vec(&state) {
            let _ = atomic_write(&path, &bytes);
        }
    }
}
fn restore_window_state(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    let Ok(path) = window_state_path(app) else {
        return;
    };
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let Ok(state) = serde_json::from_str::<WindowState>(&text) else {
        return;
    };
    if state.width >= 320 && state.height >= 240 {
        let _ = w.set_size(PhysicalSize::new(state.width, state.height));
    }
    let _ = w.set_position(PhysicalPosition::new(state.x, state.y));
    if state.maximized {
        let _ = w.maximize();
    }
}
fn apply_window_theme(app: &tauri::AppHandle, theme: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let t = if theme == "dark" {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        };
        let _ = w.set_theme(Some(t));
    }
}
#[tauri::command]
fn set_window_theme(app: tauri::AppHandle, theme: String) {
    apply_window_theme(&app, &theme);
}
#[tauri::command]
fn load_archive(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<State>();
    let _lock = state.storage.lock().unwrap();
    let p = archive_path(&app)?;
    if !p.exists() {
        apply_window_theme(&app, "light");
        return Ok(None);
    }
    let text = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let data: serde_json::Value = serde_json::from_str(&text)
        .or_else(|_| {
            let backup = fs::read_to_string(p.with_extension("backup.json")).unwrap_or_default();
            serde_json::from_str(&backup)
        })
        .map_err(|e| format!("Workspace archive and backup unreadable: {e}"))?;
    if let Some(theme) = data["theme"].as_str() {
        apply_window_theme(&app, theme);
    }
    if let Some(docs) = data["documents"].as_array() {
        let mut allowed = state.allowed.lock().unwrap();
        for d in docs {
            if let Some(p) = d["path"].as_str() {
                let path = PathBuf::from(p);
                if supported(&path) {
                    allowed.insert(path);
                }
            }
        }
    }
    Ok(Some(data.to_string()))
}
#[tauri::command]
fn save_archive(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let state = app.state::<State>();
    let _lock = state.storage.lock().unwrap();
    let parsed = serde_json::from_str::<serde_json::Value>(&data).map_err(|e| e.to_string())?;
    if let Some(theme) = parsed["theme"].as_str() {
        apply_window_theme(&app, theme);
    }
    let p = archive_path(&app)?;
    if p.exists() {
        fs::copy(&p, p.with_extension("backup.json")).map_err(|e| e.to_string())?;
    }
    atomic_write(&p, data.as_bytes())
}
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    save_window_state(&app);
    app.state::<State>()
        .exit_approved
        .store(true, Ordering::SeqCst);
    app.exit(0);
}
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(State::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            grant(
                app,
                args.into_iter()
                    .skip(1)
                    .map(|p| {
                        let p = PathBuf::from(p);
                        if p.is_absolute() {
                            p
                        } else {
                            PathBuf::from(&cwd).join(p)
                        }
                    })
                    .collect(),
            );
        }))
        .plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|handle| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
            Menu::with_items(
                handle,
                &[
                    &Submenu::with_items(
                        handle,
                        "Siren",
                        true,
                        &[
                            &PredefinedMenuItem::about(handle, None, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &MenuItem::with_id(
                                handle,
                                "menu_settings",
                                "Settings…",
                                true,
                                Some("CmdOrCtrl+,"),
                            )?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::services(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::hide(handle, None)?,
                            &PredefinedMenuItem::hide_others(handle, None)?,
                            &PredefinedMenuItem::show_all(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::quit(handle, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        handle,
                        "File",
                        true,
                        &[
                            &MenuItem::with_id(
                                handle,
                                "menu_new",
                                "New",
                                true,
                                Some("CmdOrCtrl+N"),
                            )?,
                            &MenuItem::with_id(
                                handle,
                                "menu_new_template",
                                "New from Template…",
                                true,
                                Some("CmdOrCtrl+Shift+N"),
                            )?,
                            &MenuItem::with_id(
                                handle,
                                "menu_open",
                                "Open File…",
                                true,
                                Some("CmdOrCtrl+O"),
                            )?,
                            &PredefinedMenuItem::separator(handle)?,
                            &MenuItem::with_id(
                                handle,
                                "menu_save",
                                "Save",
                                true,
                                Some("CmdOrCtrl+S"),
                            )?,
                            &MenuItem::with_id(
                                handle,
                                "menu_save_as",
                                "Save As…",
                                true,
                                Some("CmdOrCtrl+Shift+S"),
                            )?,
                            &PredefinedMenuItem::separator(handle)?,
                            &MenuItem::with_id(
                                handle,
                                "menu_export",
                                "Export…",
                                true,
                                Some("CmdOrCtrl+E"),
                            )?,
                            &PredefinedMenuItem::separator(handle)?,
                            &MenuItem::with_id(
                                handle,
                                "close_tab",
                                "Close Tab",
                                true,
                                Some("CmdOrCtrl+W"),
                            )?,
                        ],
                    )?,
                    &Submenu::with_items(
                        handle,
                        "Edit",
                        true,
                        &[
                            &PredefinedMenuItem::undo(handle, None)?,
                            &PredefinedMenuItem::redo(handle, None)?,
                            &PredefinedMenuItem::separator(handle)?,
                            &PredefinedMenuItem::cut(handle, None)?,
                            &PredefinedMenuItem::copy(handle, None)?,
                            &PredefinedMenuItem::paste(handle, None)?,
                            &PredefinedMenuItem::select_all(handle, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        handle,
                        "View",
                        true,
                        &[&PredefinedMenuItem::fullscreen(handle, None)?],
                    )?,
                    &Submenu::with_items(
                        handle,
                        "Window",
                        true,
                        &[
                            &PredefinedMenuItem::minimize(handle, None)?,
                            &PredefinedMenuItem::maximize(handle, None)?,
                        ],
                    )?,
                ],
            )
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().as_ref());
        });
    let app = builder
        .invoke_handler(tauri::generate_handler![
            pending_files,
            choose_files,
            read_file,
            reveal_in_folder,
            write_file,
            save_as,
            load_archive,
            save_archive,
            set_window_theme,
            exit_app
        ])
        .setup(|app| {
            restore_window_state(app.handle());
            grant(
                app.handle(),
                std::env::args_os().skip(1).map(PathBuf::from).collect(),
            );
            Ok(())
        })
        .on_window_event(|w, event| match event {
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                grant(w.app_handle(), paths.clone());
            }
            tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::Moved(_)
            | tauri::WindowEvent::CloseRequested { .. } => {
                save_window_state(w.app_handle());
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("Unable to start Siren");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            if !app.state::<State>().exit_approved.load(Ordering::SeqCst) {
                api.prevent_exit();
                let _ = app.emit("exit-requested", ());
            }
        }
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            grant(
                app,
                urls.iter().filter_map(|u| u.to_file_path().ok()).collect(),
            );
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_replace() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("archive.json");
        atomic_write(&p, b"first").unwrap();
        atomic_write(&p, b"second").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"second");
    }
    #[test]
    fn conflicts_do_not_overwrite_external_edits() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("diagram.mmd");
        fs::write(&p, "external").unwrap();
        assert!(checked_write(&p, "draft", "old")
            .unwrap_err()
            .contains("CONFLICT"));
        assert_eq!(fs::read_to_string(&p).unwrap(), "external");
        checked_write(&p, "saved", "external").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "saved");
        fs::remove_file(&p).unwrap();
        assert!(checked_write(&p, "draft", "saved").is_err());
        assert!(!p.exists());
    }
    #[test]
    fn extensions() {
        assert!(supported(Path::new("diagram.MMD")));
        assert!(!supported(Path::new("code.js")));
    }
}
