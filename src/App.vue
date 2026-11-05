<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import Icon from './components/Icon.vue'
import FileTree from './components/FileTree.vue'
import TabBar from './components/TabBar.vue'
import EditorPane from './components/EditorPane.vue'
import FindPanel from './components/FindPanel.vue'
import SearchPane from './components/SearchPane.vue'
import QuickOpen from './components/QuickOpen.vue'
import StatusBar from './components/StatusBar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import * as monaco from 'monaco-editor'

import {
  state,
  openFile,
  openFolder,
  createUntitled,
  closeTab,
  closeAllTabs,
  saveTab,
  activateTab,
  activeTab,
  applySettings,
  persistSettings,
  showToast,
  getModelFor,
  tabKey,
  buildSessionSnapshot,
  restoreDrafts,
  type Tab
} from './lib/store'
import { api, isTauri, type TreeNode, type SearchHit, type StartupArg } from './lib/api'
import * as textops from './lib/textops'

/* ---------------- 组件引用 ---------------- */
const editorRef = ref<InstanceType<typeof EditorPane> | null>(null)
const findRef = ref<InstanceType<typeof FindPanel> | null>(null)

/* ---------------- UI 状态 ---------------- */
const sidebarVisible = ref(true)
const quickOpenVisible = ref(false)
const settingsVisible = ref(false)
const showEncodingMenu = ref(false)
const folderFilter = ref('')
const filterInput = ref<HTMLInputElement | null>(null)
const showFilter = ref(false)

const ctxMenu = ref<{ x: number; y: number; kind: 'file' | 'tab' | 'editor' | 'folder'; node?: TreeNode; tab?: Tab } | null>(null)

const cursor = ref({ line: 1, col: 1, selected: 0 })

const encodingOptions = ref<{ id: string; label: string }[]>([])

const appReady = ref(false)
const noTauri = computed(() => !isTauri())

/* ---------------- 文件对话框 ---------------- */

async function pickFiles(): Promise<string[] | null> {
  if (!isTauri()) return null
  try {
    const mod = await import('@tauri-apps/plugin-dialog')
    const res = await mod.open({
      multiple: true,
      title: '打开文件',
      filters: [{ name: '所有文件', extensions: ['*'] }]
    })
    if (!res) return null
    return Array.isArray(res) ? res : [res as string]
  } catch (e: any) {
    showToast(`打开对话框失败: ${e?.message ?? e}`, 'error')
    return null
  }
}

async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const mod = await import('@tauri-apps/plugin-dialog')
    const res = await mod.open({ directory: true, multiple: false, title: '打开文件夹' })
    return (res as string) ?? null
  } catch (e: any) {
    showToast(`打开对话框失败: ${e?.message ?? e}`, 'error')
    return null
  }
}

async function pickSaveAs(defaultName?: string): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const mod = await import('@tauri-apps/plugin-dialog')
    const res = await mod.save({
      title: '另存为',
      defaultPath: defaultName ?? state.rootFolder ?? undefined
    })
    return (res as string) ?? null
  } catch (e: any) {
    showToast(`保存对话框失败: ${e?.message ?? e}`, 'error')
    return null
  }
}

/* ---------------- 动作 ---------------- */

async function actionOpenFile() {
  const paths = await pickFiles()
  if (!paths) return
  for (const p of paths) {
    await openFile(p)
  }
}

async function actionOpenFolder() {
  const dir = await pickFolder()
  if (!dir) return
  await openFolder(dir)
  const remembered = localStorage.getItem(`leon.expanded.${dir}`)
  if (remembered) {
    try {
      const arr = JSON.parse(remembered) as string[]
      arr.forEach((p) => state.expandedPaths.add(p))
    } catch {
      /* ignore */
    }
  }
}

/**
 * 打开一批启动参数：文件夹就切换工作区，文件就开标签。
 * 供「首次启动命令行参数」和「第二实例传来的参数」共用。
 */
async function openStartupArgs(args: StartupArg[]) {
  if (!args.length) return
  const files: string[] = []
  for (const a of args) {
    if (a.is_dir) {
      await openFolder(a.path)
    } else {
      files.push(a.path)
    }
  }
  for (const p of files) {
    await openFile(p)
  }
  ;(window as any).__leon_log?.(
    'startup-args',
    JSON.stringify({ dirs: args.filter((a) => a.is_dir).map((a) => a.path), files })
  )
}

