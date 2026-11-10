use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::encoding::{self, EncodingKind};

#[derive(Debug, Serialize)]
pub struct FileContent {
    pub path: String,
    pub name: String,
    pub text: String,
    /// 编码名，如 "utf-8" / "gbk"
    pub encoding: String,
    /// 探测到的编码是否高置信（false 表示用户可能需要手动切换）
    pub encoding_confident: bool,
    pub eol: String,
    pub mixed_eol: bool,
    pub bom: bool,
    pub binary: bool,
    pub size: u64,
    pub read_only: bool,
    pub modified: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct SaveResult {
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

pub fn file_modified_millis(p: &Path) -> Option<u64> {
    std::fs::metadata(p)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

fn is_read_only(p: &Path) -> bool {
    std::fs::metadata(p)
        .map(|m| m.permissions().readonly())
        .unwrap_or(false)
}

#[tauri::command]
pub fn read_text_file(path: String, encoding: Option<String>) -> Result<FileContent, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {path}"));
    }
    if p.is_dir() {
        return Err(format!("这是目录，不是文件: {path}"));
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("读取失败 {path}: {e}"))?;
    let size = bytes.len() as u64;

    let forced = encoding.as_deref().and_then(EncodingKind::from_str_opt);
    let decoded = encoding::decode_bytes(&bytes, forced);

    // 置信度：BOM 或显式指定视为高置信；UTF-8 严格通过也高置信
    let confident = forced.is_some()
        || decoded.bom
        || decoded.encoding == EncodingKind::Utf8
        || decoded.encoding == EncodingKind::Utf16Le
        || decoded.encoding == EncodingKind::Utf16Be;

    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    Ok(FileContent {
        text: decoded.text,
        encoding: decoded.encoding.as_str().to_string(),
        encoding_confident: confident,
        eol: decoded.eol.clone(),
        mixed_eol: decoded.mixed_eol,
        bom: decoded.bom,
        binary: decoded.binary,
        size,
        read_only: is_read_only(&p),
        modified: file_modified_millis(&p),
        name,
        path: p.to_string_lossy().to_string(),
    })
}

#[derive(Debug, Deserialize)]
pub struct SavePayload {
    pub path: String,
    pub text: String,
    pub encoding: Option<String>,
    pub eol: Option<String>,
    /// 期望的文件修改时间；若磁盘上的修改时间不同，返回冲突错误
    pub expected_modified: Option<u64>,
}

#[tauri::command]
pub fn write_text_file(payload: SavePayload) -> Result<SaveResult, String> {
    let p = PathBuf::from(&payload.path);
    if p.is_dir() {
        return Err("目标是目录".into());
    }

    // 外部修改冲突检测
    if let Some(expected) = payload.expected_modified {
        if let Some(actual) = file_modified_millis(&p) {
            // 允许 1 秒内的抖动
            if actual > expected + 1000 {
                return Err("CONFLICT".into());
            }
        }
    }

    let enc = payload
        .encoding
        .as_deref()
        .and_then(EncodingKind::from_str_opt)
        .unwrap_or(EncodingKind::Utf8);

    // 统一换行符
    let mut text = payload.text;
    if let Some(eol) = payload.eol.as_deref() {
        let normalized: String = text.replace("\r\n", "\n").replace('\r', "\n");
        text = match eol {
            "crlf" => normalized.replace('\n', "\r\n"),
            "cr" => normalized.replace('\n', "\r"),
            _ => normalized,
        };
    }

    // 原子写入：先写临时文件再 rename
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
        }
    }

    let bytes = encoding::encode_text(&text, enc);
    let tmp = p.with_extension(format!(
        "{}.letmp",
        p.extension()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
    ));

    std::fs::write(&tmp, &bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;
    // Windows 上 rename 到已存在文件会失败，先删目标
    if p.exists() {
        // 保留原文件权限
        std::fs::remove_file(&p).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("无法覆盖原文件（可能被占用或只读）: {e}")
        })?;
    }
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("替换文件失败: {e}")
    })?;

    Ok(SaveResult {
        path: p.to_string_lossy().to_string(),
        size: bytes.len() as u64,
        modified: file_modified_millis(&p),
    })
}

#[derive(Debug, Serialize)]
pub struct EncodingOption {
    pub id: String,
    pub label: String,
}

#[tauri::command]
pub fn list_encodings() -> Vec<EncodingOption> {
    [
        (EncodingKind::Utf8, "UTF-8"),
        (EncodingKind::Utf8Bom, "UTF-8 with BOM"),
        (EncodingKind::Gbk, "GBK / GB2312"),
        (EncodingKind::Big5, "Big5"),
        (EncodingKind::Utf16Le, "UTF-16 LE"),
        (EncodingKind::Utf16Be, "UTF-16 BE"),
        (EncodingKind::Latin1, "Windows-1252 / Latin1"),
    ]
    .into_iter()
    .map(|(k, l)| EncodingOption {
        id: k.as_str().to_string(),
        label: l.to_string(),
    })
    .collect()
}

/// 转换文件编码（重新以目标编码写盘）
#[tauri::command]
pub fn convert_encoding(path: String, from: String, to: String) -> Result<SaveResult, String> {
    let p = PathBuf::from(&path);
    let bytes = std::fs::read(&p).map_err(|e| format!("读取失败: {e}"))?;
    let from_enc = EncodingKind::from_str_opt(&from).ok_or("未知的源编码")?;
    let to_enc = EncodingKind::from_str_opt(&to).ok_or("未知的目标编码")?;
    let decoded = encoding::decode_bytes(&bytes, Some(from_enc));
    let out = encoding::encode_text(&decoded.text, to_enc);
    std::fs::write(&p, &out).map_err(|e| format!("写入失败: {e}"))?;
    Ok(SaveResult {
        path: p.to_string_lossy().to_string(),
        size: out.len() as u64,
        modified: file_modified_millis(&p),
    })
}

/// 系统剪贴板之外的"快速路径"：判断文件是否存在
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 在指定目录里新建一个空文件。
///
/// 名字冲突时自动加序号（新建文件.txt → 新建文件-2.txt → …），
/// 用 create_new 保证不会覆盖已有文件（并发/重名都安全）。
#[tauri::command]
pub fn create_file(dir: String, base_name: String) -> Result<String, String> {
    let d = PathBuf::from(&dir);
    if !d.is_dir() {
        return Err(format!("目录不存在: {dir}"));
    }

    let base = base_name.trim();
    let base = if base.is_empty() { "新建文件.txt" } else { base };

    // 拆成主名 + 扩展名，序号插在主名后面
    let (stem, ext) = match base.rfind('.') {
        Some(i) if i > 0 => (&base[..i], &base[i..]),
        _ => (base, ""),
    };

    for n in 1..=9999u32 {
        let name = if n == 1 {
            format!("{stem}{ext}")
        } else {
            format!("{stem}-{n}{ext}")
        };
        let p = d.join(&name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(_) => {
                let canon = dunce::canonicalize(&p).unwrap_or(p);
                return Ok(canon.to_string_lossy().to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("创建文件失败 {name}: {e}")),
        }
    }
    Err("同名文件过多，无法创建".to_string())
}
