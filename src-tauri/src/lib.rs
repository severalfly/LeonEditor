mod config;
mod document;
mod encoding;
mod fs_tree;
mod search;

use config::{AppPaths, AppState};
use std::sync::Mutex;

/// 收集启动时命令行里的文件路径参数（用于"用 Leon Editor 打开"）
fn startup_files() -> Vec<String> {
    let mut out = Vec::new();
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let p = std::path::Path::new(&arg);
        if p.exists() {
            out.push(dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
                .to_string_lossy()
                .to_string());
        }
    }
    out
}

#[tauri::command]
fn startup_args() -> Vec<String> {
    startup_files()
}

/// 前端日志落盘（便携版排查用）：<exe目录>\log\frontend.log
#[tauri::command]
fn log_frontend(level: String, msg: String) -> Result<(), String> {
    use std::io::Write;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("no exe dir")?.join("log");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("frontend.log");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "[{ts}] [{level}] {msg}").map_err(|e| e.to_string())?;
    Ok(())
}

/// 把 panic 信息写进 exe 同目录的 panic.log（便携版无控制台时排查用）
fn install_panic_logger() {
    std::panic::set_hook(Box::new(|info| {
        let exe = std::env::current_exe().unwrap_or_default();
        let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let log_path = dir.join("panic.log");
        let msg = format!(
            "[{}] PANIC: {}\n",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            info
        );
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let _ = f.write_all(msg.as_bytes());
        }
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 便携版没有控制台，把 panic 信息写到文件便于排查
    install_panic_logger();

    let paths = AppPaths::resolve();
    let state = AppState {
        paths,
        settings: Mutex::new(config::EditorSettings::default()),
        session: Mutex::new(config::SessionState::default()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 文档
            document::read_text_file,
            document::write_text_file,
            document::list_encodings,
            document::convert_encoding,
            document::path_exists,
            // 目录树
            fs_tree::list_dir,
            fs_tree::list_tree,
            // 搜索
            search::search_in_folder,
            search::replace_in_files,
            // 配置
            config::get_app_info,
            config::load_settings,
            config::save_settings,
            config::load_session,
            config::save_session,
            config::write_draft,
            config::read_draft,
            config::delete_draft,
            config::prune_drafts,
            config::list_system_fonts,
            // 启动参数
            startup_args,
            log_frontend,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