async function actionSave() {
  const tab = activeTab()
  if (!tab) return
  if (!tab.path) {
    const p = await pickSaveAs()
    if (!p) return
    await saveTab(tab, p)
    return
  }
  await saveTab(tab)
}

async function actionSaveAs() {
  const tab = activeTab()
  if (!tab) return
  const p = await pickSaveAs(tab.path ?? tab.name)
  if (!p) return
  await saveTab(tab, p)
}

function actionNew() {
  createUntitled()
}

function actionCloseTab() {
  const tab = activeTab()
  if (tab) closeTab(tab.id)
}

function toggleTheme() {
  if (!state.settings) return
  const next = state.settings.theme === 'dark' ? 'light' : 'dark'
  state.settings.theme = next
  applySettings(state.settings)
  persistSettings()
}

function toggleWordWrap() {
  if (!state.settings) return
  state.settings.word_wrap = !state.settings.word_wrap
  applySettings(state.settings)
  persistSettings()
}

function toggleSidebar() {
  sidebarVisible.value = !sidebarVisible.value
}

/* ---------------- 查找 ---------------- */

function openFind(replace = false) {
  state.findVisible = true
  if (replace) state.replaceVisible = true
  if (state.findMode === 'folder') state.findMode = 'current'
  nextTick(() => {
    // FindPanel 内部会自己聚焦
  })
}

function openFolderSearch() {
  state.findVisible = true
  state.findMode = 'folder'
  state.sidebarView = 'search'
  sidebarVisible.value = true
}

function onFindLocal(opts: any): number {
  if (!editorRef.value) return 0
  const r = editorRef.value.runFind(opts)
  return r.count
}

function onGotoMatch(index: number) {
  editorRef.value?.focusMatch(index)
}

function onClearLocal() {
  editorRef.value?.clearHighlight()
}

function onOpenHit(hit: SearchHit | null) {
  if (!hit) return
  openFile(hit.path).then(() => {
    nextTick(() => {
      // 行号 1 基，列在 line_text 里是字符偏移
      editorRef.value?.selectRange(hit.line, hit.match_start, hit.match_end)
    })
  })
}

/* ---------------- 编辑器事件 ---------------- */

function onCursor(p: { line: number; col: number; selected: number }) {
  cursor.value = p
}

function onToggleEditorWrap() {
  toggleWordWrap()
}

async function actionGotoLine() {
  const v = window.prompt('跳转到行号：', String(cursor.value.line))
  if (!v) return
  const n = parseInt(v, 10)
  if (!isNaN(n)) editorRef.value?.gotoLine(n)
}

/* ---------------- 编码切换 ---------------- */

async function setEncoding(enc: string) {
  const tab = activeTab()
  if (!tab || !tab.path) {
    showToast('请先保存文件', 'error')
    return
  }
  showEncodingMenu.value = false
  // 以新编码重新读取（相当于"以 XX 编码重新打开"）
  try {
    const content = await api.readTextFile(tab.path, enc)
    const model = getModelFor(tab)
    if (model) {
      model.setValue(content.text)
      const key = tabKey(tab)
      // 重置 dirty 基准
      const { markClean } = await import('./lib/store')
      markClean(key, model)
    }
    tab.encoding = content.encoding
    tab.eol = content.eol === '\r\n' ? 'crlf' : content.eol === '\r' ? 'cr' : 'lf'
    showToast(`已用 ${enc.toUpperCase()} 重新载入`, 'success')
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
  }
}

function setEol(eol: string) {
  const tab = activeTab()
  if (!tab) return
  tab.eol = eol
  tab.dirty = true
  showEncodingMenu.value = false
}

/* ---------------- 重新加载标签 ---------------- */

async function reloadTab(id: string) {
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab?.path) return
  try {
    const content = await api.readTextFile(tab.path, tab.encoding)
    const model = getModelFor(tab)
    if (model) {
      model.setValue(content.text)
      const { markClean } = await import('./lib/store')
      markClean(tabKey(tab), model)
    }
    tab.size = content.size
    tab.modified = content.modified
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
  }
}

async function reloadDirtyTabs() {
  for (const tab of state.tabs) {
    if (tab.path) await reloadTab(tab.id)
  }
}

/* ---------------- 文本转换（快捷键） ---------------- */

function transformRemoveNewlines() {
  const r = editorRef.value?.applyTransform((t) => textops.removeNewlines(t))
  if (!r?.ok) {
    showToast('没有可处理的内容', 'info')
    return
  }
  showToast(`已删除换行（${r.scope === 'selection' ? '选区' : '全文'}）`, 'success')
}

