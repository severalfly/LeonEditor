/**
 * 文本转换工具：绑定到三个快捷键。
 * 都作用在「选区」上，没有选区时作用于「整个文档」。
 */

export type TransformKind = 'remove-newlines' | 'remove-ampersand' | 'to-sql-in'

/** 1. 自动删除换行：把多行合并成一行 */
export function removeNewlines(text: string, joinWith = ' '): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(joinWith)
}

/** 2. 自动删除 & 符号（连同紧邻的空格一起清理） */
export function removeAmpersands(text: string): string {
  return text
    .split('&')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
}

export interface SqlInOptions {
  /** 是否给值加引号（数字列可以关掉） */
  quote?: boolean
  /** 每行一个值还是全部塞一行 */
  onePerLine?: boolean
  /** 单个 IN 子句最多放多少个值（超了拆成多个 OR ... IN (...)） */
  chunkSize?: number
}

/**
 * 3. 转成数据库 IN 格式字符串
 *
 * 输入（每行一个值）：
 *   123
 *   456
 *   789
 *
 * 输出：
 *   IN (
 *     123,
 *     456,
 *     789
 *   )
 *
 * 若输入本身带引号或需要引号，用 quote=true 包成 'xxx'。
 * 已存在的引号会被剥掉再加，避免出现 ''123''。
 */
export function toSqlIn(text: string, opts: SqlInOptions = {}): string {
  const { quote = true, onePerLine = true, chunkSize = 0 } = opts

  // 按逗号 / 换行拆分，同时剥掉原有引号和多余空白
  const values = text
    .split(/[\r\n,]+/)
    .map((v) => v.trim())
    .map((v) => {
      let s = v
      // 去掉成对的单引号 / 双引号
      if (
        (s.startsWith("'") && s.endsWith("'") && s.length >= 2) ||
        (s.startsWith('"') && s.endsWith('"') && s.length >= 2)
      ) {
        s = s.slice(1, -1)
      }
      return s
    })
    .filter((v) => v.length > 0)

  if (values.length === 0) return ''

  const render = (v: string) => {
    if (!quote) return v
    // 转义内部单引号
    return `'${v.replace(/'/g, "''")}'`
  }

  const buildIn = (vals: string[]) => {
    if (onePerLine) {
      const body = vals.map((v) => `  ${render(v)}`).join(',\n')
      return `IN (\n${body}\n)`
    }
    return `IN (${vals.map(render).join(', ')})`
  }

  if (chunkSize && chunkSize > 0 && values.length > chunkSize) {
    const chunks: string[][] = []
    for (let i = 0; i < values.length; i += chunkSize) {
      chunks.push(values.slice(i, i + chunkSize))
    }
    const multiLine = chunks.length > 1
    return chunks
      .map((c) => {
        const s = buildIn(c)
        return multiLine ? s : s
      })
      .join('\nOR ')
  }

  return buildIn(values)
}

/** 统计会被处理成多少个值，用于提示 */
export function countSqlInValues(text: string): number {
  return text
    .split(/[\r\n,]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0).length
}
