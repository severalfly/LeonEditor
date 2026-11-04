<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { state, activeTab } from '../lib/store'

const props = defineProps<{
  line: number
  col: number
  selected: number
}>()

const emit = defineEmits<{
  (e: 'set-encoding', enc: string): void
  (e: 'set-eol', eol: string): void
  (e: 'goto-line'): void
  (e: 'toggle-wordwrap'): void
}>()

const showEncodingMenu = defineModel<boolean>('showEncodingMenu', { default: false })

const tab = computed(() => activeTab())

const encodingLabel = computed(() => {
  const e = tab.value?.encoding ?? 'utf-8'
  const map: Record<string, string> = {
    'utf-8': 'UTF-8',
    'utf-8-bom': 'UTF-8 BOM',
    gbk: 'GBK',
    big5: 'Big5',
    'utf-16le': 'UTF-16 LE',
    'utf-16be': 'UTF-16 BE',
    latin1: 'Latin1'
  }
  return map[e] ?? e.toUpperCase()
})

const eolLabel = computed(() => {
  const e = tab.value?.eol ?? 'lf'
  return e === 'crlf' ? 'CRLF' : e === 'cr' ? 'CR' : 'LF'
})

const langLabel = computed(() => {
  const t = tab.value
  if (!t) return ''
  if (t.binary) return '二进制'
  return ''
})

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const INDENT = '    '
</script>

<template>
  <div class="statusbar">
    <div class="left">
      <span v-if="state.rootFolder" class="chip" :title="state.rootFolder">
        <Icon name="folder" :size="12" />
        {{ state.rootFolder.split(/[\\/]/).filter(Boolean).pop() }}
      </span>
      <span v-if="tab" class="chip" :title="tab.path ?? '未保存'">
        <Icon name="file" :size="12" />
        <span class="truncate">{{ tab.name }}</span>
        <span v-if="tab.dirty" class="dot" />
      </span>
      <span v-if="tab && tab.readOnly" class="chip warn">只读</span>
      <span v-else-if="tab && tab.binary" class="chip warn">{{ langLabel }}</span>
    </div>

    <div class="right">
      <button v-if="tab" class="chip btn-chip" @click="emit('goto-line')" title="跳转到行 (Ctrl+G)">
        <Icon name="go-to" :size="12" />
        行 {{ line }}，列 {{ col }}
      </button>
      <span v-if="props.selected > 0" class="chip">
        选中 {{ props.selected }} 字符
      </span>

      <button v-if="tab" class="chip btn-chip" @click="emit('toggle-wordwrap')" :title="'自动换行'">
        <Icon name="wrap-text" :size="12" />
        {{ state.settings?.word_wrap ? '换行开' : '换行关' }}
      </button>

      <button v-if="tab" class="chip btn-chip" :title="'文件编码'" @click="showEncodingMenu = !showEncodingMenu">
        <Icon name="encoding" :size="12" />
        {{ encodingLabel }}
        <span class="sub">{{ eolLabel }}</span>
      </button>

      <span v-if="tab" class="chip">{{ formatBytes(tab.size) }}</span>
      <span class="chip muted">{{ state.settings?.tab_size ?? 4 }} 空格</span>
      <span class="chip muted">UTF-8</span>
    </div>
  </div>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--statusbar-h);
  padding: 0 6px;
  background: var(--bg-status);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-dim);
  flex-shrink: 0;
  gap: 8px;
  overflow: hidden;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow: hidden;
}

.left {
  flex: 1;
  min-width: 0;
}

.right {
  flex-shrink: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: 3px;
  white-space: nowrap;
  max-width: 280px;
}

.chip.muted {
  color: var(--text-faint);
}

.chip.warn {
  color: var(--warn);
}

.chip .truncate {
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip .sub {
  color: var(--text-faint);
  margin-left: 1px;
}

.btn-chip:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--warn);
  flex-shrink: 0;
}
</style>
