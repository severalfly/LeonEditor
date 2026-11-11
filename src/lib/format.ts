/**
 * 格式化兜底。
 *
 * Monaco 独立版**没有**内置格式化器：`editor.action.formatDocument` /
 * `editor.action.formatSelection` 在没有注册 DocumentFormattingEditProvider 时
 * 会静默返回，什么都不做，用户按了以为没反应。
 * 所以格式化动作是「先试 Monaco，再比对文本有没有变化，没变就用这里的兜底」。
 *
 * 覆盖：JSON（解析后美化）、SQL（轻量排版）、其它语言给出明确提示。
 */

export interface FormatResult {
  /** 当前语言是否受支持 */
  supported: boolean
  /** 是否成功产出结果（false 时 text 为原文） */
  ok: boolean
  text: string
  /** 给用户看的提示 */
  message?: string
  /** 语言未知时，由内容嗅探推断出的类型（已知语言不走嗅探，不带此字段） */
  detected?: 'json' | 'sql'
}

/* ---------------- JSON ---------------- */

function formatJson(text: string): FormatResult {
  const trimmed = text.trim()
  if (!trimmed) return { supported: true, ok: false, text, message: '没有可格式化的内容' }
  try {
    const value = JSON.parse(trimmed)
    // 顶层是标量时 stringify 出来的东西没意义，保持原样
    if (value === null || typeof value !== 'object') {
      return { supported: true, ok: false, text, message: '不是 JSON 对象或数组，未做改动' }
    }
    return { supported: true, ok: true, text: JSON.stringify(value, null, 2) }
  } catch (e: any) {
    return {
      supported: true,
      ok: false,
      text,
      message: `JSON 解析失败：${String(e?.message ?? e).slice(0, 120)}`
    }
  }
}

/* ---------------- SQL ---------------- */

type TokType = 'word' | 'string' | 'comment' | 'symbol'

interface Tok {
  type: TokType
  value: string
}

/** SQL 关键字（统一大写）。只收影响可读性的常见词，避免误伤列名 */
const SQL_KEYWORDS = new Set(
  (
    'select from where group order by having limit offset join left right inner outer full cross on as and or not ' +
    'null is in like between exists union all distinct insert into values update set delete case when then else end ' +
    'asc desc count sum avg min max over partition using natural with recursive returning top char varchar int bigint ' +
    'decimal date datetime timestamp text boolean primary key foreign references default unique index table create drop ' +
    'alter add column if replace duplicate ignore row rows range unbounded preceding following current year month day ' +
    'hour minute second interval cast convert plus minus multiply divide'
  )
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toUpperCase())
)

/** 需要换行的子句（可以为多词）。按词数从多到少匹配 */
const CLAUSE_PHRASES: string[][] = [
  ['left', 'outer', 'join'],
  ['right', 'outer', 'join'],
  ['full', 'outer', 'join'],
  ['group', 'by'],
  ['order', 'by'],
  ['union', 'all'],
  ['left', 'join'],
  ['right', 'join'],
  ['inner', 'join'],
  ['outer', 'join'],
  ['full', 'join'],
  ['cross', 'join'],
  ['insert', 'into'],
  ['delete', 'from'],
  ['create', 'table'],
  ['alter', 'table'],
  ['select'],
  ['from'],
  ['where'],
  ['having'],
  ['limit'],
  ['offset'],
  ['join'],
  ['union'],
  ['update'],
  ['values'],
  ['set'],
  ['returning'],
  ['with']
]

const CLAUSE_FIRST_WORDS = new Set(CLAUSE_PHRASES.map((p) => p[0]))

/** 这些关键字后面的括号要留空格（IN (…)、VALUES (…)），函数名后面不留（COUNT(…)） */
const SPACE_BEFORE_PAREN = new Set([
  'IN',
  'VALUES',
  'EXISTS',
  'AND',
  'OR',
  'NOT',
  'ON',
  'USING',
  'BETWEEN',
  'LIKE',
  'AS',
  'THEN',
  'ELSE',
  'WHEN',
  'SELECT',
  'WHERE',
  'FROM',
  'BY',
  'SET',
  'RETURNING'
])

