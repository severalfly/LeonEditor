/**
 * 当前文件内的查找 / 替换。
 *
 * 两个关键点：
 *
 * 1. 正则构造统一在这里，高亮（runFind）与替换用**同一个** pattern，
 *    否则会出现「正文标了 N 处高亮，替换却说 0 处」的不一致。
 * 2. 替换走 Monaco model 的内存编辑（pushEditOperations），不碰磁盘：
 *    未命名文件也能替换，替换结果进撤销栈，Ctrl+Z 可以回退，
 *    之后由用户自己 Ctrl+S 落盘。
 */
import * as monaco from 'monaco-editor'
import { getEditorInstance } from './store'

export interface LocalSearchOpts {
  query: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}

export interface LocalReplaceOpts extends LocalSearchOpts {
  replacement: string
}

/** 单次替换的匹配上限，避免在超大文件里卡死 */
const MAX_MATCHES = 50000

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 构造查找用的正则源码。
 *
 * 全字匹配用「前后都不是 \w」的零宽断言，而不是 `\b`：
 * JS 的 `\b` 基于 `\w`（只有 ASCII 单词字符），中文前后永远构不成边界，
 * 用 `\b(?:中文)\b` 会得到 0 命中。
 */
export function buildSearchPattern(opts: LocalSearchOpts): string {
  let p = opts.regex ? opts.query : escapeRegExp(opts.query)
  if (opts.wholeWord) p = `(?<![\\w])(?:${p})(?![\\w])`
  return p
}

/** 给高亮用的 RegExp（全局，大小写由选项决定）；语法错误返回 null */
export function createSearchRegex(opts: LocalSearchOpts): RegExp | null {
  try {
    return new RegExp(buildSearchPattern(opts), opts.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

/**
 * 展开替换文本里的 `$1` / `$&` / `$$`。
 * 非正则模式按字面量替换，`$` 不当分组（否则用户搜 `price$` 会被吞）。
 */
export function expandReplacement(repl: string, groups: string[] | null): string {
  if (!groups) return repl
  return repl.replace(/\$(\$|&|\d{1,2})/g, (_all, tok: string) => {
    if (tok === '$') return '$'
    if (tok === '&') return groups[0] ?? ''
    const i = parseInt(tok, 10)
    return groups[i] ?? ''
  })
}

function collectMatches(
  ed: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  pattern: string,
  caseSensitive: boolean
): monaco.editor.FindMatch[] {
  try {
    // isRegex 恒为 true：pattern 已由 buildSearchPattern 处理好字面量转义
    return model.findMatches(pattern, false, true, caseSensitive, null, true, MAX_MATCHES)
  } catch {
    return []
  }
}

/** 当前文件全部替换，返回替换处数 */
export function replaceAllInModel(opts: LocalReplaceOpts): number {
  const ed = getEditorInstance()
  const model = ed?.getModel()
  if (!ed || !model || !opts.query) return 0

  const found = collectMatches(ed, model, buildSearchPattern(opts), opts.caseSensitive)
  if (!found.length) return 0

  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = found.map((m) => ({
    range: m.range,
    text: expandReplacement(opts.replacement, opts.regex ? m.matches : null),
    forceMoveMarkers: true
  }))
  // 倒序应用：靠后的位置先改，前面的位置不受影响
  edits.reverse()

  // 前后各封一次栈：整批替换是「一步撤销」，之后的输入不会混进同一步
  model.pushStackElement()
  model.pushEditOperations([], edits, () => null)
  model.pushStackElement()
  ed.focus()
  return edits.length
}

/**
 * 替换一处：从当前选区末尾（无选区则是光标）往后找第一个匹配，
 * 到末尾没找到就绕回文件开头。替换后选区落在结果上。
 */
export function replaceOneInModel(opts: LocalReplaceOpts): number {
  const ed = getEditorInstance()
  const model = ed?.getModel()
  if (!ed || !model || !opts.query) return 0

  const found = collectMatches(ed, model, buildSearchPattern(opts), opts.caseSensitive)
  if (!found.length) return 0

  const sel = ed.getSelection()
  const fromOffset = sel ? model.getOffsetAt(sel.getEndPosition()) : 0
  const offsetOf = (r: monaco.Range) => model.getOffsetAt(r.getStartPosition())

  let target = found.find((m) => offsetOf(m.range) >= fromOffset)
  if (!target) target = found[0] // wrap 到开头

  const text = expandReplacement(opts.replacement, opts.regex ? target.matches : null)
  const startPos = target.range.getStartPosition()

  model.pushStackElement()
  model.pushEditOperations([], [{ range: target.range, text, forceMoveMarkers: true }], () => null)
  model.pushStackElement()

  // 插入发生在起始位置之后，起始位置本身不受影响
  const startOffset = model.getOffsetAt(startPos)
  const endPos = model.getPositionAt(startOffset + text.length)
  ed.setSelection(
    new monaco.Selection(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column)
  )
  ed.revealPositionInCenterIfOutsideViewport(startPos, monaco.editor.ScrollType.Smooth)
  ed.focus()
  return 1
}
