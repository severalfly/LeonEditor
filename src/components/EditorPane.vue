<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as monaco from 'monaco-editor'
import { state, setEditorInstance, activeTab, getModelFor, tabKey, applySettings } from '../lib/store'

const hostEl = ref<HTMLElement | null>(null)
let ed: monaco.editor.IStandaloneCodeEditor | null = null
let decorations: monaco.editor.IEditorDecorationsCollection | null = null

/** 光标位置上报（给状态栏） */
const emit = defineEmits<{
  (e: 'cursor', payload: { line: number; col: number; selected: number }): void
  (e: 'save-request'): void
}>()

onMounted(async () => {
  if (!hostEl.value) return

  ed = monaco.editor.create(hostEl.value, {
    value: '',
    language: 'plaintext',
    theme: state.settings?.theme === 'dark' ? 'leon-dark' : 'leon-light',
    automaticLayout: true,
    fontFamily: state.settings?.font_family ?? 'Consolas, monospace',
    fontSize: state.settings?.font_size ?? 14,
    fontLigatures: true,
    lineHeight: 1.55,
    letterSpacing: 0,
    minimap: {
      enabled: state.settings?.show_minimap ?? true,
      renderCharacters: false,
      maxColumn: 90,
      showSlider: 'mouseover'
    },
    scrollBeyondLastLine: true,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderLineHighlight: state.settings?.highlight_current_line ? 'line' : 'none',
    lineNumbers: state.settings?.show_line_numbers ? 'on' : 'off',
    wordWrap: state.settings?.word_wrap ? 'on' : 'off',
    tabSize: state.settings?.tab_size ?? 4,
    insertSpaces: state.settings?.insert_spaces ?? true,
    detectIndentation: false,
    renderWhitespace: 'selection',
    renderControlCharacters: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
    folding: true,
    foldingHighlight: true,
    showFoldingControls: 'mouseover',
    scrollbar: {
      vertical: 'auto',
      horizontal: 'auto',
      verticalScrollbarSize: 12,
      horizontalScrollbarSize: 12,
      useShadows: false
    },
    padding: { top: 8, bottom: 40 },
    suggest: { showWords: true, preview: true },
    quickSuggestions: { other: true, comments: false, strings: false },
    wordBasedSuggestions: 'matchingDocuments',
    formatOnPaste: false,
    multiCursorModifier: 'alt',
    linkedEditing: true,
    occurrencesHighlight: 'singleFile',
    selectionHighlight: true,
    stickyScroll: { enabled: false },
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    contextmenu: true,
    mouseWheelZoom: true
  })

  setEditorInstance(ed)
  decorations = ed.createDecorationsCollection([])

  // 光标变化上报
  ed.onDidChangeCursorPosition((e) => {
    emit('cursor', {
      line: e.position.lineNumber,
      col: e.position.column,
      selected: ed!.getModel()?.getValueInRange(ed!.getSelection()!).length ?? 0
    })
    // 同步给 tab 记录
    const t = activeTab()
    if (t) {
      t.cursorLine = e.position.lineNumber
      t.cursorCol = e.position.column
    }
  })

  ed.onDidChangeCursorSelection(() => {
    const sel = ed!.getSelection()
    const count = ed!.getModel()?.getValueInRange(sel!).length ?? 0
    const pos = ed!.getPosition()
    if (pos) emit('cursor', { line: pos.lineNumber, col: pos.column, selected: count })
  })

  // 快捷键：Ctrl+S
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    emit('save-request')
  })

  // Ctrl+F 交给外部面板处理
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
    window.dispatchEvent(new CustomEvent('leon:open-find'))
  })

  // Ctrl+H
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
    window.dispatchEvent(new CustomEvent('leon:open-replace'))
  })

  // Ctrl+Shift+F 全局搜索
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
    window.dispatchEvent(new CustomEvent('leon:open-folder-search'))
  })

  // 首次设置默认 model
  if (activeTab()) {
    switchToActive()
  }
})

onBeforeUnmount(() => {
  ed?.dispose()
  ed = null
})

