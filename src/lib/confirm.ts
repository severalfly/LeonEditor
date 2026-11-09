/**
 * 应用内确认对话框。
 *
 * 为什么不用 window.confirm：
 * 在 WebView2 里，confirm() 会立即返回，而原生对话框是宿主**稍后**才画出来的。
 * 结果就是「先执行了关闭/删除，再弹出提示」这种倒序，用户看到标签已经没了
 * 才被问要不要保留修改。
 *
 * 这里改成自绘对话框，await 到用户真正做出选择之后才继续，
 * 顺序完全由我们控制，也能给出「保存 / 不保存 / 取消」三个选项。
 */
import { ref } from 'vue'

export type ConfirmKind = 'primary' | 'danger' | 'default'

export interface ConfirmButton {
  label: string
  /** 返回给调用方的值 */
  value: string
  kind?: ConfirmKind
}

export interface ConfirmOptions {
  title: string
  /** 主要说明文字 */
  message?: string
  /** 次要说明（灰色小字），比如文件名、影响范围 */
  detail?: string
  buttons?: ConfirmButton[]
}

/** 当前要显示的对话框；null 表示不显示 */
export const confirmState = ref<ConfirmOptions | null>(null)

let resolver: ((value: string | null) => void) | null = null

/**
 * 弹出确认框，等用户选择。
 * 用户按 Esc / 点遮罩 / 未选择就关闭时返回 null。
 */
export function askConfirm(opts: ConfirmOptions): Promise<string | null> {
  // 若上一次还挂着，先以「取消」结束它，避免 resolver 泄漏
  if (resolver) {
    const prev = resolver
    resolver = null
    prev(null)
  }

  return new Promise<string | null>((resolve) => {
    resolver = resolve
    confirmState.value = {
      buttons: opts.buttons ?? [
        { label: '确定', value: 'ok', kind: 'primary' },
        { label: '取消', value: 'cancel', kind: 'default' }
      ],
      ...opts
    }
  })
}

/** 由对话框组件回调，结束当前询问 */
export function resolveConfirm(value: string | null) {
  const r = resolver
  resolver = null
  confirmState.value = null
  if (r) r(value)
}