function tokenizeSql(src: string): Tok[] {
  const out: Tok[] = []
  const n = src.length
  let i = 0

  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]

    // 空白：换行当空格处理，最终排版由我们自己决定
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++
      continue
    }

    // 行注释 -- ... 或 # ...
    if ((c === '-' && c2 === '-') || (c === '#' && c2 !== undefined && c2 !== '>')) {
      let j = i
      while (j < n && src[j] !== '\n' && src[j] !== '\r') j++
      out.push({ type: 'comment', value: src.slice(i, j) })
      i = j
      continue
    }

    // 块注释 /* ... */
    if (c === '/' && c2 === '*') {
      const end = src.indexOf('*/', i + 2)
      const j = end < 0 ? n : end + 2
      out.push({ type: 'comment', value: src.slice(i, j) })
      i = j
      continue
    }

    // 字符串：'...' / "..." / `...`，内部同类引号以双写转义，反斜杠在 MySQL 里也转义
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\' && quote !== '`') {
          j += 2
          continue
        }
        if (src[j] === quote) {
          if (src[j + 1] === quote) {
            j += 2
            continue
          }
          j++
          break
        }
        j++
      }
      out.push({ type: 'string', value: src.slice(i, Math.min(j, n)) })
      i = j
      continue
    }

    // 数字：1 / 1.5 / 1e10（避免小数点被拆开导致 "1 . 5"）
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < n && /[0-9]/.test(src[j])) j++
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) {
        j++
        while (j < n && /[0-9]/.test(src[j])) j++
      }
      if ((src[j] === 'e' || src[j] === 'E') && /[0-9+-]/.test(src[j + 1] ?? '')) {
        j += 2
        while (j < n && /[0-9]/.test(src[j])) j++
      }
      out.push({ type: 'word', value: src.slice(i, j), numeric: true } as any)
      i = j
      continue
    }

    // 标识符 / 关键字
    if (/[A-Za-z_$@\u0080-\uffff]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$@\u0080-\uffff]/.test(src[j])) j++
      out.push({ type: 'word', value: src.slice(i, j) })
      i = j
      continue
    }

    // 双字符运算符
    if (['<=', '>=', '<>', '!=', '||', '&&', ':=', '::'].includes(c + (c2 ?? ''))) {
      out.push({ type: 'symbol', value: c + c2 })
      i += 2
      continue
    }

    out.push({ type: 'symbol', value: c })
    i++
  }
  return out
}

class SqlWriter {
  lines: string[] = []
  cur = ''
  indent = 0

  private pad(): string {
    return '  '.repeat(this.indent)
  }

  empty(): boolean {
    return this.cur.trim().length === 0
  }

  /** 确保一个空格分隔（行首不加） */
  space() {
    if (this.cur.length > 0 && !this.cur.endsWith(' ')) this.cur += ' '
  }

  write(text: string) {
    if (this.empty()) this.cur = this.pad()
    this.cur += text
  }

  newline(force = false) {
    const t = this.cur.replace(/\s+$/, '')
    if (t.length > 0) this.lines.push(t)
    this.cur = ''
    if (force && this.lines.length === 0) return
  }

  finish(): string {
    this.newline()
    return this.lines.join('\n')
  }
}

function formatSql(src: string): FormatResult {
  const toks = tokenizeSql(src)
  if (toks.length === 0) return { supported: true, ok: false, text: src, message: '没有可格式化的内容' }

  const w = new SqlWriter()
  let depth = 0 // 括号深度：括号里的子句不换行
  let prev: Tok | null = null
  let prevWasClause = false

  /** 尝试在这里匹配一个子句短语，返回匹配的 token 数与统一大写文本 */
  const matchClause = (i: number): { len: number; text: string } | null => {
    const first = toks[i]
    if (!first || first.type !== 'word') return null
    const head = first.value.toLowerCase()
    if (!CLAUSE_FIRST_WORDS.has(head)) return null
    for (const phrase of CLAUSE_PHRASES) {
      if (phrase[0] !== head) continue
      let k = 1
      let ok = true
      let cursor = i
      while (k < phrase.length) {
        // 跳过中间的括号等非词 token 不太可能，只接受连续 word
        let j = cursor + 1
        if (j >= toks.length) {
          ok = false
          break
        }
        const nx = toks[j]
        if (nx.type !== 'word' || nx.value.toLowerCase() !== phrase[k]) {
          ok = false
          break
        }
        cursor = j
        k++
      }
      if (ok) return { len: phrase.length, text: phrase.join(' ').toUpperCase() }
    }
    return null
  }

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    const clause = t.type === 'word' && depth === 0 ? matchClause(i) : null

    if (clause) {
      // 子句前换行
      w.newline()
      // 顶层子句不缩进，保持整齐（缩进逻辑留给使用者自己的审美）
      w.indent = 0
      w.write(clause.text)
      i += clause.len - 1
      prev = { type: 'word', value: clause.text }
      prevWasClause = true
      continue
    }

    if (t.type === 'comment') {
      const lineComment = t.value.startsWith('--') || t.value.startsWith('#')
      if (!w.empty()) w.space()
      w.write(t.value.trimEnd())
      if (lineComment) w.newline()
      prev = t
      prevWasClause = false
      continue
    }

    if (t.type === 'string') {
      if (!w.empty() && !w.cur.endsWith('(') && !w.cur.endsWith('.')) w.space()
      w.write(t.value)
      prev = t
      prevWasClause = false
      continue
    }

    if (t.type === 'word') {
      const isNum = (t as any).numeric === true
      let text = t.value
      if (!isNum) {
        const up = text.toUpperCase()
        // 关键字统一大写；限定名（a.select）和跟在 . 后面的不动
        const afterDot = prev?.type === 'symbol' && prev.value === '.'
        const beforeDot = toks[i + 1]?.type === 'symbol' && toks[i + 1].value === '.'
        if (SQL_KEYWORDS.has(up) && !afterDot && !beforeDot) text = up
      }
      if (!w.empty() && !w.cur.endsWith('(') && !w.cur.endsWith('.') && !w.cur.endsWith('@')) w.space()
      w.write(text)
      prev = t
      prevWasClause = false
      continue
    }

    // ---- 符号 ----
    const s = t.value

    if (s === '(') {
      // IN ( / VALUES ( 要空格；函数名 COUNT( 不要
      const needSpace =
        prevWasClause ||
        (prev?.type === 'word' && SPACE_BEFORE_PAREN.has(prev.value.toUpperCase())) ||
        (prev?.type === 'symbol' && (prev.value === ',' || prev.value === ')'))
      if (needSpace && !w.empty() && !w.cur.endsWith(' ')) w.space()
      w.write('(')
      depth++
      prev = t
      prevWasClause = false
      continue
    }

    if (s === ')') {
      w.cur = w.cur.replace(/\s+$/, '')
      w.write(')')
      depth = Math.max(0, depth - 1)
      prev = t
      prevWasClause = false
      continue
    }

    if (s === ',') {
      w.cur = w.cur.replace(/\s+$/, '')
      w.write(',')
      w.space()
      prev = t
      prevWasClause = false
      continue
    }

    if (s === '.') {
      w.cur = w.cur.replace(/\s+$/, '')
      w.write('.')
      prev = t
      prevWasClause = false
      continue
    }

    if (s === ';') {
      w.cur = w.cur.replace(/\s+$/, '')
      w.write(';')
      w.newline()
      prev = t
      prevWasClause = false
      continue
    }

    // 其它运算符：两侧留一个空格（紧跟 ( 或 . 时不加，避免 count( * 这种）
    if (!w.empty() && !w.cur.endsWith(' ') && !w.cur.endsWith('(') && !w.cur.endsWith('.')) w.space()
    w.write(s)
    w.space()
    prev = t
    prevWasClause = false
  }

  const out = w.finish()

  // 安全检查：去掉所有空白后必须与原文一致，否则说明分词器吃掉了内容，宁可不改
  const sig = (x: string) => x.replace(/\s+/g, '').toLowerCase()
  if (sig(out) !== sig(src)) {
    return { supported: true, ok: false, text: src, message: 'SQL 格式化结果校验未通过，已保持原样' }
  }
  if (out === src) {
    return { supported: true, ok: false, text: src, message: '内容已经是格式化后的样子' }
  }
  return { supported: true, ok: true, text: out }
}

/* ---------------- 内容嗅探 ---------------- */

/** 以这些关键字开头的脚本按 SQL 处理（词边界、忽略大小写） */
const SQL_START_KEYWORDS = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'WITH',
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'SHOW',
  'DESC',
  'DESCRIBE',
  'EXPLAIN',
  'MERGE'
])

/** 跳过前导空白与 `--` / `/* *\/` 注释 */
function stripLeadingComments(src: string): string {
  let s = src
  // 注释可能连续出现多层，循环剥到不能再剥为止
  for (let guard = 0; guard < 500; guard++) {
    const before = s
    s = s.replace(/^\s+/, '')
    if (s.startsWith('--')) {
      const nl = s.search(/[\r\n]/)
      s = nl < 0 ? '' : s.slice(nl)
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/')
      s = end < 0 ? '' : s.slice(end + 2)
    }
    if (s === before) break
  }
  return s
}

