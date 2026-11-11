import { reactive, ref } from 'vue'
import * as monaco from 'monaco-editor'
import { api, type TreeNode, type EditorSettings, type AppInfo } from './api'
import { askConfirm } from './confirm'
import { applyBindings } from './keymap'

/**
 * 「另存为」文件选择器由 App 注入（store 里不能直接引 Tauri 对话框，
 * 否则会出现循环依赖，也不利于在没有 Tauri 的环境里跑）。
 */
let saveAsPicker: ((defaultName?: string) => Promise<string | null>) | null = null

export function setSaveAsPicker(fn: (defaultName?: string) => Promise<string | null>) {
  saveAsPicker = fn
}

/**
 * 保存指定标签。未命名的新文件会先弹「另存为」让用户选路径。
 * 返回 true 表示确实写入了磁盘。
 */
export async function saveTabInteractive(tab: Tab): Promise<boolean> {
  if (tab.binary) {
    showToast('二进制文件不支持保存', 'error')
    return false
  }
  if (!tab.path) {
    if (!saveAsPicker) {
      showToast('无法打开保存对话框', 'error')
      return false
    }
    const p = await saveAsPicker(tab.name)
    if (!p) return false
    return saveTab(tab, p)
  }
  return saveTab(tab)
}

export interface Tab {
  id: string
  path: string | null // null 表示未命名新文件
  name: string
  encoding: string
  eol: string
  bom: boolean
  readOnly: boolean
  modified: number | null
  dirty: boolean
  /** 光标位置（切回来时恢复） */
  cursorLine: number
  cursorCol: number
  scrollTop: number
  /** 是否二进制 */
  binary: boolean
  /** 外部被改动 */
  externallyChanged: boolean
  size: number
  /** 草稿 id：未保存内容持久化用，标签创建时即分配 */
  draftId: string
}

const UNTITLED_PREFIX = '未命名-'

let untitledCounter = 1

/** 生成草稿 id（用于未保存内容持久化） */
function newDraftId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export const state = reactive({
  tabs: [] as Tab[],
  activeId: null as string | null,
  rootFolder: null as string | null,
  tree: null as TreeNode | null,
  expandedPaths: new Set<string>(),
  settings: null as EditorSettings | null,
  appInfo: null as AppInfo | null,
  /** 搜索面板状态 */
  findVisible: false,
  /**
   * 每次「打开查找」自增一次：面板已经打开时再按 Ctrl+F，
   * findVisible 仍是 true，光靠它的 watcher 不会触发聚焦，用这个计数补上。
   */
  findFocusTick: 0,
  findMode: 'current' as 'current' | 'folder',
  findQuery: '',
  findReplace: '',
  findRegex: false,
  findCaseSensitive: false,
  findWholeWord: false,
  replaceVisible: false,
  searchResult: null as any,
  searchBusy: false,
  searchSelectedIndex: -1,
  /** 侧栏视图 */
  sidebarView: 'files' as 'files' | 'search',
  sidebarWidth: 260,
  /** 状态提示 */
  toast: null as { text: string; kind: 'info' | 'error' | 'success' } | null,
  /** 正在拖拽调整侧栏 */
  resizing: false
})

/** Monaco 单实例 —— 所有标签共享 */
let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null
/** path -> model */
const models = new Map<string, monaco.editor.ITextModel>()
/** path -> viewState */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

export function setEditorInstance(ed: monaco.editor.IStandaloneCodeEditor) {
  editorInstance = ed
}

export function getEditorInstance() {
  return editorInstance
}

export function getModelFor(tab: Tab): monaco.editor.ITextModel | null {
  const key = tabKey(tab)
  return models.get(key) ?? null
}

export function tabKey(tab: Tab): string {
  return tab.path ?? `untitled:${tab.id}`
}

/**
 * 脏标记追踪：记录 model 的"已保存版本号"，
 * 用户撤销回原样时 dirty 会自动变回 false。
 */
const cleanVersion = new Map<string, number>()

