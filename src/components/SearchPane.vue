<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { state } from '../lib/store'
import type { SearchResult, FileHits, SearchHit } from '../lib/api'

const emit = defineEmits<{
  (e: 'open-hit', hit: SearchHit): void
  (e: 'research'): void
}>()

const collapsed = ref<Set<string>>(new Set())

const result = computed<SearchResult | null>(() => state.searchResult)

function toggleFile(path: string) {
  const s = new Set(collapsed.value)
  if (s.has(path)) s.delete(path)
  else s.add(path)
  collapsed.value = s
}

function isCollapsed(path: string) {
  return collapsed.value.has(path)
}

function onHit(hit: SearchHit) {
  emit('open-hit', hit)
}

function fileName(rel: string) {
  return rel.split(/[\\/]/).pop() ?? rel
}

function dirName(rel: string) {
  const parts = rel.split(/[\\/]/)
  parts.pop()
  return parts.join('/')
}

const statsText = computed(() => {
  const r = result.value
  if (!r) return ''
  if (r.truncated) return `${r.total_hits}+ 条（已达上限）· ${r.elapsed_ms}ms`
  return `${r.total_hits} 条 · ${r.files.length} 个文件 · ${r.elapsed_ms}ms`
})

function highlightParts(hit: SearchHit) {
  const t = hit.line_text
  const s = hit.match_start
  const e = hit.match_end
  if (s >= e || s > t.length) return [{ text: t, hl: false }]
  const parts: { text: string; hl: boolean }[] = []
  if (s > 0) parts.push({ text: t.slice(0, s), hl: false })
  parts.push({ text: t.slice(s, Math.min(e, t.length)), hl: true })
  if (e < t.length) parts.push({ text: t.slice(e), hl: false })
  return parts
}
</script>

<template>
  <div class="search-pane">
    <div class="head">
      <span class="title">搜索结果</span>
      <span v-if="result" class="stats">{{ statsText }}</span>
      <div class="flex1" />
      <button
        v-if="result"
        class="icon-btn"
        title="重新搜索"
        @click="$emit('research')"
      >
        <Icon name="refresh" :size="13" />
      </button>
    </div>

    <div v-if="!result" class="empty">
      <Icon name="search" :size="26" style="opacity: 0.3" />
      <div>按 Ctrl+Shift+F 搜索整个文件夹</div>
    </div>

    <div v-else-if="result.total_hits === 0" class="empty">
      <Icon name="search" :size="26" style="opacity: 0.3" />
      <div>没有找到匹配项</div>
      <div class="tiny">已搜索 {{ result.searched_files }} 个文件</div>
    </div>

    <div v-else class="body">
      <div v-for="f in result.files" :key="f.path" class="file-group">
        <div class="file-head" :title="f.path" @click="toggleFile(f.path)">
          <Icon :name="isCollapsed(f.path) ? 'chevron-right' : 'chevron-down'" :size="12" />
          <span class="fname">{{ fileName(f.rel) }}</span>
          <span class="fdir">{{ dirName(f.rel) }}</span>
          <span class="fcount">{{ f.hits.length }}</span>
        </div>

        <template v-if="!isCollapsed(f.path)">
          <div
            v-for="(hit, i) in f.hits"
            :key="f.path + i"
            class="hit"
            :title="`${f.rel}:${hit.line}:${hit.col}`"
            @click="onHit(hit)"
          >
            <span class="ln">{{ hit.line }}</span>
            <span class="code">
              <span
                v-for="(p, j) in highlightParts(hit)"
                :key="j"
                :class="{ hl: p.hl }"
              >{{ p.text }}</span>
            </span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: var(--text-dim);
}

.stats {
  font-size: 10.5px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.flex1 {
  flex: 1;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--text-faint);
  font-size: 12px;
  text-align: center;
  padding: 20px;
}

.empty .tiny {
  font-size: 10.5px;
  opacity: 0.7;
}

.body {
  flex: 1;
  overflow: auto;
  padding-bottom: 10px;
  user-select: text;
}

.file-group {
  margin-bottom: 1px;
}

.file-head {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px 0 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text);
  position: sticky;
  top: 0;
  background: var(--bg-sidebar);
  z-index: 1;
}

.file-head:hover {
  background: var(--bg-hover);
}

.fname {
  font-weight: 600;
  white-space: nowrap;
}

.fdir {
  font-size: 10.5px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  direction: rtl;
  text-align: left;
}

.fcount {
  font-size: 10px;
  color: var(--text-faint);
  background: var(--bg-active);
  border-radius: 8px;
  padding: 0 5px;
  min-width: 17px;
  text-align: center;
  flex-shrink: 0;
}

.hit {
  display: flex;
  gap: 7px;
  padding: 2px 8px 2px 22px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 17px;
  white-space: pre;
  overflow: hidden;
}

.hit:hover {
  background: var(--accent-soft);
}

.ln {
  color: var(--text-faint);
  min-width: 34px;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.code {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-dim);
  flex: 1;
}

.code .hl {
  background: var(--match-bg);
  color: var(--match-text);
  border-radius: 2px;
  font-weight: 600;
}
</style>
