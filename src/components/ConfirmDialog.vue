<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { confirmState, resolveConfirm, type ConfirmButton } from '../lib/confirm'

const btnEls = ref<HTMLButtonElement[]>([])

const buttons = computed<ConfirmButton[]>(() => confirmState.value?.buttons ?? [])

const primaryIndex = computed(() => {
  const i = buttons.value.findIndex((b) => b.kind === 'primary')
  return i >= 0 ? i : buttons.value.length - 1
})

function pick(value: string) {
  resolveConfirm(value)
}

function onBackdrop() {
  resolveConfirm(null)
}

/** 对话框打开期间全局监听键盘，避免焦点跑到别处时 Esc/Enter 失效 */
function onKeydown(e: KeyboardEvent) {
  if (!confirmState.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    resolveConfirm(null)
    return
  }
  if (e.key === 'Enter') {
    const b = buttons.value[primaryIndex.value]
    if (b) {
      e.preventDefault()
      e.stopPropagation()
      resolveConfirm(b.value)
    }
  }
}

watch(
  () => confirmState.value,
  async (v) => {
    if (!v) return
    await nextTick()
    btnEls.value = []
    await nextTick()
    // 默认聚焦主按钮，回车即可确认
    const el = document.querySelector<HTMLButtonElement>('.confirm-actions .cf-btn.primary')
    el?.focus()
  },
  { flush: 'post' }
)

window.addEventListener('keydown', onKeydown, true)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div v-if="confirmState" class="confirm-backdrop" @mousedown.self="onBackdrop">
    <div class="confirm-card" role="dialog" aria-modal="true">
      <div class="confirm-title">{{ confirmState.title }}</div>
      <div v-if="confirmState.message" class="confirm-message">{{ confirmState.message }}</div>
      <div v-if="confirmState.detail" class="confirm-detail">{{ confirmState.detail }}</div>

      <div class="confirm-actions">
        <button
          v-for="(b, i) in buttons"
          :key="b.value"
          :ref="(el) => { if (el) btnEls[i] = el as HTMLButtonElement }"
          class="cf-btn"
          :class="{ primary: b.kind === 'primary', danger: b.kind === 'danger' }"
          @click="pick(b.value)"
        >
          {{ b.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9800;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.32);
}

.confirm-card {
  min-width: 340px;
  max-width: 460px;
  padding: 18px 20px 14px;
  background: var(--bg-overlay);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
  animation: cf-in 110ms ease-out;
}

@keyframes cf-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.confirm-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.5;
  word-break: break-word;
}

.confirm-message {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.confirm-detail {
  margin-top: 8px;
  padding: 7px 9px;
  background: var(--bg-app);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.5;
  word-break: break-all;
  max-height: 88px;
  overflow: auto;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.cf-btn {
  height: 28px;
  min-width: 70px;
  padding: 0 14px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12.5px;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition);
}

.cf-btn:hover {
  background: var(--bg-hover);
}

.cf-btn.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.cf-btn.primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.cf-btn.danger {
  border-color: var(--border-strong);
  color: var(--danger);
}

.cf-btn.danger:hover {
  background: rgba(207, 34, 46, 0.08);
  border-color: var(--danger);
}
</style>