function transformRemoveAmpersand() {
  const r = editorRef.value?.applyTransform((t) => textops.removeAmpersands(t))
  if (!r?.ok) {
    showToast('没有可处理的内容', 'info')
    return
  }
  showToast(`已删除 &（${r.scope === 'selection' ? '选区' : '全文'}）`, 'success')
}

function transformToSqlIn() {
  const ed = editorRef.value?.getEditor()
  const model = ed?.getModel()
  if (!model) {
    showToast('请先打开文件', 'error')
    return
  }
  const sel = ed!.getSelection()!
  const src = sel.isEmpty() ? model.getValue() : model.getValueInRange(sel)
  const n = textops.countSqlInValues(src)
  if (n === 0) {
    showToast('没有可转换的值', 'error')
    return
  }
  const r = editorRef.value?.applyTransform((t) => textops.toSqlIn(t))
  if (!r?.ok) {
    showToast('没有可处理的内容', 'info')
    return
  }
  showToast(`已转为 IN 格式，共 ${n} 个值`, 'success')
}

/* ---------------- 快捷键 ---------------- */

function onKeydown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey
  const shift = e.shiftKey
  const alt = e.altKey

  // ---- 软换行开关：Alt+Z（VS Code 同款快捷键）----
  if (alt && !ctrl && !shift && e.code === 'KeyZ') {
    e.preventDefault()
    e.stopPropagation()
    toggleWordWrap()
    return
  }

  // ---- 三键组合：Ctrl+Alt+Shift + 字母/数字 ----
  // 用 e.code 判断物理键位，避免不同键盘布局下 e.key 变化
  if (ctrl && alt && shift) {
    if (e.code === 'KeyD') {
      e.preventDefault()
      transformRemoveNewlines()
      return
    }
    if (e.code === 'KeyL') {
      e.preventDefault()
      transformToSqlIn()
      return
    }
    // 数字 7：主键盘 Digit7 和小键盘 Numpad7 都支持
    if (e.code === 'Digit7' || e.code === 'Numpad7') {
      e.preventDefault()
      transformRemoveAmpersand()
      return
    }
  }

  if (e.key === 'Escape') {
    if (quickOpenVisible.value) {
      quickOpenVisible.value = false
      return
    }
    if (settingsVisible.value) {
      settingsVisible.value = false
      return
    }
    if (ctxMenu.value) {
      ctxMenu.value = null
      return
    }
  }

  if (ctrl && !shift && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    actionOpenFile()
    return
  }
  if (ctrl && !shift && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    actionOpenFolder()
    return
  }
  if (ctrl && !shift && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    actionNew()
    return
  }
  if (ctrl && !shift && e.key.toLowerCase() === 's') {
    e.preventDefault()
    actionSave()
    return
  }
  if (ctrl && shift && e.key.toLowerCase() === 's') {
    e.preventDefault()
    actionSaveAs()
    return
  }
  if (ctrl && !shift && e.key.toLowerCase() === 'w') {
    e.preventDefault()
    actionCloseTab()
    return
  }
  if (ctrl && !shift && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    quickOpenVisible.value = true
    return
  }
  if (ctrl && !shift && e.key.toLowerCase() === 'g') {
    e.preventDefault()
    actionGotoLine()
    return
  }
  if (ctrl && !shift && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    toggleSidebar()
    return
  }
  if (ctrl && shift && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    openFolderSearch()
    return
  }
  if (ctrl && !shift && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    openFind(false)
    return
  }
  if (ctrl && !shift && e.key.toLowerCase() === 'h') {
    e.preventDefault()
    openFind(true)
    return
  }
  if (ctrl && e.key === ',') {
    e.preventDefault()
    settingsVisible.value = true
    return
  }
  if (ctrl && e.key === 'Tab') {
    e.preventDefault()
    cycleTab(shift ? -1 : 1)
    return
  }
}

function cycleTab(dir: number) {
  if (state.tabs.length < 2) return
  const idx = state.tabs.findIndex((t) => t.id === state.activeId)
  const next = (idx + dir + state.tabs.length) % state.tabs.length
  activateTab(state.tabs[next].id)
}

/* ---------------- 右键菜单 ---------------- */

function openCtxMenu(payload: { x: number; y: number; node?: TreeNode; tab?: Tab; kind: any }) {
  ctxMenu.value = { ...payload }
}