/** 切换到当前激活标签的 model */
function switchToActive() {
  if (!ed) return
  const tab = activeTab()
  if (!tab) {
    ed.setModel(null)
    return
  }
  const model = getModelFor(tab)
  if (!model || model.isDisposed()) {
    ed.setModel(null)
    return
  }
  if (ed.getModel() !== model) {
    ed.setModel(model)
  }
  ed.updateOptions({ readOnly: tab.readOnly || tab.binary })
  ed.setPosition({ lineNumber: tab.cursorLine || 1, column: tab.cursorCol || 1 })
  ed.setScrollTop(tab.scrollTop || 0)
  if (!tab.binary) ed.focus()
}

// 监听激活标签变化
watch(
  () => state.activeId,
  async () => {
    await nextTick()
    switchToActive()
    if (state.findVisible && state.findQuery) {
      runLocalHighlight()
    } else {
      clearHighlight()
    }
  }
)

/* ---------------- 当前文件内查找高亮 ---------------- */

let localMatches: monaco.Range[] = []

function runFind(opts: {
  query: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
}): { count: number; index: number } {
  if (!ed) return { count: 0, index: -1 }
  const model = ed.getModel()
  if (!model || !opts.query) {
    clearHighlight()
    return { count: 0, index: -1 }
  }

  localMatches = []
  const text = model.getValue()
  try {
    let pattern = opts.regex ? opts.query : escapeRegExp(opts.query)
    if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`
    const re = new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi')
    let m: RegExpExecArray | null
    let guard = 0
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      const start = model.getPositionAt(m.index)
      const end = model.getPositionAt(m.index + m[0].length)
      localMatches.push(
        new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
      )
      if (++guard > 20000) break
    }
  } catch {
    return { count: 0, index: -1 }
  }

  decorations?.set(
    localMatches.map((r) => ({
      range: r,
      options: {
        inlineClassName: 'leon-find-match',
        overviewRuler: {
          color: '#ffd33d',
          position: monaco.editor.OverviewRulerLane.Center
        }
      }
    }))
  )

  return { count: localMatches.length, index: localMatches.length ? 0 : -1 }
}

function focusMatch(index: number) {
  if (!ed || !localMatches.length) return
  const i = ((index % localMatches.length) + localMatches.length) % localMatches.length
  const range = localMatches[i]
  ed.setSelection(range)
  ed.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Smooth)
  ed.focus()
}

function getMatchCount() {
  return localMatches.length
}

function clearHighlight() {
  localMatches = []
  decorations?.clear()
}

function runLocalHighlight() {
  runFind({
    query: state.findQuery,
    regex: state.findRegex,
    caseSensitive: state.findCaseSensitive,
    wholeWord: state.findWholeWord
  })
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ---------------- 跳转到指定行 ---------------- */

function gotoLine(line: number, col = 1) {
  if (!ed) return
  const model = ed.getModel()
  if (!model) return
  const l = Math.min(Math.max(1, line), model.getLineCount())
  const c = Math.min(Math.max(1, col), model.getLineMaxColumn(l))
  ed.setPosition({ lineNumber: l, column: c })
  ed.revealPositionInCenter({ lineNumber: l, column: c }, monaco.editor.ScrollType.Smooth)
  ed.focus()
}

/** 选中一个范围用于高亮某次匹配 */
function selectRange(line: number, startChar: number, endChar: number, flash = true) {
  if (!ed) return
  const model = ed.getModel()
  if (!model) return
  const l = Math.min(Math.max(1, line), model.getLineCount())
  const lineMax = model.getLineMaxColumn(l)
  const s = Math.min(Math.max(1, startChar + 1), lineMax)
  const e = Math.min(Math.max(s, endChar + 1), lineMax)
  const range = new monaco.Range(l, s, l, e)
  ed.setSelection(range)
  ed.revealLineInCenterIfOutsideViewport(l, monaco.editor.ScrollType.Smooth)
  ed.focus()
  if (flash) {
    const d = ed.createDecorationsCollection([
      {
        range,
        options: { inlineClassName: 'leon-find-flash', isWholeLine: false }
      }
    ])
    window.setTimeout(() => d.clear(), 900)
  }
}

/* ---------------- 折叠 ---------------- */

function foldAll() {
  ed?.trigger('toolbar', 'editor.foldAll', null)
}

function unfoldAll() {
  ed?.trigger('toolbar', 'editor.unfoldAll', null)
}

function formatDocument() {
  ed?.getAction('editor.action.formatDocument')?.run()
}

/* ---------------- 编辑命令 ---------------- */

function undo() {
  ed?.trigger('toolbar', 'undo', null)
}

function redo() {
  ed?.trigger('toolbar', 'redo', null)
}

function selectAll() {
  ed?.trigger('toolbar', 'editor.action.selectAll', null)
}

function getEditor() {
  return ed
}

/* ---------------- 文本转换 ---------------- */

/**
 * 对选区（无选区则全文）应用一次文本变换。
 * 用 executeEdits 让修改进入撤销栈，Ctrl+Z 可以回退。
 * 返回受影响的行数/是否成功。
 */
function applyTransform(fn: (text: string) => string): { ok: boolean; scope: 'selection' | 'document' } {
  if (!ed) return { ok: false, scope: 'document' }
  const model = ed.getModel()
  if (!model) return { ok: false, scope: 'document' }

  const sel = ed.getSelection()
  if (!sel) return { ok: false, scope: 'document' }

  const hasSelection = !sel.isEmpty()
  const range = hasSelection
    ? sel
    : new monaco.Range(1, 1, model.getLineCount(), model.getLineMaxColumn(model.getLineCount()))

  const original = model.getValueInRange(range)
  const converted = fn(original)

  if (converted === original) {
    return { ok: false, scope: hasSelection ? 'selection' : 'document' }
  }

  ed.executeEdits('leon-transform', [
    {
      range,
      text: converted,
      forceMoveMarkers: true
    }
  ])

  // 转换后选中新内容，方便继续操作
  const endPos = model.getPositionAt(
    model.getOffsetAt(range.getStartPosition()) + converted.length
  )
  ed.setSelection(
    new monaco.Selection(
      range.startLineNumber,
      range.startColumn,
      endPos.lineNumber,
      endPos.column
    )
  )
  ed.focus()
  return { ok: true, scope: hasSelection ? 'selection' : 'document' }
}

defineExpose({
  runFind,
  focusMatch,
  getMatchCount,
  clearHighlight,
  gotoLine,
  selectRange,
  foldAll,
  unfoldAll,
  getEditor,
  applyTransform
})
</script>

<template>
  <div class="editor-wrap">
    <div ref="hostEl" class="editor-host" />
    <div v-if="!activeTab()" class="welcome">
      <div class="brand">Leon Editor</div>
      <div class="hints">
        <div class="hint-row"><kbd>Ctrl</kbd><kbd>O</kbd><span>打开文件</span></div>
        <div class="hint-row"><kbd>Ctrl</kbd><kbd>K</kbd><span>打开文件夹</span></div>
        <div class="hint-row"><kbd>Ctrl</kbd><kbd>N</kbd><span>新建文件</span></div>
        <div class="hint-row"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>F</kbd><span>全局搜索</span></div>
        <div class="hint-row"><kbd>Ctrl</kbd><kbd>P</kbd><span>快速打开文件</span></div>
        <div class="hint-row"><kbd>Ctrl</kbd><kbd>G</kbd><span>跳转到行</span></div>
      </div>
      <div class="tip">把文件直接拖进窗口也能打开</div>
    </div>
  </div>
</template>

<style scoped>
.editor-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-editor);
}

.editor-host {
  position: absolute;
  inset: 0;
}

.welcome {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26px;
  pointer-events: none;
  color: var(--text-faint);
  background: var(--bg-editor);
}

.brand {
  font-size: 30px;
  font-weight: 200;
  letter-spacing: 3px;
  color: var(--text-dim);
  opacity: 0.75;
}

.hints {
  display: grid;
  grid-template-columns: auto auto;
  gap: 10px 34px;
}

.hint-row {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.hint-row span {
  margin-left: 6px;
  color: var(--text-faint);
}

kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 19px;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--bg-sidebar);
  font-family: var(--font-ui);
  font-size: 10.5px;
  color: var(--text-dim);
}

.tip {
  font-size: 11.5px;
  opacity: 0.65;
}
</style>

<style>
/* 全局：查找匹配高亮（Monaco 装饰器在文档层） */
.leon-find-match {
  background: rgba(255, 210, 0, 0.35);
  border-radius: 2px;
}

.leon-find-flash {
  background: rgba(255, 160, 0, 0.45);
  border-radius: 2px;
  animation: leon-flash 0.85s ease-out;
}

@keyframes leon-flash {
  0% {
    background: rgba(255, 120, 0, 0.75);
  }
  100% {
    background: rgba(255, 160, 0, 0.1);
  }
}
</style>