/**
 * 按内容猜语言，只认得出 JSON / SQL，其余返回 null。
 *
 * 未命名文件的 model 语言恒为 plaintext，`.txt` 之类也没有格式化器，
 * 所以「按了快捷键没反应」实际上是「语言不认识」。这里用内容兜一层。
 * 注意：**不修改** model 的语言，高亮保持不变。
 */
export function detectLanguageByContent(text: string): 'json' | 'sql' | null {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      /* 不是合法 JSON，继续看看是不是 SQL */
    }
  }

  const head = stripLeadingComments(trimmed)
  const m = head.match(/^([A-Za-z]+)/)
  if (!m) return null
  return SQL_START_KEYWORDS.has(m[1].toUpperCase()) ? 'sql' : null
}

/* ---------------- 入口 ---------------- */

export function formatText(text: string, languageId: string): FormatResult {
  const lang = (languageId || '').toLowerCase()
  if (lang === 'json' || lang === 'jsonc') return formatJson(text)
  if (lang === 'sql') return formatSql(text)

  // 未知语言（未命名文件的 plaintext、.txt、日志等）：先嗅探内容
  const detected = detectLanguageByContent(text)
  if (detected === 'json') return { ...formatJson(text), detected: 'json' }
  if (detected === 'sql') return { ...formatSql(text), detected: 'sql' }
  return {
    supported: false,
    ok: false,
    text,
    message: '无法识别内容类型（支持 SQL / JSON），未做修改'
  }
}

export function isFormatSupported(languageId: string): boolean {
  const lang = (languageId || '').toLowerCase()
  return lang === 'json' || lang === 'jsonc' || lang === 'sql'
}