function bindDirtyTracking(model: monaco.editor.ITextModel, key: string) {
  cleanVersion.set(key, model.getAlternativeVersionId())
  model.onDidChangeContent(() => {
    const tab = state.tabs.find((x) => tabKey(x) === key)
    if (!tab || tab.binary) return
    const isClean = model.getAlternativeVersionId() === cleanVersion.get(key)
    if (tab.dirty !== !isClean) {
      tab.dirty = !isClean
    }
  })
}

export function markClean(key: string, model: monaco.editor.ITextModel) {
  cleanVersion.set(key, model.getAlternativeVersionId())
  const tab = state.tabs.find((x) => tabKey(x) === key)
  if (tab) tab.dirty = false
}

export function languageFromPath(p: string | null, name: string): string {
  if (!p) return 'plaintext'
  const lower = name.toLowerCase()
  const ext = lower.lastIndexOf('.') >= 0 ? lower.slice(lower.lastIndexOf('.') + 1) : ''

  const map: Record<string, string> = {
    sql: 'sql',
    ddl: 'sql',
    dml: 'sql',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    vue: 'html',
    json: 'json',
    jsonc: 'json',
    java: 'java',
    py: 'python',
    pyw: 'python',
    go: 'go',
    rs: 'rust',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hh: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    scala: 'scala',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    ps1: 'powershell',
    psm1: 'powershell',
    bat: 'bat',
    cmd: 'bat',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    properties: 'ini',
    env: 'ini',
    xml: 'xml',
    html: 'html',
    htm: 'html',
    xhtml: 'html',
    svg: 'xml',
    plist: 'xml',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    markdown: 'markdown',
    rst: 'plaintext',
    txt: 'plaintext',
    log: 'plaintext',
    out: 'plaintext',
    diff: 'diff',
    patch: 'diff',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    gradle: 'groovy',
    lua: 'lua',
    perl: 'perl',
    pl: 'perl',
    r: 'r',
    dart: 'dart',
    proto: 'proto',
    graphql: 'graphql',
    gql: 'graphql',
    hcl: 'hcl',
    tf: 'hcl',
    tpl: 'plaintext',
    csv: 'plaintext',
    tsv: 'plaintext'
  }

  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile'
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile'
  if (lower.startsWith('.env')) return 'ini'
  if (lower === '.gitignore' || lower === '.dockerignore' || lower === '.gitattributes') return 'plaintext'

  return map[ext] ?? 'plaintext'
}

export function showToast(text: string, kind: 'info' | 'error' | 'success' = 'info') {
  state.toast = { text, kind }
  window.setTimeout(() => {
    if (state.toast?.text === text) state.toast = null
  }, 2600)
}

export function dirtyLabel(tab: Tab): string {
  return tab.dirty ? `● ${tab.name}` : tab.name
}

export function activeTab(): Tab | null {
  return state.tabs.find((t) => t.id === state.activeId) ?? null
}

/* ---------------- 标签操作 ---------------- */

