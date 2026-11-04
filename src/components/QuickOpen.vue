<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import Icon from './Icon.vue'
import { state } from '../lib/store'
import type { TreeNode } from '../lib/api'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pick', path: string): void
}>()

const input = ref<HTMLInputElement | null>(null)
const query = ref('')
const cursor = ref(0)
const listEl = ref<HTMLElement | null>(null)

/** 拍平成扁平文件列表，只取一次 */
const allFiles = computed<TreeNode[]>(() => {
  const out: TreeNode[] = []
  function walk(n: TreeNode) {
    if (!n.isDir) {
      out.push(n)
      return
    }
    n.children?.forEach(walk)
  }
  if (state.tree) walk(state.tree)
  return out
})

/** 模糊匹配：子序列匹配 + 打分 */
const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) {
    // 无输入时展示最近打开的文件（按标签顺序）
    return state.tabs
      .filter((t) => t.path)
      .map((t) => ({ path: t.path!, name: t.name, rel: t.name, score: 100 }))
  }

  const out: { path: string; name: string; rel: string; score: number }[] = []
  for (const f of allFiles.value) {
    const rel = f.path
    const nameLower = f.name.toLowerCase()
    const pathLower = rel.toLowerCase()

    // 优先文件名前缀 / 包含
    let score = 0
    if (nameLower === q) score = 1000
    else if (nameLower.startsWith(q)) score = 900 - nameLower.length
    else if (nameLower.includes(q)) score = 700 - nameLower.length
    else if (pathLower.includes(q)) score = 400
    else {
      // 子序列匹配
      let i = 0
      let gaps = 0
      let lastIdx = -1
      for (const ch of pathLower) {
        if (ch === q[i]) {
          if (lastIdx >= 0) gaps += 1
          lastIdx = 0
          i++
          if (i === q.length) break
        } else {
          lastIdx = 0
        }
      }
      if (i === q.length) score = 200
    }
    if (score > 0) out.push({ path: rel, name: f.name, rel, score })
  }
  out.sort((a, b) => b.score - a.score || a.rel.length - b.rel.length)
  return out.slice(0, 200)
})

watch(
  () => props.show,
  async (v) => {
    if (v) {
      query.value = ''
      cursor.value = 0
      await nextTick()
      input.value?.focus()
    }
  }
)

watch(query, () => {
  cursor.value = 0
})

watch(cursor, async () => {
  await nextTick()
  const el = listEl.value?.children[cursor.value] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest' })
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    cursor.value = Math.min(cursor.value + 1, results.value.length - 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    cursor.value = Math.max(cursor.value - 1, 0)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const r = results.value[cursor.value]
    if (r) emit('pick', r.path)
    return
  }
}

/** 高亮匹配片段 */
function parts(text: string) {
  const q = query.value.trim().toLowerCase()
  if (!q) return [{ t: text, hl: false }]
  const lower = text.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx < 0) return [{ t: text, hl: false }]
  const out: { t: string; hl: boolean }[] = []
  if (idx > 0) out.push({ t: text.slice(0, idx), hl: false })
  out.push({ t: text.slice(idx, idx + q.length), hl: true })
  if (idx + q.length < text.length) out.push({ t: text.slice(idx + q.length), hl: false })
  return out
}

function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p
}

function dirOf(p: string) {
  const parts = p.split(/[\\/]/)
  parts.pop()
  return parts.slice(-2).join('/')
}

onMounted(() => {
  if (props.show) input.value?.focus()
})
</script>

<template>
  <div v-if="show" class="quick-open-mask" @click.self="emit('close')">
    <div class="quick-open" @keydown="onKey">
      <div class="qo-input-row">
        <Icon name="search" :size="14" class="qo-icon" />
        <input
          ref="input"
          v-model="query"
          class="qo-input"
          placeholder="输入文件名搜索…（↑↓ 选择，Enter 打开，Esc 关闭）"
          spellcheck="false"
        />
        <span class="qo-count">{{ results.length }}</span>
      </div>

      <div ref="listEl" class="qo-list">
        <div
          v-for="(r, i) in results"
          :key="r.path"
          class="qo-item"
          :class="{ active: i === cursor }"
          :title="r.path"
          @click="emit('pick', r.path)"
          @mouseenter="cursor = i"
        >
          <Icon name="file" :size="13" class="qo-file-icon" />
          <span class="qo-name">
            <span v-for="(p, j) in parts(baseName(r.rel))" :key="j" :class="{ hl: p.hl }">{{ p.t }}</span>
          </span>
          <span class="qo-dir">{{ dirOf(r.rel) }}</span>
        </div>

        <div v-if="results.length === 0" class="qo-empty">
          <template v-if="!state.rootFolder">未打开文件夹，只显示已打开的文件</template>
          <template v-else>没有匹配的文件</template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quick-open-mask {
  position: fixed;
  inset: 0;
  z-index: 9600;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  justify-content: center;
  padding-top: 10vh;
}

.quick-open {
  width: 620px;
  max-width: 92vw;
  max-height: 62vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-overlay);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.qo-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.qo-icon {
  color: var(--text-faint);
  flex-shrink: 0;
}

.qo-input {
  flex: 1;
  border: none;
  background: none;
  font-size: 14px;
  color: var(--text);
  user-select: text;
}

.qo-input::placeholder {
  color: var(--text-faint);
  font-size: 13px;
}

.qo-count {
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.qo-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.qo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12.5px;
}

.qo-item.active {
  background: var(--accent-soft);
}

.qo-file-icon {
  color: var(--text-faint);
  flex-shrink: 0;
}

.qo-name {
  white-space: nowrap;
  color: var(--text);
}

.qo-name .hl {
  color: var(--accent);
  font-weight: 600;
}

.qo-dir {
  font-size: 10.5px;
  color: var(--text-faint);
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 45%;
  direction: rtl;
  text-align: left;
}

.qo-empty {
  padding: 26px;
  text-align: center;
  color: var(--text-faint);
  font-size: 12px;
}
</style>