async function ctxCopyPath() {
  const p = ctxMenu.value?.node?.path ?? ctxMenu.value?.tab?.path
  if (!p) return
  try {
    await navigator.clipboard.writeText(p)
    showToast('路径已复制', 'success')
  } catch {
    showToast('复制失败', 'error')
  }
  ctxMenu.value = null
}

async function ctxRevealInExplorer() {
  const p = ctxMenu.value?.node?.path ?? ctxMenu.value?.tab?.path
  ctxMenu.value = null
  if (!p || !isTauri()) return
  try {
    const { invoke } = await import('./lib/api')
    await (window as any).__TAURI_INTERNALS__.invoke('plugin:opener|reveal_item_in_dir', { path: p })
  } catch {
    // 无 opener 插件时，退化为复制路径
    try {
      await navigator.clipboard.writeText(p)
      showToast('已复制路径（无定位插件）', 'info')
    } catch {
      /* ignore */
    }
  }
}

function ctxCloseTab() {
  const t = ctxMenu.value?.tab
  ctxMenu.value = null
  if (t) closeTab(t.id)
}

function ctxCloseOthers() {
  const keep = ctxMenu.value?.tab?.id
  ctxMenu.value = null
  if (!keep) return
  const ids = state.tabs.filter((t) => t.id !== keep).map((t) => t.id)
  ids.forEach((id) => closeTab(id, true))
}

function handleOpenCtx() {
  const n = ctxMenu.value?.node
  const isDir = n?.isDir
  ctxMenu.value = null
  if (!n) return
  if (isDir) {
    showToast('这是一个文件夹，展开后选择文件打开', 'info')
    return
  }
  openFile(n.path)
}

async function ctxRefreshFolder() {
  const n = ctxMenu.value?.node
  ctxMenu.value = null
  if (!state.rootFolder) return
  await openFolder(state.rootFolder)
  showToast('已刷新', 'success')
}

/* ---------------- 拖放 ---------------- */

