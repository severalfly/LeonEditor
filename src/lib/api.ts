/**
 * 轻量 Tauri 调用层。直接用 window.__TAURI_INTERNALS__.invoke，
 * 避免额外依赖 @tauri-apps/api。
 */

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function getInvoke(): InvokeFn | null {
  const internals = (window as any).__TAURI_INTERNALS__
  if (internals && typeof internals.invoke === 'function') {
    return internals.invoke.bind(internals) as InvokeFn
  }
  return null
}

export const isTauri = (): boolean => getInvoke() !== null

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = getInvoke()
  if (!fn) {
    throw new Error('Not running inside Tauri')
  }
  return (await fn(cmd, args)) as T
}

/* ---------------- 类型定义（与 Rust 侧一致） ---------------- */

export interface FileContent {
  path: string
  name: string
  text: string
  encoding: string
  encoding_confident: boolean
  eol: string
  mixed_eol: boolean
  bom: boolean
  binary: boolean
  size: number
  read_only: boolean
  modified: number | null
}

export interface SaveResult {
  path: string
  size: number
  modified: number | null
}

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  size: number
  modified: number | null
  children: TreeNode[] | null
}

export interface SearchHit {
  path: string
  rel: string
  line: number
  col: number
  line_text: string
  match_start: number
  match_end: number
}

export interface FileHits {
  path: string
  rel: string
  hits: SearchHit[]
}

export interface SearchResult {
  files: FileHits[]
  total_hits: number
  searched_files: number
  truncated: boolean
  elapsed_ms: number
}

export interface SearchOptions {
  root: string
  query: string
  is_regex: boolean
  case_sensitive: boolean
  whole_word: boolean
  include?: string | null
  exclude?: string | null
  max_results?: number | null
  max_file_size?: number | null
  single_file?: string | null
}

export interface ReplaceReport {
  files_changed: number
  replacements: number
  failed: string[]
  elapsed_ms: number
}

export interface EditorSettings {
  theme: string
  font_family: string
  font_size: number
  tab_size: number
  insert_spaces: boolean
  word_wrap: boolean
  show_minimap: boolean
  show_line_numbers: boolean
  highlight_current_line: boolean
  auto_save: boolean
  restore_session: boolean
  show_hidden_files: boolean
  trim_trailing_whitespace: boolean
  ensure_final_newline: boolean
  search_include: string
  search_exclude: string
  sidebar_width: number
  /** 自定义快捷键：只存被改过的动作（动作 id → 组合键） */
  keybindings: Record<string, string>
}

export interface StartupArg {
  path: string
  is_dir: boolean
}

export interface AppInfo {
  version: string
  config_dir: string
  portable: boolean
  exe_dir: string
}

export interface FontInfo {
  name: string
  monospace: boolean
}

export interface DraftFile {
  id: string
  path: string | null
  name: string
  encoding: string
  eol: string
  cursor_line: number
  cursor_col: number
  scroll_top: number
  untitled: boolean
}

export interface SessionState {
  open_files: { path: string; cursor_line: number; cursor_col: number; scroll_top: number }[]
  active_path: string | null
  root_folder: string | null
  drafts?: DraftFile[]
  active_draft_id?: string | null
}

export interface EncodingOption {
  id: string
  label: string
}

/* ---------------- 命令封装 ---------------- */

export const api = {
  readTextFile: (path: string, encoding?: string) =>
    invoke<FileContent>('read_text_file', { path, encoding: encoding ?? null }),

  writeTextFile: (payload: {
    path: string
    text: string
    encoding?: string | null
    eol?: string | null
    expected_modified?: number | null
  }) => invoke<SaveResult>('write_text_file', { payload }),

  listEncodings: () => invoke<EncodingOption[]>('list_encodings'),

  convertEncoding: (path: string, from: string, to: string) =>
    invoke<SaveResult>('convert_encoding', { path, from, to }),

  pathExists: (path: string) => invoke<boolean>('path_exists', { path }),

  /** 在目录里新建一个空文件，名字冲突时自动加序号；返回最终路径 */
  createFile: (dir: string, baseName: string) =>
    invoke<string>('create_file', { dir, baseName }),

  listDir: (dir: string) => invoke<TreeNode[]>('list_dir', { dir }),

  listTree: (root: string, showHidden?: boolean) =>
    invoke<TreeNode>('list_tree', { root, showHidden: showHidden ?? false }),

  searchInFolder: (opts: SearchOptions) => invoke<SearchResult>('search_in_folder', { opts }),

  replaceInFiles: (opts: any) => invoke<ReplaceReport>('replace_in_files', { opts }),

  getAppInfo: () => invoke<AppInfo>('get_app_info'),

  loadSettings: () => invoke<EditorSettings>('load_settings'),

  saveSettings: (settings: EditorSettings) => invoke<void>('save_settings', { settings }),

  loadSession: () => invoke<any>('load_session'),

  saveSession: (session: any) => invoke<void>('save_session', { session }),

  startupArgs: () => invoke<StartupArg[]>('startup_args'),

  logFrontend: (level: string, msg: string) =>
    invoke<void>('log_frontend', { level, msg }).catch(() => undefined),

  /* 草稿（未保存内容） */
  writeDraft: (id: string, text: string) =>
    invoke<void>('write_draft', { id, text }),

  readDraft: (id: string) => invoke<string>('read_draft', { id }),

  deleteDraft: (id: string) => invoke<void>('delete_draft', { id }).catch(() => undefined),

  pruneDrafts: (keepIds: string[]) => invoke<number>('prune_drafts', { keepIds }),

  /* 系统字体 */
  listSystemFonts: () => invoke<FontInfo[]>('list_system_fonts')
}