export async function openFile(path: string, options?: { preview?: boolean }) {
  // 已打开则切过去
  const existing = state.tabs.find((t) => t.path === path)
  if (existing) {
    activateTab(existing.id)
    return existing
  }

  let content
  try {
    content = await api.readTextFile(path)
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
    return null
  }

  const name = content.name
  const tab: Tab = {
    id: `t${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    path: content.path,
    name,
    encoding: content.encoding,
    eol: content.eol === '\r\n' ? 'crlf' : content.eol === '\r' ? 'cr' : 'lf',
    bom: content.bom,
    readOnly: content.read_only,
    modified: content.modified,
    dirty: false,
    cursorLine: 1,
    cursorCol: 1,
    scrollTop: 0,
    binary: content.binary,
    externallyChanged: false,
    size: content.size,
    draftId: newDraftId()
  }

  const key = path
  let model = models.get(key)
  if (!model || model.isDisposed()) {
    const lang = content.binary ? 'plaintext' : languageFromPath(path, name)
    model = monaco.editor.createModel(content.text, lang)
    models.set(key, model)
    bindDirtyTracking(model, key)
  }

  state.tabs.push(tab)
  activateTab(tab.id)
  return tab
}

export function createUntitled() {
  const name = `${UNTITLED_PREFIX}${untitledCounter++}`
  const tab: Tab = {
    id: `t${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    path: null,
    name,
    encoding: 'utf-8',
    eol: 'lf',
    bom: false,
    readOnly: false,
    modified: null,
    dirty: false,
    cursorLine: 1,
    cursorCol: 1,
    scrollTop: 0,
    binary: false,
    externallyChanged: false,
    size: 0,
    draftId: newDraftId()
  }
  const key = `untitled:${tab.id}`
  const model = monaco.editor.createModel('', 'plaintext')
  models.set(key, model)
  bindDirtyTracking(model, key)
  state.tabs.push(tab)
  activateTab(tab.id)
  return tab
}

export function activateTab(id: string) {
  if (state.activeId === id) return
  // 保存当前视图状态
  saveViewState()
  state.activeId = id
  restoreViewState()
}

function saveViewState() {
  if (!editorInstance || !state.activeId) return
  const tab = state.tabs.find((t) => t.id === state.activeId)
  if (!tab) return
  const key = tabKey(tab)
  viewStates.set(key, editorInstance.saveViewState())
  const pos = editorInstance.getPosition()
  if (pos) {
    tab.cursorLine = pos.lineNumber
    tab.cursorCol = pos.column
  }
  tab.scrollTop = editorInstance.getScrollTop()
}

function restoreViewState() {
  if (!editorInstance) return
  const tab = activeTab()
  if (!tab) return
  const key = tabKey(tab)
  const model = models.get(key)
  if (!model || model.isDisposed()) return
  editorInstance.setModel(model)
  const vs = viewStates.get(key)
  if (vs) {
    editorInstance.restoreViewState(vs)
  } else {
    editorInstance.setPosition({ lineNumber: tab.cursorLine, column: tab.cursorCol })
    editorInstance.setScrollTop(tab.scrollTop)
  }
  // 只读/二进制文件设为只读
  editorInstance.updateOptions({ readOnly: tab.readOnly || tab.binary })
  editorInstance.focus()
}

export async function closeTab(id: string, force = false): Promise<boolean> {
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return true
  const tab = state.tabs[idx]

  if (tab.dirty && !force) {
    const choice = await askConfirm({
      title: `「${tab.name}」有未保存的修改`,
      message: tab.path
        ? '关闭后，这些修改会丢失。'
        : '这是一个还没有保存到磁盘的新文件，关闭后内容会丢失。',
      detail: tab.path ?? undefined,
      buttons: [
        { label: '保存', value: 'save', kind: 'primary' },
        { label: '不保存', value: 'discard', kind: 'danger' },
        { label: '取消', value: 'cancel' }
      ]
    })

    // 取消 / Esc / 点遮罩：保持原样，什么都不改
    if (!choice || choice === 'cancel') return false

    if (choice === 'save') {
      const saved = await saveTabInteractive(tab)
      // 保存失败，或用户在「另存为」里点了取消 —— 不关闭
      if (!saved) return false
    }
    // discard：直接往下走，放弃修改
  }

  const key = tabKey(tab)
  const model = models.get(key)
  if (model && !model.isDisposed()) {
    try {
      model.dispose()
    } catch {
      /* ignore */
    }
  }
  models.delete(key)
  viewStates.delete(key)
  state.tabs.splice(idx, 1)

  // 标签关闭后清理它的草稿快照（用户已明确放弃修改）
  try {
    await api.deleteDraft(tab.draftId)
  } catch {
    /* 静默 */
  }

  if (state.activeId === id) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)]
    state.activeId = null
    if (next) {
      activateTab(next.id)
    } else if (editorInstance) {
      editorInstance.setModel(null)
    }
  }
  return true
}