function onDrop(e: DragEvent) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files?.length) return
  // WebView2 中 File 对象有 path 属性（Tauri 注入）
  for (let i = 0; i < files.length; i++) {
    const f = files[i] as any
    const p = f.path ?? f.webkitRelativePath
    if (typeof p === 'string' && p) {
      openFile(p)
    }
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

/* ---------------- 侧栏拖拽调整 ---------------- */

let resizeStartX = 0
let resizeStartW = 0

function startResize(e: MouseEvent) {
  state.resizing = true
  resizeStartX = e.clientX
  resizeStartW = state.sidebarWidth
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', endResize)
  e.preventDefault()
}

function onResizeMove(e: MouseEvent) {
  if (!state.resizing) return
  const w = Math.max(150, Math.min(600, resizeStartW + (e.clientX - resizeStartX)))
  state.sidebarWidth = w
}

function endResize() {
  state.resizing = false
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', endResize)
  persistSettings()
}

/* ---------------- 初始化 ---------------- */

onMounted(async () => {
  document.documentElement.dataset.theme = 'light'

  // 日志桥：把前端信息写到 exe 同目录 log/frontend.log
  ;(window as any).__leon_log = (level: string, msg: string) => {
    try {
      api.logFrontend(level, msg)
    } catch {
      /* ignore */
    }
  }

  // 全局错误兜底
  window.addEventListener('error', (ev) => {
    const msg = `${ev.message} @ ${ev.filename}:${ev.lineno}`
    showToast(`JS 错误: ${msg}`, 'error')
    ;(window as any).__leon_log?.('error', msg)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const msg = String((ev.reason as any)?.message ?? ev.reason)
    showToast(`未处理异常: ${msg}`, 'error')
    ;(window as any).__leon_log?.('reject', msg)
  })
  ;(window as any).__leon_log?.('boot', `tauri=${isTauri()}`)

  try {
    // monaco-setup 已在 main.ts 中静态引入，这里只注册额外语言
    const { registerExtraLanguages } = await import('./lib/monaco-setup')
    registerExtraLanguages()
  } catch (e: any) {
    ;(window as any).__leon_log?.('monaco-setup', String(e?.message ?? e))
  }

  if (!isTauri()) {
    appReady.value = true
    return
  }

  try {
    const info = await api.getAppInfo()
    state.appInfo = info
    ;(window as any).__leon_log?.('info', JSON.stringify(info))
  } catch (e: any) {
    ;(window as any).__leon_log?.('getAppInfo', String(e?.message ?? e))
    showToast(`初始化失败: ${e?.message ?? e}`, 'error')
    appReady.value = true
    return
  }

  let settings: any = null
  try {
    settings = await api.loadSettings()
    const encs = await api.listEncodings()
    encodingOptions.value = encs
    await applySettings(settings)
    ;(window as any).__leon_log?.('settings', 'loaded')
  } catch (e: any) {
    ;(window as any).__leon_log?.('settings', String(e?.message ?? e))
  }

  // 恢复会话：先恢复磁盘文件，再恢复未保存的草稿（含从未落盘的新文件）
  try {
    if (settings?.restore_session) {
      const session = await api.loadSession()
      if (session.root_folder) {
        await openFolder(session.root_folder)
      }

      const drafts = session.drafts ?? []
      // 有未保存草稿的文件，不要再从磁盘开一遍（否则同一个文件会出现两个标签）
      const draftPaths = new Set(
        drafts.map((d: any) => d.path).filter((p: any) => typeof p === 'string' && p)
      )

      if (session.open_files?.length) {
        for (const f of session.open_files) {
          if (draftPaths.has(f.path)) continue
          try {
            const tab = await openFile(f.path)
            if (tab) {
              tab.cursorLine = f.cursor_line || 1
              tab.cursorCol = f.cursor_col || 1
              tab.scrollTop = f.scroll_top || 0
            }
          } catch {
            /* 文件可能已删除 */
          }
        }
      }

      // 未保存内容
      let restoredDrafts = 0
      if (drafts.length) {
        restoredDrafts = await restoreDrafts(drafts)
      }

      // 激活标签：优先草稿，其次文件
      let activated = false
      if (session.active_draft_id) {
        const dt = state.tabs.find((t) => t.draftId === session.active_draft_id)
        if (dt) {
          state.activeId = null
          activateTab(dt.id)
          activated = true
        }
      }
      if (!activated && session.active_path) {
        const t = state.tabs.find((t) => t.path === session.active_path)
        if (t) {
          state.activeId = null
          activateTab(t.id)
        }
      }

      ;(window as any).__leon_log?.(
        'session-restored',
        JSON.stringify({
          files: session.open_files?.length ?? 0,
          drafts: drafts.length,
          restoredDrafts,
          tabs: state.tabs.length
        })
      )
    }
  } catch (e: any) {
    ;(window as any).__leon_log?.('session', String(e?.message ?? e))
  }

  appReady.value = true
  window.addEventListener('keydown', onKeydown)

  // 渲染自检：把关键 DOM 状态写入日志，便于打包后验证
  window.setTimeout(async () => {
    const el = document.getElementById('app')
    const theme = document.documentElement.dataset.theme
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-app')
    const toolbar = document.querySelector('.toolbar')
    const tabs = document.querySelectorAll('.tab')
    const editor = document.querySelector('.monaco-editor')
    const statusbar = document.querySelector('.statusbar')
    const sidebar = document.querySelector('.sidebar')

    // 字体枚举自检
    let fontInfo = ''
    try {
      const fs = await api.listSystemFonts()
      const mono = fs.filter((f) => f.monospace).map((f) => f.name)
      fontInfo = `fonts=${fs.length} mono=${mono.length} monoSample=${mono.slice(0, 8).join('|')}`
    } catch (e: any) {
      fontInfo = `fonts=ERROR(${e?.message ?? e})`
    }

    ;(window as any).__leon_log?.(
      'render-check',
      JSON.stringify({
        theme,
        cssVarBg: bg.trim(),
        appChildren: el?.children.length ?? -1,
        hasToolbar: !!toolbar,
        toolbarHeight: toolbar ? Math.round((toolbar as HTMLElement).getBoundingClientRect().height) : 0,
        tabCount: tabs.length,
        tabTexts: Array.from(tabs).map((t) => (t.textContent ?? '').trim().slice(0, 30)),
        hasMonaco: !!editor,
        hasSidebar: !!sidebar,
        sidebarWidth: sidebar ? Math.round((sidebar as HTMLElement).getBoundingClientRect().width) : 0,
        hasStatusbar: !!statusbar,
        statusbarText: statusbar ? (statusbar.textContent ?? '').trim().slice(0, 120) : '',
        bodyBg: getComputedStyle(document.body).backgroundColor,
        openFiles: state.tabs.map((t) => t.name),
        fontCheck: fontInfo,
        // 软换行实际生效状态（从 Monaco 读，不是从配置读）
        wordWrapOption: (() => {
          try {
            const ed = (window as any).__leon_editor
            return ed ? ed.getOption(monaco.editor.EditorOption.wordWrap) : 'no-editor'
          } catch {
            return 'read-failed'
          }
        })()
      })
    )
  }, 2500)

  window.addEventListener('leon:open-find', () => openFind(false))
  window.addEventListener('leon:open-replace', () => openFind(true))
  window.addEventListener('leon:open-folder-search', () => openFolderSearch())
  window.addEventListener('leon:reload-tab', (e: any) => reloadTab(e.detail.id))
  window.addEventListener('leon:reload-dirty-tabs', () => reloadDirtyTabs())

  // 第二个实例启动时，后端会把参数发过来（单实例模式）
  try {
    const { listen } = await import('@tauri-apps/api/event')
    await listen<StartupArg[]>('leon:open-files', async (ev) => {
      const args = ev.payload ?? []
      await openStartupArgs(args)
      // 窗口可能被最小化，后端已处理；这里再刷一次焦点
      window.focus()
    })
  } catch (e: any) {
    ;(window as any).__leon_log?.('single-instance-listen', String(e?.message ?? e))
  }

  // 首次启动时的命令行参数（"用 Leon Editor 打开"场景）
  try {
    const args = await api.startupArgs()
    if (args.length) await openStartupArgs(args)
  } catch {
    /* 无参数 */
  }

  // 定时保存会话
  window.setInterval(saveSessionNow, 20000)
  window.addEventListener('beforeunload', saveSessionNow)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  saveSessionNow()
})

async function saveSessionNow() {
  if (!isTauri() || !state.settings?.restore_session) return
  try {
    // 先记录编辑器实时光标
    const ed = editorRef.value?.getEditor()
    const cur = activeTab()
    if (ed && cur) {
      const pos = ed.getPosition()
      if (pos) {
        cur.cursorLine = pos.lineNumber
        cur.cursorCol = pos.column
        cur.scrollTop = ed.getScrollTop()
      }
    }

    const snapshot = await buildSessionSnapshot()
    await api.saveSession(snapshot)

    // 清掉已被引用不到的草稿文件
    await api.pruneDrafts(snapshot.drafts.map((d: any) => d.id))
  } catch {
    /* 静默 */
  }
}

/* 点击别处关闭菜单 */
function onGlobalClick() {
  if (ctxMenu.value) ctxMenu.value = null
  if (showEncodingMenu.value) showEncodingMenu.value = false
}

watch(
  () => ctxMenu.value,
  (v) => {
    if (v) window.addEventListener('click', onGlobalClick, { once: true })
  }
)

/* 文件夹过滤快捷键 */
function onFilterKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    showFilter.value = false
    folderFilter.value = ''
    filterInput.value?.blur()
  }
}

