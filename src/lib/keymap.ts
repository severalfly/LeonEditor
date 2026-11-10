/**
 * 应用级快捷键注册表。
 *
 * 设计要点：
 * - 每个动作只有一份定义（id / 名称 / 分组 / 默认键 / 运行时生效键），
 *   界面、匹配、持久化全部读同一份数据，不会出现「文档写一套、代码跑另一套」。
 * - 匹配一律用 KeyboardEvent.code（物理键位），不用 e.key。
 *   否则换一个键盘布局（法语 AZERTY、俄语、中文输入法全角态）就失灵。
 * - 修饰键要求**精确匹配**：Ctrl+S 不会在按住 Shift 时被误触发。
 *
 * Monaco 自带的编辑器级快捷键（撤销、多选、缩进、折叠……）不在这里，
 * 它们由 Monaco 自己管理，也不出现在设置界面里。
 */
import { reactive } from 'vue'

export interface KeyAction {
  id: string
  /** 界面展示名 */
  label: string
  /** 设置界面里的分组 */
  group: string
  /** 默认组合键，形如 "ctrl+alt+shift+d" */
  defaultKeys: string
  /** 运行时实际生效的组合键 */
  keys: string
  /** 简短说明（设置界面第二行小字） */
  desc?: string
}

/** 全局录制状态：设置界面录制快捷键时，主窗口的快捷键分发要让位 */
export const keymapState = reactive({
  recording: false
})

const DEFS: Omit<KeyAction, 'keys'>[] = [
  // ---------- 文件 ----------
  { id: 'open-file', label: '打开文件', group: '文件', defaultKeys: 'ctrl+o' },
  { id: 'open-folder', label: '打开文件夹', group: '文件', defaultKeys: 'ctrl+k' },
  { id: 'new-file', label: '新建文件', group: '文件', defaultKeys: 'ctrl+n' },
  { id: 'save', label: '保存', group: '文件', defaultKeys: 'ctrl+s' },
  { id: 'save-as', label: '另存为', group: '文件', defaultKeys: 'ctrl+shift+s' },
  { id: 'close-tab', label: '关闭当前标签', group: '文件', defaultKeys: 'ctrl+w' },

  // ---------- 导航 ----------
  { id: 'next-tab', label: '下一个标签', group: '导航', defaultKeys: 'ctrl+tab' },
  { id: 'prev-tab', label: '上一个标签', group: '导航', defaultKeys: 'ctrl+shift+tab' },
  { id: 'quick-open', label: '快速打开文件', group: '导航', defaultKeys: 'ctrl+p' },
  { id: 'find', label: '当前文件查找', group: '导航', defaultKeys: 'ctrl+f' },
  { id: 'replace', label: '当前文件替换', group: '导航', defaultKeys: 'ctrl+h' },
  { id: 'folder-search', label: '整个文件夹搜索', group: '导航', defaultKeys: 'ctrl+shift+f' },
  { id: 'goto-line', label: '跳转到行', group: '导航', defaultKeys: 'ctrl+g' },

  // ---------- 视图 ----------
  { id: 'toggle-sidebar', label: '显示 / 隐藏侧栏', group: '视图', defaultKeys: 'ctrl+b' },
  { id: 'settings', label: '打开设置', group: '视图', defaultKeys: 'ctrl+comma' },
  { id: 'toggle-wordwrap', label: '软换行开关', group: '视图', defaultKeys: 'alt+z' },

  // ---------- 编辑 ----------
  {
    id: 'format',
    label: '格式化（选区或全文）',
    group: '编辑',
    defaultKeys: 'ctrl+alt+j',
    desc: '有选区只格式化选区，没有选区格式化整个文档'
  },
  {
    id: 'transform-remove-newlines',
    label: '删除换行',
    group: '编辑',
    defaultKeys: 'ctrl+alt+shift+d',
    desc: '有选区只处理选区，没有选区处理整个文档'
  },
  {
    id: 'transform-remove-ampersand',
    label: '删除 & 符号',
    group: '编辑',
    defaultKeys: 'ctrl+alt+shift+7',
    desc: '顺带清理多余空格'
  },
  {
    id: 'transform-sql-in',
    label: '转 SQL IN 格式',
    group: '编辑',
    defaultKeys: 'ctrl+alt+shift+l',
    desc: '每行一个值，自动剥掉原有引号再加'
  }
]

