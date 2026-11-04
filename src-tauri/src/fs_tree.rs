use serde::Serialize;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const DEFAULT_IGNORE_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    ".gradle",
    "vendor",
];

/// 超过此文件数时改为懒加载（只返回顶层 + 一层）
pub const TREE_NODE_LIMIT: usize = 60_000;

#[derive(Debug, Serialize, Clone)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub size: u64,
    #[serde(rename = "modified")]
    pub modified: Option<u64>,
    /// 子项数量；目录在懒加载下用 -1 表示"未展开"
    pub children: Option<Vec<TreeNode>>,
}

fn meta_of(path: &Path) -> (u64, Option<u64>) {
    match std::fs::metadata(path) {
        Ok(m) => {
            let modified = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);
            (m.len(), modified)
        }
        Err(_) => (0, None),
    }
}

/// 只列一层目录（懒加载）
#[tauri::command]
pub fn list_dir(dir: String) -> Result<Vec<TreeNode>, String> {
    let p = PathBuf::from(&dir);
    if !p.is_dir() {
        return Err(format!("不是目录: {dir}"));
    }
    let mut dirs: Vec<TreeNode> = Vec::new();
    let mut files: Vec<TreeNode> = Vec::new();

    let rd = std::fs::read_dir(&p).map_err(|e| format!("读取目录失败 {dir}: {e}"))?;
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let (size, modified) = meta_of(&path);
        let node = TreeNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            size,
            modified,
            children: None,
        };
        if is_dir {
            dirs.push(node);
        } else {
            files.push(node);
        }
    }
    let by_name = |a: &TreeNode, b: &TreeNode| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
    };
    dirs.sort_by(by_name);
    files.sort_by(by_name);

    // 过滤明显的噪声目录
    dirs.retain(|d| !DEFAULT_IGNORE_DIRS.contains(&d.name.as_str()));

    let mut out = dirs;
    out.extend(files);
    Ok(out)
}

/// 递归扫描整棵树，带节点上限
#[tauri::command]
pub fn list_tree(root: String, show_hidden: Option<bool>) -> Result<TreeNode, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("不是目录: {root}"));
    }
    let show_hidden = show_hidden.unwrap_or(false);

    let mut count = 0usize;
    let tree = build_tree(&root_path, &mut count, show_hidden, true);
    Ok(tree)
}

fn build_tree(path: &Path, count: &mut usize, show_hidden: bool, is_root: bool) -> TreeNode {
    let (size, modified) = meta_of(path);
    let name = if is_root {
        path.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string())
    } else {
        path.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
    };

    let mut dirs: Vec<TreeNode> = Vec::new();
    let mut files: Vec<TreeNode> = Vec::new();

    if *count < TREE_NODE_LIMIT {
        if let Ok(rd) = std::fs::read_dir(path) {
            for entry in rd.flatten() {
                let p = entry.path();
                let fname = entry.file_name().to_string_lossy().to_string();
                if !show_hidden && fname.starts_with('.') && fname != ".env" {
                    continue;
                }
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                if is_dir && DEFAULT_IGNORE_DIRS.contains(&fname.as_str()) {
                    continue;
                }
                *count += 1;
                if *count > TREE_NODE_LIMIT {
                    break;
                }
                if is_dir {
                    dirs.push(build_tree(&p, count, show_hidden, false));
                } else {
                    let (sz, md) = meta_of(&p);
                    files.push(TreeNode {
                        name: fname,
                        path: p.to_string_lossy().to_string(),
                        is_dir: false,
                        size: sz,
                        modified: md,
                        children: None,
                    });
                }
            }
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);

    TreeNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: true,
        size,
        modified,
        children: Some(dirs),
    }
}

/// 收集目录下所有文件路径（供跨文件搜索用）
pub fn walk_files(root: &Path, max_files: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() {
                !DEFAULT_IGNORE_DIRS.contains(&name.as_ref())
            } else {
                true
            }
        });
    for entry in walker.flatten() {
        if entry.file_type().is_file() {
            out.push(entry.into_path());
            if out.len() >= max_files {
                break;
            }
        }
    }
    out
}