const hasTabs = computed(() => state.tabs.length > 0)
const sidebarWidthPx = computed(() => `${state.sidebarWidth}px`)
</script>

<template>
  <div class="app" @dragover="onDragOver" @drop="onDrop">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="tb-left">
        <button class="icon-btn" :class="{ active: sidebarVisible }" title="显示/隐藏侧栏 (Ctrl+B)" @click="toggleSidebar">
          <Icon name="sidebar" :size="15" />
        </button>
        <div class="sep" />
        <button class="icon-btn" title="打开文件 (Ctrl+O)" @click="actionOpenFile">
          <Icon name="file" :size="15" />
        </button>
        <button class="icon-btn" title="打开文件夹 (Ctrl+K)" @click="actionOpenFolder">
          <Icon name="folder-open" :size="15" />
        </button>
        <button class="icon-btn" title="新建 (Ctrl+N)" @click="actionNew">
          <Icon name="file-plus" :size="15" />
        </button>
        <div class="sep" />
        <button class="icon-btn" :disabled="!hasTabs" title="保存 (Ctrl+S)" @click="actionSave">
          <Icon name="save" :size="15" />
        </button>
        <button
          class="icon-btn"
          :disabled="!hasTabs"
          title="另存为 (Ctrl+Shift+S)"
          @click="actionSaveAs"
        >
          <Icon name="save-as" :size="15" />
        </button>
        <div class="sep" />
        <button class="icon-btn" title="当前文件查找 (Ctrl+F)" @click="openFind(false)">
          <Icon name="search" :size="15" />
        </button>
        <button class="icon-btn" title="在整个文件夹查找 (Ctrl+Shift+F)" @click="openFolderSearch">
          <Icon name="search-folder" :size="15" />
        </button>
        <div class="sep" />
        <button
          class="icon-btn"
          :class="{ active: state.settings?.word_wrap }"
          title="软换行 (Alt+Z)"
          @click="toggleWordWrap"
        >
          <Icon name="wrap-text" :size="15" />
        </button>
        <div class="sep" />
        <button class="icon-btn" title="折叠全部" @click="editorRef?.foldAll()">
          <Icon name="fold-all" :size="15" />
        </button>
        <button class="icon-btn" title="展开全部" @click="editorRef?.unfoldAll()">
          <Icon name="unfold-all" :size="15" />
        </button>
      </div>

      <div class="tb-center">
        <input
          v-if="showFilter"
          ref="filterInput"
          v-model="folderFilter"
          class="field filter-box"
          placeholder="过滤文件名…"
          spellcheck="false"
          @keydown="onFilterKey"
        />
      </div>

      <div class="tb-right">
        <button
          class="icon-btn"
          :title="state.settings?.theme === 'dark' ? '切换到浅色' : '切换到深色'"
          @click="toggleTheme"
        >
          <Icon :name="state.settings?.theme === 'dark' ? 'sun' : 'moon'" :size="15" />
        </button>
        <button class="icon-btn" title="设置 (Ctrl+,)" @click="settingsVisible = true">
          <Icon name="settings" :size="15" />
        </button>
      </div>
    </div>

    <!-- 主体 -->
    <div class="main">
      <!-- 侧栏 -->
      <aside v-show="sidebarVisible" class="sidebar" :style="{ width: sidebarWidthPx }">
        <div class="sidebar-tabs">
          <button
            class="s-tab"
            :class="{ active: state.sidebarView === 'files' }"
            @click="state.sidebarView = 'files'"
          >
            <Icon name="folder" :size="13" /> 文件
          </button>
          <button
            class="s-tab"
            :class="{ active: state.sidebarView === 'search' }"
            @click="state.sidebarView = 'search'"
          >
            <Icon name="search" :size="13" /> 搜索
          </button>
          <div class="flex1" />
          <button
            v-if="state.sidebarView === 'files'"
            class="icon-btn small"
            :class="{ active: showFilter }"
            title="过滤文件"
            @click="showFilter = !showFilter; nextTick(() => filterInput?.focus())"
          >
            <Icon name="search" :size="12" />
          </button>
        </div>

        <div class="sidebar-content">
          <FileTree
            v-if="state.sidebarView === 'files'"
            :filter="folderFilter"
            @file-open="openFile($event)"
            @context-menu="openCtxMenu({ ...$event, kind: 'file' })"
          />
          <SearchPane v-else @open-hit="onOpenHit" @research="openFolderSearch" />
        </div>
      </aside>

      <!-- 拖拽条 -->
      <div v-if="sidebarVisible" class="resizer" :class="{ active: state.resizing }" @mousedown="startResize" />

      <!-- 右侧 -->
      <div class="workarea">
        <TabBar
          @context-menu="openCtxMenu({ ...$event, kind: 'tab' })"
        />
        <div class="editor-area">
          <EditorPane
            ref="editorRef"
            @cursor="onCursor"
            @save-request="actionSave"
          />
          <FindPanel
            ref="findRef"
            @find-local="onFindLocal"
            @goto-match="onGotoMatch"
            @clear-local="onClearLocal"
            @folder-result="() => {}"
          />
        </div>
      </div>
    </div>

    <!-- 状态栏 -->
    <StatusBar
      :line="cursor.line"
      :col="cursor.col"
      :selected="cursor.selected"
      v-model:show-encoding-menu="showEncodingMenu"
      @goto-line="actionGotoLine"
      @toggle-wordwrap="toggleWordWrap"
      @set-encoding="setEncoding"
      @set-eol="setEol"
    />

    <!-- 编码菜单 -->
    <div v-if="showEncodingMenu" class="enc-menu ctx-menu" @click.stop>
      <div class="ctx-label">以编码重新载入</div>
      <div
        v-for="o in encodingOptions"
        :key="o.id"
        class="ctx-item"
        @click="setEncoding(o.id)"
      >
        {{ o.label }}
        <Icon v-if="activeTab()?.encoding === o.id" name="check" :size="12" style="margin-left: auto" />
      </div>
      <div class="ctx-sep" />
      <div class="ctx-label">换行符</div>
      <div class="ctx-item" @click="setEol('lf')">
        LF (Unix)
        <Icon v-if="activeTab()?.eol === 'lf'" name="check" :size="12" style="margin-left: auto" />
      </div>
      <div class="ctx-item" @click="setEol('crlf')">
        CRLF (Windows)
        <Icon v-if="activeTab()?.eol === 'crlf'" name="check" :size="12" style="margin-left: auto" />
      </div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="ctxMenu"
      class="ctx-menu"
      :style="{ left: ctxMenu.x + 'px', top: Math.min(ctxMenu.y, window.innerHeight - 260) + 'px' }"
      @click.stop
    >
      <template v-if="ctxMenu.kind === 'file'">
        <div class="ctx-item" @click="handleOpenCtx">
          <Icon name="file" :size="13" /> 打开
        </div>
        <div class="ctx-item" @click="ctxCopyPath">
          <Icon name="copy-path" :size="13" /> 复制路径
        </div>
      </template>

      <template v-else-if="ctxMenu.kind === 'folder'">
        <div class="ctx-item" @click="ctxRefreshFolder">
          <Icon name="refresh" :size="13" /> 刷新
        </div>
        <div class="ctx-item" @click="ctxCopyPath">
          <Icon name="copy-path" :size="13" /> 复制路径
        </div>
      </template>

      <template v-else-if="ctxMenu.kind === 'tab'">
        <div class="ctx-item" @click="ctxCloseTab">
          <Icon name="close" :size="13" /> 关闭
        </div>
        <div class="ctx-item" @click="ctxCloseOthers">
          <Icon name="close-all" :size="13" /> 关闭其他
        </div>
        <div class="ctx-sep" />
        <div class="ctx-item" @click="ctxCopyPath">
          <Icon name="copy-path" :size="13" /> 复制完整路径
        </div>
      </template>
    </div>

    <!-- 快速打开 -->
    <QuickOpen
      :show="quickOpenVisible"
      @close="quickOpenVisible = false"
      @pick="(p: string) => { quickOpenVisible = false; openFile(p) }"
    />

    <!-- 设置 -->
    <SettingsPanel :show="settingsVisible" @close="settingsVisible = false" />

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="state.toast" class="toast" :class="state.toast.kind">
        <Icon
          :name="state.toast.kind === 'error' ? 'warning' : state.toast.kind === 'success' ? 'check' : 'info'"
          :size="14"
        />
        {{ state.toast.text }}
      </div>
    </Transition>

    <!-- 非 Tauri 环境提示 -->
    <div v-if="noTauri" class="dev-banner">
      当前在浏览器中预览，文件系统功能不可用。请运行 <code>npm run tauri:dev</code>。
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
  overflow: hidden;
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: var(--titlebar-h);
  padding: 0 8px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tb-left,