export const keyActions = reactive<KeyAction[]>(
  DEFS.map((d) => ({ ...d, keys: d.defaultKeys }))
)

export const KEY_GROUPS = ['文件', '导航', '视图', '编辑']

/* ---------------- 解析 ---------------- */

export interface ParsedKeys {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  code: string
}

const MOD_ALIASES: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  meta: 'meta',
  win: 'meta',
  cmd: 'meta',
  super: 'meta'
}

/** 单个按键名 → KeyboardEvent.code */
const CODE_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  minus: 'Minus',
  equal: 'Equal',
  comma: 'Comma',
  period: 'Period',
  slash: 'Slash',
  semicolon: 'Semicolon',
  quote: 'Quote',
  backquote: 'Backquote',
  bracketleft: 'BracketLeft',
  bracketright: 'BracketRight',
  backslash: 'Backslash'
}

function normalizeCode(token: string): string | null {
  const t = token.trim()
  if (!t) return null
  if (CODE_ALIASES[t]) return CODE_ALIASES[t]
  // 已经是标准 code
  if (/^(Key[A-Z]|Digit\d|Numpad\d|F\d{1,2}|Arrow\w+|Escape|Tab|Enter|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Minus|Equal|Comma|Period|Slash|Semicolon|Quote|Backquote|BracketLeft|BracketRight|Backslash)$/.test(t)) {
    return t
  }
  const lower = t.toLowerCase()
  // 单字母 → KeyX
  if (/^[a-z]$/.test(lower)) return 'Key' + lower.toUpperCase()
  // 单个数字 → DigitN
  if (/^[0-9]$/.test(lower)) return 'Digit' + lower
  // f1..f24
  if (/^f\d{1,2}$/.test(lower)) return 'F' + lower.slice(1)
  // keyx / digitn 小写写法
  if (/^key[a-z]$/.test(lower)) return 'Key' + lower.slice(3).toUpperCase()
  if (/^digit\d$/.test(lower)) return 'Digit' + lower.slice(5)
  if (/^numpad\d$/.test(lower)) return 'Numpad' + lower.slice(6)
  if (/^arrow(up|down|left|right)$/.test(lower)) {
    return 'Arrow' + lower.slice(5, 6).toUpperCase() + lower.slice(6)
  }
  return null
}

/** "ctrl+alt+shift+d" → 修饰键 + code。无法解析返回 null */
export function parseKeys(input: string | null | undefined): ParsedKeys | null {
  if (!input) return null
  let src = String(input).trim()
  // "ctrl+," 这类以逗号结尾的写法直接 split 会把逗号当分隔符吃掉
  if (src.endsWith('+,') || src === ',') src = src.slice(0, src.length - 1) + 'comma'
  const parts = src
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  const res: ParsedKeys = { ctrl: false, alt: false, shift: false, meta: false, code: '' }
  for (let i = 0; i < parts.length - 1; i++) {
    const mod = MOD_ALIASES[parts[i].toLowerCase()]
    if (!mod) return null
    res[mod] = true
  }
  const code = normalizeCode(parts[parts.length - 1])
  if (!code) return null
  res.code = code
  return res
}

/** 规范化成 "ctrl+alt+shift+d" 形式；顺序固定，便于比较与去重 */
export function normalizeKeys(input: string): string | null {
  const p = parseKeys(input)
  if (!p) return null
  const parts: string[] = []
  if (p.ctrl) parts.push('ctrl')
  if (p.alt) parts.push('alt')
  if (p.shift) parts.push('shift')
  if (p.meta) parts.push('meta')
  parts.push(codeToToken(p.code))
  return parts.join('+')
}

function codeToToken(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return 'numpad' + code.slice(6)
  if (/^F\d{1,2}$/.test(code)) return code.toLowerCase()
  const rev: Record<string, string> = {
    Escape: 'esc',
    Tab: 'tab',
    Enter: 'enter',
    Space: 'space',
    Backspace: 'backspace',
    Delete: 'delete',
    Insert: 'insert',
    Home: 'home',
    End: 'end',
    PageUp: 'pageup',
    PageDown: 'pagedown',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Minus: 'minus',
    Equal: 'equal',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\'
  }
  return rev[code] ?? code.toLowerCase()
}

