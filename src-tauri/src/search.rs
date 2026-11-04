use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use grep_matcher::Matcher;

use crate::encoding;
use crate::fs_tree;

/// 单条匹配结果
#[derive(Debug, Serialize, Clone)]
pub struct SearchHit {
    pub path: String,
    /// 相对 root 的路径，便于展示
    pub rel: String,
    /// 行号（1 基）
    pub line: u32,
    /// 列号（1 基）
    pub col: u32,
    /// 该行完整文本（超长截断）
    pub line_text: String,
    /// 匹配在该行文本中的起止（字符下标，0 基）
    pub match_start: u32,
    pub match_end: u32,
}

#[derive(Debug, Serialize)]
pub struct FileHits {
    pub path: String,
    pub rel: String,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub files: Vec<FileHits>,
    pub total_hits: usize,
    pub searched_files: usize,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SearchOptions {
    pub root: String,
    pub query: String,
    pub is_regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    /// 文件名过滤，逗号分隔，如 "*.sql,*.java"
    pub include: Option<String>,
    pub exclude: Option<String>,
    pub max_results: Option<usize>,
    pub max_file_size: Option<u64>,
    /// 给定时只搜这一个文件
    pub single_file: Option<String>,
}

const DEFAULT_MAX_RESULTS: usize = 5000;
const DEFAULT_MAX_FILE_SIZE: u64 = 16 * 1024 * 1024;
const MAX_FILES_SCAN: usize = 200_000;
const LINE_TEXT_LIMIT: usize = 400;

/// 把字面串转义成正则安全的模式
fn escape_regex(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        if "\\^$.|?*+()[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn glob_match(pattern: &str, name: &str) -> bool {
    let n = name.to_lowercase();
    for part in pattern.split(',') {
        let part = part.trim().to_lowercase();
        if part.is_empty() {
            continue;
        }
        let hit = if let Some(suf) = part.strip_prefix('*') {
            n.ends_with(suf)
        } else if let Some(pre) = part.strip_suffix('*') {
            n.starts_with(pre)
        } else {
            n == part || n.ends_with(&format!(".{part}"))
        };
        if hit {
            return true;
        }
    }
    false
}

fn build_matcher(opts: &SearchOptions) -> Result<grep_regex::RegexMatcher, String> {
    let mut b = grep_regex::RegexMatcherBuilder::new();
    b.case_insensitive(!opts.case_sensitive);
    b.line_terminator(None);
    b.multi_line(false);
    b.fixed_strings(!opts.is_regex);

    let pattern = if opts.whole_word {
        if opts.is_regex {
            format!(r"\b(?:{})\b", opts.query)
        } else {
            format!(r"\b{}\b", escape_regex(&opts.query))
        }
    } else if opts.is_regex {
        opts.query.clone()
    } else {
        escape_regex(&opts.query)
    };

    if pattern.is_empty() {
        return Err("搜索内容为空".into());
    }
    b.build(&pattern).map_err(|e| format!("表达式无效: {e}"))
}

/// 把一个字节偏移映射成"该行内"的字符偏移
fn char_offset_in_line(line: &str, byte_in_line: usize) -> u32 {
    if byte_in_line >= line.len() {
        return line.chars().count() as u32;
    }
    let clamped = line
        .char_indices()
        .map(|(i, _)| i)
        .take_while(|&i| i <= byte_in_line)
        .last()
        .unwrap_or(0);
    line[..clamped].chars().count() as u32
}

struct FileSearchOutcome {
    hits: Vec<SearchHit>,
    capped: bool,
}

fn search_one_file(
    path: &Path,
    root: &Path,
    matcher: &grep_regex::RegexMatcher,
    max_file_size: u64,
    budget: &AtomicUsize,
    max_results: usize,
) -> Option<FileSearchOutcome> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > max_file_size {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if encoding::is_probably_binary(&bytes) {
        return None;
    }

    let decoded = encoding::decode_bytes(&bytes, None);
    if decoded.binary {
        return None;
    }
    let text = decoded.text;
    if text.is_empty() {
        return None;
    }

    let path_str = path.to_string_lossy().to_string();
    let rel = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();

    let mut hits: Vec<SearchHit> = Vec::new();
    let mut capped = false;

    // 预先计算每行起点（字节偏移），便于 偏移 -> (行号, 行内偏移)
    let mut line_starts: Vec<usize> = Vec::with_capacity(1024);
    line_starts.push(0);
    for (i, b) in text.as_bytes().iter().enumerate() {
        if *b == b'\n' {
            line_starts.push(i + 1);
        }
    }

    let line_no_of = |byte_off: usize| -> usize {
        match line_starts.binary_search(&byte_off) {
            Ok(idx) => idx,
            Err(idx) => idx.saturating_sub(1),
        }
    };

    let mut scan_err: Option<String> = None;
    let _ = matcher.find_iter(text.as_bytes(), |m| {
        if budget.load(Ordering::Relaxed) >= max_results {
            capped = true;
            return false;
        }
        budget.fetch_add(1, Ordering::Relaxed);

        let start = m.start();
        let end = m.end();
        let line_idx = line_no_of(start);
        let line_start = line_starts[line_idx];
        let line_end = if line_idx + 1 < line_starts.len() {
            line_starts[line_idx + 1]
        } else {
            text.len()
        };
        let line_raw = &text[line_start..line_end];
        let line_trimmed = line_raw.trim_end_matches(['\n', '\r']);

        // 截断超长行，但保持匹配在视窗内
        let (display, m_start_c, m_end_c) = if line_trimmed.chars().count() > LINE_TEXT_LIMIT {
            let total_chars = line_trimmed.chars().count();
            let match_char_start = char_offset_in_line(line_trimmed, start - line_start);
            // 若匹配点太靠右，滚动窗口
            let win_start = if match_char_start as usize > LINE_TEXT_LIMIT / 2 {
                (match_char_start as usize).saturating_sub(LINE_TEXT_LIMIT / 3)
            } else {
                0
            };
            let win_end = (win_start + LINE_TEXT_LIMIT).min(total_chars);
            let disp: String = line_trimmed.chars().skip(win_start).take(win_end - win_start).collect();
            let s = match_char_start.saturating_sub(win_start as u32);
            let e = char_offset_in_line(line_trimmed, end - line_start).saturating_sub(win_start as u32);
            (disp, s, e)
        } else {
            (
                line_trimmed.to_string(),
                char_offset_in_line(line_trimmed, start - line_start),
                char_offset_in_line(line_trimmed, end - line_start),
            )
        };

        hits.push(SearchHit {
            path: path_str.clone(),
            rel: rel.clone(),
            line: (line_idx + 1) as u32,
            col: m_start_c + 1,
            line_text: display,
            match_start: m_start_c,
            match_end: m_end_c,
        });
        true
    });

    if let Some(e) = scan_err.take() {
        let _ = e;
    }

    if hits.is_empty() {
        None
    } else {
        Some(FileSearchOutcome { hits, capped })
    }
}

#[tauri::command]
pub fn search_in_folder(opts: SearchOptions) -> Result<SearchResult, String> {
    let started = std::time::Instant::now();
    if opts.query.is_empty() {
        return Ok(SearchResult {
            files: vec![],
            total_hits: 0,
            searched_files: 0,
            truncated: false,
            elapsed_ms: 0,
        });
    }

    let matcher = Arc::new(build_matcher(&opts)?);
    let root = PathBuf::from(&opts.root);
    let max_results = opts.max_results.unwrap_or(DEFAULT_MAX_RESULTS).max(1);
    let max_file_size = opts.max_file_size.unwrap_or(DEFAULT_MAX_FILE_SIZE);
    let include = opts.include.clone().unwrap_or_default();
    let exclude = opts.exclude.clone().unwrap_or_default();

    let files: Vec<PathBuf> = if let Some(single) = opts.single_file.as_ref() {
        vec![PathBuf::from(single)]
    } else {
        fs_tree::walk_files(&root, MAX_FILES_SCAN)
    };
    let searched = files.len();

    let budget = AtomicUsize::new(0);

    let mut outcomes: Vec<(FileHits, bool)> = files
        .par_iter()
        .filter(|p| {
            let name = p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ok_inc = include.is_empty() || glob_match(&include, &name);
            let ok_exc = exclude.is_empty() || !glob_match(&exclude, &name);
            ok_inc && ok_exc
        })
        .filter_map(|p| {
            if budget.load(Ordering::Relaxed) >= max_results {
                return None;
            }
            search_one_file(p, &root, &matcher, max_file_size, &budget, max_results).map(|o| {
                (
                    FileHits {
                        path: p.to_string_lossy().to_string(),
                        rel: p
                            .strip_prefix(&root)
                            .unwrap_or(p)
                            .to_string_lossy()
                            .to_string(),
                        hits: o.hits,
                    },
                    o.capped,
                )
            })
        })
        .collect();

    let total_hits: usize = outcomes.iter().map(|(f, _)| f.hits.len()).sum();
    let truncated = total_hits >= max_results || outcomes.iter().any(|(_, c)| *c);

    outcomes.sort_by(|a, b| a.0.rel.to_lowercase().cmp(&b.0.rel.to_lowercase()));
    let mut files_sorted: Vec<FileHits> = outcomes.into_iter().map(|(f, _)| f).collect();
    for f in files_sorted.iter_mut() {
        f.hits.sort_by_key(|h| (h.line, h.col));
    }

    Ok(SearchResult {
        files: files_sorted,
        total_hits,
        searched_files: searched,
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[derive(Debug, Serialize)]
pub struct ReplaceReport {
    pub files_changed: usize,
    pub replacements: usize,
    pub failed: Vec<String>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ReplaceOptions {
    pub root: String,
    pub query: String,
    pub replacement: String,
    pub is_regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub include: Option<String>,
    pub exclude: Option<String>,
    pub max_file_size: Option<u64>,
    /// 只替换这些文件（空则整个 root）
    pub files: Option<Vec<String>>,
}

#[tauri::command]
pub fn replace_in_files(opts: ReplaceOptions) -> Result<ReplaceReport, String> {
    let started = std::time::Instant::now();
    if opts.query.is_empty() {
        return Err("搜索内容为空".into());
    }

    let regex_matcher = {
        let mut b = grep_regex::RegexMatcherBuilder::new();
        b.case_insensitive(!opts.case_sensitive);
        b.line_terminator(None);
        b.multi_line(false);
        b.fixed_strings(!opts.is_regex);
        let pattern = if opts.whole_word {
            if opts.is_regex {
                format!(r"\b(?:{})\b", opts.query)
            } else {
                format!(r"\b{}\b", escape_regex(&opts.query))
            }
        } else if opts.is_regex {
            opts.query.clone()
        } else {
            escape_regex(&opts.query)
        };
        b.build(&pattern).map_err(|e| format!("表达式无效: {e}"))?
    };

    // 替换需要捕获组，用 regex crate 单独构建
    let re = {
        let mut pat = if opts.is_regex {
            opts.query.clone()
        } else {
            regex::escape(&opts.query)
        };
        if opts.whole_word {
            pat = format!(r"\b(?:{})\b", pat);
        }
        let mut builder = regex::RegexBuilder::new(&pat);
        builder.case_insensitive(!opts.case_sensitive);
        builder.multi_line(false);
        builder
            .build()
            .map_err(|e| format!("表达式无效: {e}"))?
    };

    let root = PathBuf::from(&opts.root);
    let max_file_size = opts.max_file_size.unwrap_or(DEFAULT_MAX_FILE_SIZE);
    let include = opts.include.clone().unwrap_or_default();
    let exclude = opts.exclude.clone().unwrap_or_default();

    let files: Vec<PathBuf> = if let Some(list) = opts.files.as_ref() {
        if list.is_empty() {
            fs_tree::walk_files(&root, MAX_FILES_SCAN)
        } else {
            list.iter().map(PathBuf::from).collect()
        }
    } else {
        fs_tree::walk_files(&root, MAX_FILES_SCAN)
    };

    let targets: Vec<PathBuf> = files
        .into_iter()
        .filter(|p| {
            let name = p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ok_inc = include.is_empty() || glob_match(&include, &name);
            let ok_exc = exclude.is_empty() || !glob_match(&exclude, &name);
            ok_inc && ok_exc
        })
        .collect();

    // 先确认哪些文件真的有匹配（用 grep matcher 快速过滤）
    let candidates: Vec<PathBuf> = targets
        .par_iter()
        .filter(|p| {
            let meta = match std::fs::metadata(p) {
                Ok(m) => m,
                Err(_) => return false,
            };
            if !meta.is_file() || meta.len() > max_file_size {
                return false;
            }
            match std::fs::read(p) {
                Ok(b) => {
                    if encoding::is_probably_binary(&b) {
                        return false;
                    }
                    let d = encoding::decode_bytes(&b, None);
                    if d.binary {
                        return false;
                    }
                    regex_matcher.is_match(d.text.as_bytes()).unwrap_or(false)
                }
                Err(_) => false,
            }
        })
        .cloned()
        .collect();

    let results: Vec<Result<(bool, usize), String>> = candidates
        .par_iter()
        .map(|p| -> Result<(bool, usize), String> {
            let bytes = std::fs::read(p).map_err(|e| format!("{}: {e}", p.display()))?;
            let decoded = encoding::decode_bytes(&bytes, None);
            if decoded.binary {
                return Ok((false, 0));
            }
            let original = decoded.text;
            // 统计并替换（保留捕获组 $1 ${name}）
            let count = re.find_iter(&original).count();
            if count == 0 {
                return Ok((false, 0));
            }
            let replaced = re.replace_all(&original, opts.replacement.as_str()).into_owned();
            if replaced == original {
                return Ok((false, 0));
            }
            let out = encoding::encode_text(&replaced, decoded.encoding);
            std::fs::write(p, out).map_err(|e| format!("写入 {} 失败: {e}", p.display()))?;
            Ok((true, count))
        })
        .collect();

    let mut files_changed = 0usize;
    let mut replacements = 0usize;
    let mut failed: Vec<String> = Vec::new();
    for r in results {
        match r {
            Ok((changed, n)) => {
                if changed {
                    files_changed += 1;
                    replacements += n;
                }
            }
            Err(e) => failed.push(e),
        }
    }

    Ok(ReplaceReport {
        files_changed,
        replacements,
        failed,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}
