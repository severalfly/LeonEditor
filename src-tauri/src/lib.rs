mod config;
mod document;
mod encoding;
mod fs_tree;
mod search;

use config::{AppPaths, AppState};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 一个启动参数：可能是文件，也可能是文件夹
#[derive(Debug, Clone, Serialize)]
pub struct StartupArg {
    pub path: String,
    pub is_dir: bool,
}

/// 从参数列表里挑出真实存在的路径（跳过 -开头的开关）
fn collect_args<I, S>(args: I) -> Vec<StartupArg>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut out = Vec::new();
    for arg in args {
        let a = arg.as_ref();
        if a.is_empty() || a.starts_with('-') {
            continue;
        }
        let p = std::path::Path::new(a);
        if p.exists() {
            let canon = dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
            out.push(StartupArg {
                path: canon.to_string_lossy().to_string(),
                is_dir: canon.is_dir(),
            });
        }
    }
    out
}

/// 首次启动时的命令行参数
#[tauri::command]
fn startup_args() -> Vec<StartupArg> {
    collect_args(std::env::args().skip(1))
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

/// 命令行里是否带了 --new-instance（强制开一个独立实例，跳过单实例检查）
fn wants_new_instance() -> bool {
    std::env::args().any(|a| a == "--new-instance" || a == "-new-instance")
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

    // 单实例插件必须第一个注册。
    // 带 --new-instance 时不注册，允许并行开多个独立窗口（对比文件时用得上）。
    let mut builder = tauri::Builder::default();

    if !wants_new_instance() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 第二个实例启动：把参数交给已在运行的实例，然后自己退出
            let args = collect_args(argv.iter().skip(1));

            // 把窗口拉到前台（可能被最小化或压在别的窗口后面）
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }

            // 通知前端打开这些文件
            if !args.is_empty() {
                let _ = app.emit("leon:open-files", args);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
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
            document::create_file,
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