export async function closeAllTabs() {
  const ids = state.tabs.map((t) => t.id)
  const dirtyTabs = state.tabs.filter((t) => t.dirty)

  if (dirtyTabs.length > 0) {
    const names = dirtyTabs.map((t) => t.name).join('、')
    const choice = await askConfirm({
      title: `有 ${dirtyTabs.length} 个文件未保存`,
      message: '全部关闭后，这些修改会丢失。',
      detail: names,
      buttons: [
        { label: '全部保存', value: 'save', kind: 'primary' },
        { label: '全部不保存', value: 'discard', kind: 'danger' },
        { label: '取消', value: 'cancel' }
      ]
    })

    if (!choice || choice === 'cancel') return

    if (choice === 'save') {
      for (const t of dirtyTabs) {
        const ok = await saveTabInteractive(t)
        // 任何一个存不下来（比如另存为被取消）就中止，避免丢内容
        if (!ok) return
      }
    }
  }

  for (const id of ids) {
    await closeTab(id, true)
  }
}

export async function saveTab(tab: Tab, saveAsPath?: string): Promise<boolean> {
  if (tab.binary) {
    showToast('二进制文件不支持保存', 'error')
    return false
  }
  const model = models.get(tabKey(tab))
  if (!model) return false

  let targetPath = saveAsPath ?? tab.path
  if (!targetPath) {
    showToast('缺少保存路径', 'error')
    return false
  }

  let text = model.getValue()
  const s = state.settings
  if (s?.trim_trailing_whitespace) {
    text = text
      .split(/\r?\n/)
      .map((l) => l.replace(/[ \t]+$/, ''))
      .join('\n')
  }
  if (s?.ensure_final_newline && text.length > 0 && !text.endsWith('\n')) {
    text += '\n'
  }

  try {
    const res = await api.writeTextFile({
      path: targetPath,
      text,
      encoding: tab.encoding,
      eol: tab.eol,
      expected_modified: saveAsPath ? null : tab.modified
    })

    // Save As：切换 key
    if (saveAsPath && saveAsPath !== tab.path) {
      const oldKey = tabKey(tab)
      const oldModel = models.get(oldKey)
      const newKey = saveAsPath
      if (oldModel) {
        models.delete(oldKey)
        models.set(newKey, oldModel)
        cleanVersion.delete(oldKey)
        // 重新绑定 dirty 追踪到新 key
        bindDirtyTracking(oldModel, newKey)
        const lang = languageFromPath(saveAsPath, saveAsPath.split(/[\\/]/).pop() ?? '')
        if (lang !== 'plaintext') monaco.editor.setModelLanguage(oldModel, lang)
      }
      viewStates.delete(oldKey)
    }

    tab.path = res.path
    tab.name = res.path.split(/[\\/]/).pop() ?? tab.name
    tab.modified = res.modified
    tab.size = res.size
    tab.externallyChanged = false
    markClean(tabKey(tab), model)
    // 已落盘，草稿快照不再需要
    try {
      await api.deleteDraft(tab.draftId)
    } catch {
      /* 静默 */
    }
    showToast('已保存', 'success')
    return true
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (msg.includes('CONFLICT')) {
      const choice = await askConfirm({
        title: '文件已被其他程序修改',
        message: '磁盘上的内容和你上次打开时不一样了。覆盖会丢掉外部改动。',
        detail: tab.path ?? undefined,
        buttons: [
          { label: '覆盖', value: 'overwrite', kind: 'danger' },
          { label: '取消', value: 'cancel', kind: 'default' }
        ]
      })
      if (choice === 'overwrite') {
        tab.modified = null
        return saveTab(tab, saveAsPath)
      }
      return false
    }
    showToast(msg, 'error')
    return false
  }
}

/* ---------------- 文件夹 ---------------- */

export async function openFolder(path: string) {
  state.rootFolder = path
  state.expandedPaths = new Set([path])
  try {
    const tree = await api.listTree(path, state.settings?.show_hidden_files ?? false)
    state.tree = tree
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
    state.tree = null
  }
}

export async function loadChildren(node: TreeNode) {
  if (node.children !== null) return
  try {
    const children = await api.listDir(node.path)
    node.children = children
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
  }
}