.tb-right {
  display: flex;
  align-items: center;
  gap: 1px;
}

.tb-center {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 0;
}

.filter-box {
  width: 260px;
  height: 24px;
  font-size: 12px;
}

/* 主体 */
.main {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.sidebar {
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  flex-shrink: 0;
  overflow: hidden;
}

.sidebar-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 0 4px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.s-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: 4px;
  font-size: 11.5px;
  color: var(--text-dim);
  white-space: nowrap;
}

.s-tab:hover {
  background: var(--bg-hover);
}

.s-tab.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.flex1 {
  flex: 1;
}

.icon-btn.small {
  width: 20px;
  height: 20px;
}

.sidebar-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.resizer {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  transition: background var(--transition);
  margin-left: -2px;
  margin-right: -2px;
  z-index: 5;
}

.resizer:hover,
.resizer.active {
  background: var(--accent);
}

.workarea {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.editor-area {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* 编码菜单定位 */
.enc-menu {
  position: fixed;
  right: 12px;
  bottom: 30px;
  top: auto;
  left: auto;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9800;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 16px;
  border-radius: 6px;
  background: var(--bg-overlay);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow);
  font-size: 12.5px;
  color: var(--text);
  max-width: 70vw;
}

.toast.error {
  border-color: var(--danger);
  color: var(--danger);
}

.toast.success {
  border-color: var(--success);
  color: var(--success);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s, transform 0.18s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}

/* 开发提示 */
.dev-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 4px 10px;
  background: var(--warn);
  color: #000;
  font-size: 11px;
  text-align: center;
  z-index: 9900;
}

.dev-banner code {
  background: rgba(0, 0, 0, 0.15);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
}
</style>
