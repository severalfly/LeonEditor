use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// 便携模式标志文件：与 exe 同目录存在 portable.dat 即启用
const PORTABLE_FLAG: &str = "portable.dat";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorSettings {
    pub theme: String,
    pub font_family: String,
    pub font_size: f32,
    pub tab_size: u32,
    pub insert_spaces: bool,
    pub word_wrap: bool,
    pub show_minimap: bool,
    pub show_line_numbers: bool,
    pub highlight_current_line: bool,
    pub auto_save: bool,
    pub restore_session: bool,
    pub show_hidden_files: bool,
    pub trim_trailing_whitespace: bool,
    pub ensure_final_newline: bool,
    pub search_include: String,
    pub search_exclude: String,
    pub sidebar_width: u32,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            font_family: "Cascadia Code, Consolas, Microsoft YaHei, monospace".into(),
            font_size: 14.0,
            tab_size: 4,
            insert_spaces: true,
            word_wrap: true,
            show_minimap: true,
            show_line_numbers: true,
            highlight_current_line: true,
            auto_save: false,
            restore_session: true,
            show_hidden_files: false,
            trim_trailing_whitespace: false,
            ensure_final_newline: false,
            search_include: String::new(),
            search_exclude: String::new(),
            sidebar_width: 260,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionState {
    pub open_files: Vec<SessionFile>,
    pub active_path: Option<String>,
    pub root_folder: Option<String>,
    /// 未保存的草稿（含从未落盘的新文件）。重启后还原到内存，不写回原文件。
    #[serde(default)]
    pub drafts: Vec<DraftFile>,
    /// 上次激活的草稿 id（active_path 为空时使用）
    #[serde(default)]
    pub active_draft_id: Option<String>,
}

/// 一份未保存内容的快照。正文存在 drafts/<id>.txt，元信息存 session.json，
/// 避免把大段文本塞进 json。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftFile {
    /// 稳定 id（用于草稿文件名）
    pub id: String,
    /// 原文件路径；None 表示从未保存过的新文件
    pub path: Option<String>,
    /// 显示名
    pub name: String,
    pub encoding: String,
    pub eol: String,
    pub cursor_line: u32,
    pub cursor_col: u32,
    pub scroll_top: u32,
    /// 是否从未落盘的 untitled
    pub untitled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFile {
    pub path: String,
    pub cursor_line: u32,
    pub cursor_col: u32,
    pub scroll_top: u32,
}

pub struct AppPaths {
    pub config_dir: PathBuf,
    pub portable: bool,
    pub exe_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve() -> Self {
        let exe = std::env::current_exe().unwrap_or_default();
        let exe_dir = exe
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        // 便携判定：exe 同目录存在 portable.dat
        let portable = exe_dir.join(PORTABLE_FLAG).exists();

        let config_dir = if portable {
            exe_dir.join("data")
        } else {
            dirs::config_dir()
                .map(|d| d.join("LeonEditor"))
                .unwrap_or_else(|| exe_dir.join("data"))
        };

        let _ = std::fs::create_dir_all(&config_dir);
        Self {
            config_dir,
            portable,
            exe_dir,
        }
    }

    pub fn settings_file(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    pub fn session_file(&self) -> PathBuf {
        self.config_dir.join("session.json")
    }

    pub fn drafts_dir(&self) -> PathBuf {
        self.config_dir.join("drafts")
    }
}

pub struct AppState {
    pub paths: AppPaths,
    pub settings: Mutex<EditorSettings>,
    pub session: Mutex<SessionState>,
}

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub version: String,
    pub config_dir: String,
    pub portable: bool,
    pub exe_dir: String,
}

#[tauri::command]
pub fn get_app_info(state: tauri::State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        config_dir: state.paths.config_dir.to_string_lossy().to_string(),
        portable: state.paths.portable,
        exe_dir: state.paths.exe_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn load_settings(state: tauri::State<'_, AppState>) -> EditorSettings {
    let f = state.paths.settings_file();
    if let Ok(s) = std::fs::read_to_string(&f) {
        if let Ok(v) = serde_json::from_str::<EditorSettings>(&s) {
            *state.settings.lock().unwrap() = v.clone();
            return v;
        }
    }
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(
    state: tauri::State<'_, AppState>,
    settings: EditorSettings,
) -> Result<(), String> {
    let f = state.paths.settings_file();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&f, json).map_err(|e| format!("保存设置失败: {e}"))?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

#[tauri::command]
pub fn load_session(state: tauri::State<'_, AppState>) -> SessionState {
    let f = state.paths.session_file();
    if let Ok(s) = std::fs::read_to_string(&f) {
        if let Ok(v) = serde_json::from_str::<SessionState>(&s) {
            return v;
        }
    }
    SessionState::default()
}

#[tauri::command]
pub fn save_session(
    state: tauri::State<'_, AppState>,
    session: SessionState,
) -> Result<(), String> {
    let f = state.paths.session_file();
    let json = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    std::fs::write(&f, json).map_err(|e| format!("保存会话失败: {e}"))?;
    *state.session.lock().unwrap() = session;
    Ok(())
}

/* ---------------- 未保存内容（草稿）持久化 ---------------- */

/// 写入一份草稿正文
#[tauri::command]
pub fn write_draft(
    state: tauri::State<'_, AppState>,
    id: String,
    text: String,
) -> Result<(), String> {
    let dir = state.paths.drafts_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建草稿目录失败: {e}"))?;
    // id 只允许安全字符，避免路径穿越
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = dir.join(format!("{safe}.txt"));
    std::fs::write(&path, text).map_err(|e| format!("写入草稿失败: {e}"))
}

/// 读取一份草稿正文
#[tauri::command]
pub fn read_draft(state: tauri::State<'_, AppState>, id: String) -> Result<String, String> {
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = state.paths.drafts_dir().join(format!("{safe}.txt"));
    std::fs::read_to_string(&path).map_err(|e| format!("读取草稿失败: {e}"))
}

/// 删除一份草稿（保存成功或标签关闭后调用）
#[tauri::command]
pub fn delete_draft(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let path = state.paths.drafts_dir().join(format!("{safe}.txt"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("删除草稿失败: {e}"))?;
    }
    Ok(())
}

/// 清理所有草稿文件（会话里没有引用的残留）
#[tauri::command]
pub fn prune_drafts(
    state: tauri::State<'_, AppState>,
    keep_ids: Vec<String>,
) -> Result<usize, String> {
    let dir = state.paths.drafts_dir();
    if !dir.exists() {
        return Ok(0);
    }
    let keep: std::collections::HashSet<String> = keep_ids
        .into_iter()
        .map(|id| {
            id.chars()
                .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                .collect::<String>()
        })
        .collect();

    let mut removed = 0usize;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("txt") {
                continue;
            }
            let stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if !keep.contains(&stem) && std::fs::remove_file(&p).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

/* ---------------- 系统字体枚举 ---------------- */

#[derive(Debug, Serialize)]
pub struct FontInfo {
    pub name: String,
    /// 是否等宽（适合代码）
    pub monospace: bool,
}

/// 枚举系统已安装字体。
/// Windows 下用 GDI 的 EnumFontFamiliesEx 枚举实际可用字体族（不需要外部程序、
/// 也不需要 winreg 依赖），能天然拿到正确的字体显示名。
#[tauri::command]
pub fn list_system_fonts() -> Vec<FontInfo> {
    #[cfg(target_os = "windows")]
    {
        windows_fonts()
    }

    #[cfg(not(target_os = "windows"))]
    {
        vec![
            FontInfo {
                name: "monospace".into(),
                monospace: true,
            },
            FontInfo {
                name: "sans-serif".into(),
                monospace: false,
            },
        ]
    }
}

#[cfg(target_os = "windows")]
fn windows_fonts() -> Vec<FontInfo> {
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    #[repr(C)]
    struct LogFontW {
        lf_height: i32,
        lf_width: i32,
        lf_escaperment: i32,
        lf_orientation: i32,
        lf_weight: i32,
        lf_italic: u8,
        lf_underline: u8,
        lf_strikeout: u8,
        lf_charset: u8,
        lf_out_precision: u8,
        lf_clip_precision: u8,
        lf_quality: u8,
        lf_pitch_and_family: u8,
        lf_face_name: [u16; 32],
        lf_full_name: [u16; 64],
        lf_style: [u16; 32],
    }

    #[repr(C)]
    struct NewTextMetricExW {
        tm_height: i32,
        tm_ascent: i32,
        tm_descent: i32,
        tm_internal_leading: i32,
        tm_external_leading: i32,
        tm_ave_char_width: i32,
        tm_max_char_width: i32,
        tm_weight: i32,
        tm_overhang: i32,
        tm_digitized_aspect_x: i32,
        tm_digitized_aspect_y: i32,
        tm_first_char: u8,
        tm_last_char: u8,
        tm_default_char: u8,
        tm_break_char: u8,
        tm_italic: u8,
        tm_underlined: u8,
        tm_struck_out: u8,
        tm_pitch_and_family: u8,
        tm_char_set: u8,
        ntme_xxxx: [u8; 48],
    }

    #[repr(C)]
    struct SizeW {
        cx: i32,
        cy: i32,
    }

    type EnumFontProc =
        unsafe extern "system" fn(*const LogFontW, *const NewTextMetricExW, u32, isize) -> i32;

    #[link(name = "gdi32")]
    extern "system" {
        fn EnumFontFamiliesExW(
            hdc: *mut core::ffi::c_void,
            lp_logfont: *const LogFontW,
            lp_enum_font_proc: EnumFontProc,
            l_param: isize,
            dw_flags: u32,
        ) -> i32;
        fn GetDeviceCaps(hdc: *mut core::ffi::c_void, index: i32) -> i32;
        fn CreateFontW(
            c_height: i32,
            c_width: i32,
            c_escaperment: i32,
            c_orientation: i32,
            c_weight: i32,
            b_italic: u32,
            b_underline: u32,
            b_strike_out: u32,
            i_char_set: u32,
            i_out_precision: u32,
            i_clip_precision: u32,
            i_quality: u32,
            i_pitch_and_family: u32,
            psz_face_name: *const u16,
        ) -> *mut core::ffi::c_void;
        fn SelectObject(hdc: *mut core::ffi::c_void, h: *mut core::ffi::c_void)
            -> *mut core::ffi::c_void;
        fn DeleteObject(h: *mut core::ffi::c_void) -> i32;
        fn GetTextExtentPoint32W(
            hdc: *mut core::ffi::c_void,
            lp_string: *const u16,
            c: i32,
            lp_size: *mut SizeW,
        ) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetDC(hwnd: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
        fn ReleaseDC(hwnd: *mut core::ffi::c_void, hdc: *mut core::ffi::c_void) -> i32;
    }

    const DEFAULT_CHARSET: u8 = 1;
    const LF_FACESIZE: usize = 32;
    const LOGPIXELSY: i32 = 90;

    /// 回调上下文：结果表 + 用于实测字体宽度的 DC
    struct Ctx {
        map: RefCell<BTreeMap<String, bool>>,
        hdc: *mut core::ffi::c_void,
    }

    /// 实测 iiii 与 MMMM 的渲染宽度是否相同 —— 判断等宽最可靠的方法
    unsafe fn measure_is_mono(hdc: *mut core::ffi::c_void, face: &str) -> bool {
        let wide: Vec<u16> = face.encode_utf16().chain(std::iter::once(0)).collect();
        let hfont = CreateFontW(
            0, 0, 0, 0, 400, 0, 0, 0, DEFAULT_CHARSET as u32, 0, 0, 0, 0,
            wide.as_ptr(),
        );
        if hfont.is_null() {
            return false;
        }
        let old = SelectObject(hdc, hfont);
        let narrow: Vec<u16> = "iiiiiiiiii".encode_utf16().collect();
        let broad: Vec<u16> = "MMMMMMMMMM".encode_utf16().collect();
        let mut sz_n = SizeW { cx: 0, cy: 0 };
        let mut sz_b = SizeW { cx: 0, cy: 0 };
        let ok1 = GetTextExtentPoint32W(hdc, narrow.as_ptr(), narrow.len() as i32, &mut sz_n);
        let ok2 = GetTextExtentPoint32W(hdc, broad.as_ptr(), broad.len() as i32, &mut sz_b);
        if !old.is_null() {
            SelectObject(hdc, old);
        }
        DeleteObject(hfont);
        ok1 != 0 && ok2 != 0 && sz_n.cx > 0 && sz_n.cx == sz_b.cx
    }

    unsafe extern "system" fn enum_cb(
        logfont: *const LogFontW,
        ntme: *const NewTextMetricExW,
        _font_type: u32,
        lparam: isize,
    ) -> i32 {
        let ctx = &*(lparam as *const Ctx);

        // 读字体名（UTF-16，以 0 结尾）
        let face = &(*logfont).lf_face_name;
        let mut len = 0usize;
        while len < LF_FACESIZE && face[len] != 0 {
            len += 1;
        }
        let name = String::from_utf16_lossy(&face[..len]).trim().to_string();

        // 跳过空名和 @ 开头的竖排别名
        if name.is_empty() || name.starts_with('@') {
            return 1;
        }

        // 快路径：字体自带 FIXED_PITCH 标记
        let flagged = ((*ntme).tm_pitch_and_family & 0x01) != 0;

        // 慢路径：名字像代码字体时才实测宽度，避免 360 个字体全测拖慢启动
        let lower = name.to_lowercase();
        let looks_mono = [
            "mono", "consol", "courier", "code", "hack", "fixedsys",
            "terminal", "menlo", "inconsolata", "fira", "jetbrains",
            "cascadia", "dejavu", "ubuntu",
        ]
        .iter()
        .any(|k| lower.contains(k));

        let mono = flagged || (looks_mono && measure_is_mono(ctx.hdc, &name));

        let mut m = ctx.map.borrow_mut();
        let e = m.entry(name).or_insert(false);
        if mono {
            *e = true;
        }
        1 // 继续枚举
    }

    unsafe {
        let hdc = GetDC(std::ptr::null_mut());
        if hdc.is_null() {
            return vec![];
        }
        let _ = GetDeviceCaps(hdc, LOGPIXELSY);

        let lf = LogFontW {
            lf_height: 0,
            lf_width: 0,
            lf_escaperment: 0,
            lf_orientation: 0,
            lf_weight: 0,
            lf_italic: 0,
            lf_underline: 0,
            lf_strikeout: 0,
            lf_charset: DEFAULT_CHARSET,
            lf_out_precision: 0,
            lf_clip_precision: 0,
            lf_quality: 0,
            lf_pitch_and_family: 0,
            lf_face_name: [0; LF_FACESIZE],
            lf_full_name: [0; 64],
            lf_style: [0; 32],
        };

        let ctx = Ctx {
            map: RefCell::new(BTreeMap::new()),
            hdc,
        };

        EnumFontFamiliesExW(hdc, &lf, enum_cb, &ctx as *const Ctx as isize, 0);
        ReleaseDC(std::ptr::null_mut(), hdc);

        let mut out: Vec<FontInfo> = ctx
            .map
            .borrow()
            .iter()
            .filter(|(n, _)| n.len() < 80)
            .map(|(name, mono)| FontInfo {
                name: name.clone(),
                monospace: *mono,
            })
            .collect();

        // 等宽优先，其余按字母序
        out.sort_by(|a, b| {
            b.monospace
                .cmp(&a.monospace)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        out
    }
}