export function toggleExpand(node: TreeNode) {
  if (state.expandedPaths.has(node.path)) {
    state.expandedPaths.delete(node.path)
  } else {
    state.expandedPaths.add(node.path)
    if (node.children === null) loadChildren(node)
  }
}

/** 重新读取某个目录的子项（原地替换，不影响其它已展开节点） */
export async function refreshDir(dirPath: string) {
  try {
    const children = await api.listDir(dirPath)
    if (state.tree && state.tree.path === dirPath) {
      state.tree.children = children
      return
    }
    const found = findNode(state.tree, dirPath)
    if (found) found.children = children
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
  }
}

function findNode(node: TreeNode | null, path: string): TreeNode | null {
  if (!node) return null
  if (node.path === path) return node
  for (const c of node.children ?? []) {
    const hit = findNode(c, path)
    if (hit) return hit
  }
  return null
}

/**
 * 在根目录新建一个空文件并打开它。
 * 供「文件树空白处双击」使用：名字冲突会自动加序号，不会覆盖已有文件。
 */
export async function createFileInRoot(baseName = '新建文件.txt') {
  if (!state.rootFolder) {
    showToast('请先打开一个文件夹', 'info')
    return null
  }
  try {
    const created = await api.createFile(state.rootFolder, baseName)
    await refreshDir(state.rootFolder)
    state.expandedPaths.add(state.rootFolder)
    const tab = await openFile(created)
    showToast(`已新建 ${created.split(/[\\/]/).pop()}`, 'success')
    return tab
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
    return null
  }
}

/* ---------------- 设置 ---------------- */

export async function applySettings(s: EditorSettings) {
  state.settings = s
  state.sidebarWidth = s.sidebar_width
  document.documentElement.dataset.theme = s.theme

  // 快捷键：设置一加载就生效，不需要重启
  applyBindings(s.keybindings ?? {})

  // 主题注册在 monaco-setup 里，这里只需切换；编辑器还没创建时也先设好
  try {
    monaco.editor.setTheme(s.theme === 'dark' ? 'leon-dark' : 'leon-light')
  } catch {
    /* 主题尚未定义时忽略 */
  }

  if (editorInstance) {
    editorInstance.updateOptions({
      fontFamily: s.font_family,
      fontSize: s.font_size,
      tabSize: s.tab_size,
      insertSpaces: s.insert_spaces,
      wordWrap: s.word_wrap ? 'on' : 'off',
      // 与创建时保持一致：换行开时隐藏横向滚动条，关时恢复
      scrollbar: {
        vertical: 'auto',
        horizontal: s.word_wrap ? 'hidden' : 'auto',
        verticalScrollbarSize: 12,
        horizontalScrollbarSize: 12,
        useShadows: false
      },
      minimap: { enabled: s.show_minimap },
      lineNumbers: s.show_line_numbers ? 'on' : 'off',
      renderLineHighlight: s.highlight_current_line ? 'line' : 'none'
    })
  }
}

export async function persistSettings() {
  if (!state.settings) return
  state.settings.sidebar_width = Math.round(state.sidebarWidth)
  try {
    await api.saveSettings(state.settings)
  } catch (e) {
    /* 静默 */
  }
}

/* ---------------- 未保存内容：会话快照与恢复 ---------------- */

/**
 * 生成当前会话快照。除了已保存的文件，还会把所有 dirty 标签的正文
 * 写入草稿目录，重启后能原样恢复（包括从未落盘的新文件）。
 */
