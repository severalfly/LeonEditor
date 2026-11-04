import * as monaco from 'monaco-editor'

// Monaco 的 workers（语法高亮/校验）用 vite 的 worker 机制引入
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  }
}

const SHARED_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'cf222e' },
  { token: 'keyword.sql', foreground: '0550ae', fontStyle: 'bold' },
  { token: 'string', foreground: '0a3069' },
  { token: 'number', foreground: '0550ae' },
  { token: 'type', foreground: '953800' },
  { token: 'identifier', foreground: '1f2328' },
  { token: 'delimiter', foreground: '57606a' }
]

/** 浅色主题：贴近 GitHub Light */
monaco.editor.defineTheme('leon-light', {
  base: 'vs',
  inherit: true,
  rules: SHARED_RULES,
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2328',
    'editorLineNumber.foreground': '#b1b7be',
    'editorLineNumber.activeForeground': '#1f2328',
    'editor.lineHighlightBackground': '#f6f8fa',
    'editor.selectionBackground': '#b6d7ff',
    'editor.inactiveSelectionBackground': '#dbe9f9',
    'editorCursor.foreground': '#0969da',
    'editorWhitespace.foreground': '#d8dde3',
    'editorIndentGuide.background1': '#eceff2',
    'editorIndentGuide.activeBackground1': '#c6cbd2',
    'editor.findMatchBackground': '#ffdf5d',
    'editor.findMatchHighlightBackground': '#ffe89b',
    'editorGutter.background': '#ffffff',
    'minimap.background': '#fbfcfd',
    'editorOverviewRuler.border': '#00000000',
    'scrollbarSlider.background': '#00000012',
    'scrollbarSlider.hoverBackground': '#00000024',
    'scrollbarSlider.activeBackground': '#00000034',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#dcdfe4',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.selectedBackground': '#e8f0fe',
    'editorHoverWidget.background': '#ffffff'
  }
})

/** 深色主题：贴近 One Dark Pro 的观感 */
monaco.editor.defineTheme('leon-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b717d', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c678dd' },
    { token: 'keyword.sql', foreground: '61afef', fontStyle: 'bold' },
    { token: 'string', foreground: '98c379' },
    { token: 'number', foreground: 'd19a66' },
    { token: 'type', foreground: 'e5c07b' },
    { token: 'identifier', foreground: 'dcdfe4' },
    { token: 'delimiter', foreground: '8b949e' }
  ],
  colors: {
    'editor.background': '#1e2127',
    'editor.foreground': '#dcdfe4',
    'editorLineNumber.foreground': '#4b5263',
    'editorLineNumber.activeForeground': '#dcdfe4',
    'editor.lineHighlightBackground': '#23262d',
    'editor.selectionBackground': '#37517c',
    'editor.inactiveSelectionBackground': '#2c3a52',
    'editorCursor.foreground': '#528bff',
    'editorWhitespace.foreground': '#3b4048',
    'editorIndentGuide.background1': '#2b2f37',
    'editorIndentGuide.activeBackground1': '#404855',
    'editor.findMatchBackground': '#5a4a00',
    'editor.findMatchHighlightBackground': '#4a3f00',
    'editorGutter.background': '#1e2127',
    'minimap.background': '#1b1e24',
    'editorOverviewRuler.border': '#00000000',
    'scrollbarSlider.background': '#ffffff14',
    'scrollbarSlider.hoverBackground': '#ffffff28',
    'scrollbarSlider.activeBackground': '#ffffff38',
    'editorWidget.background': '#23262d',
    'editorWidget.border': '#2e323b',
    'editorSuggestWidget.background': '#23262d',
    'editorSuggestWidget.selectedBackground': '#2d3540',
    'editorHoverWidget.background': '#23262d'
  }
})

/** 中文界面（Monaco 自带 nls 是英文，这里覆盖核心文案） */
export function applyChineseLocale() {
  // Monaco 在 bundle 里没有暴露 nls，这里通过重设全局的翻译映射实现常用项
  const anyMonaco = monaco as any
  if (anyMonaco.editor && anyMonaco.editor.setLocale) {
    try {
      anyMonaco.editor.setLocale('zh-cn')
    } catch {
      /* ignore */
    }
  }
}

/** 把 "SQL" 之外的自定义语言注册为 sql（Monaco 内置支持 sql） */
export function registerExtraLanguages() {
  const langs = monaco.languages.getLanguages().map((l) => l.id)
  const ensure = (id: string, exts: string[], aliases: string[]) => {
    if (langs.includes(id)) return
    monaco.languages.register({ id, extensions: exts, aliases })
  }
  ensure('log', ['.log', '.out'], ['Log', '日志'])
  ensure('properties', ['.properties'], ['Properties'])
  ensure('dockerfile', ['Dockerfile'], ['Dockerfile'])
}

export { monaco }