/* ---------------- 展示 ---------------- */

const CODE_LABELS: Record<string, string> = {
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backspace: 'Backspace',
  Delete: 'Del'
}

/** "ctrl+alt+shift+d" → "Ctrl+Alt+Shift+D" */
export function formatKeys(input: string | null | undefined): string {
  const p = parseKeys(input)
  if (!p) return String(input ?? '')
  const out: string[] = []
  if (p.ctrl) out.push('Ctrl')
  if (p.alt) out.push('Alt')
  if (p.shift) out.push('Shift')
  if (p.meta) out.push('Win')
  let key = CODE_LABELS[p.code]
  if (!key) {
    if (/^Key[A-Z]$/.test(p.code)) key = p.code.slice(3)
    else if (/^Digit\d$/.test(p.code)) key = p.code.slice(5)
    else if (/^Numpad\d$/.test(p.code)) key = 'Num' + p.code.slice(6)
    else key = p.code
  }
  out.push(key)
  return out.join('+')
}

/* ---------------- 匹配 ---------------- */

function codeMatches(eventCode: string, bindingCode: string): boolean {
  if (eventCode === bindingCode) return true
  // 小键盘数字视同主键盘数字（默认键位里写了 Digit7 的人按 Numpad7 也该生效）
  if (bindingCode.startsWith('Digit') && eventCode === 'Numpad' + bindingCode.slice(5)) return true
  if (bindingCode.startsWith('Numpad') && eventCode === 'Digit' + bindingCode.slice(6)) return true
  return false
}

export function matchEvent(e: KeyboardEvent, input: string): boolean {
  const p = parseKeys(input)
  if (!p) return false
  const ctrl = e.ctrlKey || e.metaKey
  if (p.ctrl !== ctrl) return false
  if (p.alt !== e.altKey) return false
  if (p.shift !== e.shiftKey) return false
  // binding 显式要求 Win 键时才校验 meta
  if (p.meta && !e.metaKey) return false
  return codeMatches(e.code, p.code)
}

/** 找出这次按键命中的应用级动作 */
export function findActionForEvent(e: KeyboardEvent): KeyAction | null {
  // 单独的修饰键不参与匹配
  if (e.code.startsWith('Control') || e.code.startsWith('Shift') || e.code.startsWith('Alt') || e.code.startsWith('Meta')) {
    return null
  }
  for (const a of keyActions) {
    if (matchEvent(e, a.keys)) return a
  }
  return null
}

/**
 * 把一次按键事件转成组合键字符串，用于录制。
 * 只是修饰键（或只有修饰键按下）时返回 null。
 */
export function keysFromEvent(e: KeyboardEvent): string | null {
  if (e.code.startsWith('Control') || e.code.startsWith('Shift') || e.code.startsWith('Alt') || e.code.startsWith('Meta')) {
    return null
  }
  const code = normalizeCode(e.code)
  if (!code) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(codeToToken(code))
  return parts.join('+')
}

/* ---------------- 增删改 ---------------- */

export function getAction(id: string): KeyAction | undefined {
  return keyActions.find((a) => a.id === id)
}

export function sameBinding(a: string, b: string): boolean {
  const na = normalizeKeys(a)
  const nb = normalizeKeys(b)
  return !!na && na === nb
}

/** 与其它动作的绑定冲突时返回那个动作 */
export function findConflict(keys: string, exceptId: string): KeyAction | undefined {
  return keyActions.find((a) => a.id !== exceptId && sameBinding(a.keys, keys))
}

export function setKeys(id: string, keys: string) {
  const a = getAction(id)
  if (a) a.keys = keys
}

export function resetKeys(id: string) {
  const a = getAction(id)
  if (a) a.keys = a.defaultKeys
}

export function resetAllKeys() {
  for (const a of keyActions) a.keys = a.defaultKeys
}

/** 应用持久化的绑定表（未出现在表里的动作回到默认） */
export function applyBindings(map: Record<string, string> | null | undefined) {
  for (const a of keyActions) {
    const v = map?.[a.id]
    a.keys = v && parseKeys(v) ? v : a.defaultKeys
  }
}

/** 只收集被改过的项，写进 settings.json */
export function collectOverrides(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of keyActions) {
    if (!sameBinding(a.keys, a.defaultKeys)) out[a.id] = a.keys
  }
  return out
}