export async function buildSessionSnapshot() {
  const openFiles: {
    path: string
    cursor_line: number
    cursor_col: number
    scroll_top: number
  }[] = []
  const drafts: import('./api').DraftFile[] = []

  // 记录当前光标（编辑器的实时位置）
  if (editorInstance && state.activeId) {
    const t = state.tabs.find((x) => x.id === state.activeId)
    const pos = editorInstance.getPosition()
    if (t && pos) {
      t.cursorLine = pos.lineNumber
      t.cursorCol = pos.column
      t.scrollTop = editorInstance.getScrollTop()
    }
  }

  for (const tab of state.tabs) {
    if (tab.binary) {
      // 二进制不保留内容，只记录下来
      if (tab.path) {
        openFiles.push({
          path: tab.path,
          cursor_line: tab.cursorLine,
          cursor_col: tab.cursorCol,
          scroll_top: Math.round(tab.scrollTop)
        })
      }
      continue
    }

    if (!tab.dirty) {
      // 干净的文件只记路径，重启后从磁盘重读
      if (tab.path) {
        openFiles.push({
          path: tab.path,
          cursor_line: tab.cursorLine,
          cursor_col: tab.cursorCol,
          scroll_top: Math.round(tab.scrollTop)
        })
      } else {
        // 未命名但没改过：仍是空文件，也要恢复
        drafts.push({
          id: tab.draftId,
          path: null,
          name: tab.name,
          encoding: tab.encoding,
          eol: tab.eol,
          cursor_line: tab.cursorLine,
          cursor_col: tab.cursorCol,
          scroll_top: Math.round(tab.scrollTop),
          untitled: true
        })
        await api.writeDraft(tab.draftId, '')
      }
      continue
    }

    // dirty：正文写入草稿
    const model = models.get(tabKey(tab))
    if (!model) continue
    try {
      await api.writeDraft(tab.draftId, model.getValue())
      drafts.push({
        id: tab.draftId,
        path: tab.path,
        name: tab.name,
        encoding: tab.encoding,
        eol: tab.eol,
        cursor_line: tab.cursorLine,
        cursor_col: tab.cursorCol,
        scroll_top: Math.round(tab.scrollTop),
        untitled: !tab.path
      })
    } catch {
      /* 单条失败不影响整体 */
    }
  }

  const active = activeTab()
  return {
    open_files: openFiles,
    active_path: active?.path ?? null,
    root_folder: state.rootFolder,
    drafts,
    active_draft_id: active?.draftId ?? null
  }
}

/**
 * 从会话快照恢复未保存的草稿标签。
 * 返回恢复出的标签数量。
 */
export async function restoreDrafts(drafts: import('./api').DraftFile[]): Promise<number> {
  let restored = 0
  for (const d of drafts) {
    let text = ''
    try {
      text = await api.readDraft(d.id)
    } catch {
      // 草稿文件丢失：如果原来有路径，退回从磁盘读取
      if (d.path) {
        const t = await openFile(d.path)
        if (t) restored++
      }
      continue
    }

    const tab: Tab = {
      id: `t${Date.now()}_${Math.random().toString(36).slice(2, 7)}${restored}`,
      path: d.path,
      name: d.name,
      encoding: d.encoding || 'utf-8',
      eol: d.eol || 'lf',
      bom: false,
      readOnly: false,
      modified: null,
      dirty: false,
      cursorLine: d.cursor_line || 1,
      cursorCol: d.cursor_col || 1,
      scrollTop: d.scroll_top || 0,
      binary: false,
      externallyChanged: false,
      size: text.length,
      draftId: d.id
    }

    const key = d.path ?? `untitled:${tab.id}`
    let model = d.path ? models.get(d.path) : undefined
    if (!model || model.isDisposed()) {
      const lang = languageFromPath(d.path, d.name)
      model = monaco.editor.createModel(text, lang)
      models.set(key, model)
      bindDirtyTracking(model, key)
    } else {
      // 已由 openFile 建过 model（同路径），覆盖成草稿内容
      model.setValue(text)
    }

    // 内容来自草稿（与磁盘不一致），标记为脏，提示用户需要保存
    cleanVersion.set(key, model.getAlternativeVersionId())
    tab.dirty = true

    state.tabs.push(tab)
    restored++
    if (d.untitled) {
      // 保证新 untitled 编号不会撞名字
      const m = d.name.match(/未命名-(\d+)/)
      if (m) untitledCounter = Math.max(untitledCounter, parseInt(m[1], 10) + 1)
    }
  }
  return restored
}
