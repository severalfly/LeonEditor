<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import Icon from './Icon.vue'
import { state, showToast, activeTab } from '../lib/store'
import { api } from '../lib/api'
import type { SearchResult } from '../lib/api'

const emit = defineEmits<{
  (e: 'find-local', opts: { query: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean }): number
  (e: 'goto-match', index: number): void
  (e: 'clear-local'): void
  (e: 'folder-result', result: SearchResult): void
}>()

const queryInput = ref<HTMLInputElement | null>(null)
const replaceInput = ref<HTMLInputElement | null>(null)

const localCount = ref(0)
const localIndex = ref(-1)
const statusText = ref('')
const busy = ref(false)

const isFolderMode = computed(() => state.findMode === 'folder')

function focusQuery() {
  nextTick(() => {
    queryInput.value?.focus()
    queryInput.value?.select()
  })
}

onMounted(() => {
  focusQuery()
})

watch(
  () => state.findVisible,
  (v) => {
    if (v) focusQuery()
  }
)

function runLocal(step = 0) {
  if (!state.findQuery) {
    localCount.value = 0
    localIndex.value = -1
    statusText.value = ''
    emit('clear-local')
    return
  }
  const n = emit('find-local', {
    query: state.findQuery,
    regex: state.findRegex,
    caseSensitive: state.findCaseSensitive,
    wholeWord: state.findWholeWord
  })
  if (typeof n === 'number') localCount.value = n
  if (localCount.value === 0) {
    statusText.value = '无匹配'
    localIndex.value = -1
    return
  }
  localIndex.value = step === 0 ? 0 : (localIndex.value + step + localCount.value) % localCount.value
  emit('goto-match', localIndex.value)
  statusText.value = `${localIndex.value + 1} / ${localCount.value}`
}

let localTimer: number | undefined
function onQueryInput() {
  window.clearTimeout(localTimer)
  localTimer = window.setTimeout(() => {
    if (!isFolderMode.value) runLocal(0)
  }, 160)
}

function next() {
  if (localCount.value === 0) return runLocal(0)
  localIndex.value = (localIndex.value + 1) % localCount.value
  emit('goto-match', localIndex.value)
  statusText.value = `${localIndex.value + 1} / ${localCount.value}`
}

function prev() {
  if (localCount.value === 0) return runLocal(0)
  localIndex.value = (localIndex.value - 1 + localCount.value) % localCount.value
  emit('goto-match', localIndex.value)
  statusText.value = `${localIndex.value + 1} / ${localCount.value}`
}

/** 当前文件内替换 */
async function replaceOne() {
  const tab = activeTab()
  if (!tab?.path) {
    showToast('请先保存文件再替换', 'error')
    return
  }
  if (!state.findQuery) return
  // 借助 folder 搜索的单文件模式做替换更可靠（会保留编码）
  try {
    const report = await api.replaceInFiles({
      root: tab.path,
      query: state.findQuery,
      replacement: state.findReplace,
      is_regex: state.findRegex,
      case_sensitive: state.findCaseSensitive,
      whole_word: state.findWholeWord,
      include: null,
      exclude: null,
      max_file_size: null,
      files: [tab.path]
    })
    if (report.replacements > 0) {
      showToast(`已替换 ${report.replacements} 处，需要重新加载文件`, 'success')
      await reloadTab()
    } else {
      showToast('没有可替换的匹配', 'info')
    }
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
  }
}

async function replaceAllLocal() {
  const tab = activeTab()
  if (!tab?.path) {
    showToast('请先保存文件再替换', 'error')
    return
  }
  if (!state.findQuery) return
  if (!window.confirm(`将在当前文件替换所有匹配，确定继续？`)) return
  try {
    const report = await api.replaceInFiles({
      root: tab.path,
      query: state.findQuery,
      replacement: state.findReplace,
      is_regex: state.findRegex,
      case_sensitive: state.findCaseSensitive,
      whole_word: state.findWholeWord,
      files: [tab.path]
    })
    if (report.replacements > 0) {
      showToast(`已替换 ${report.replacements} 处`, 'success')
      await reloadTab()
    } else {
      showToast('没有可替换的匹配', 'info')
    }
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
  }
}

async function reloadTab() {
  const tab = activeTab()
  if (!tab?.path) return
  window.dispatchEvent(new CustomEvent('leon:reload-tab', { detail: { id: tab.id } }))
}

/** 全文件夹搜索 */
async function runFolderSearch() {
  if (!state.findQuery) {
    showToast('请输入搜索内容', 'error')
    return
  }
  if (!state.rootFolder) {
    showToast('请先打开文件夹', 'error')
    return
  }
  busy.value = true
  try {
    const res = await api.searchInFolder({
      root: state.rootFolder,
      query: state.findQuery,
      is_regex: state.findRegex,
      case_sensitive: state.findCaseSensitive,
      whole_word: state.findWholeWord,
      include: state.settings?.search_include || null,
      exclude: state.settings?.search_exclude || null,
      max_results: 8000,
      max_file_size: null
    })
    state.searchResult = res
    emit('folder-result', res)
    state.sidebarView = 'search'
    statusText.value = res.truncated
      ? `${res.total_hits}+ 条（已截断）· ${res.elapsed_ms}ms`
      : `${res.total_hits} 条 / ${res.files.length} 文件 · ${res.elapsed_ms}ms`
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
  } finally {
    busy.value = false
  }
}

async function runFolderReplace() {
  if (!state.rootFolder) {
    showToast('请先打开文件夹', 'error')
    return
  }
  if (!state.findQuery) return

  const files: string[] | null = state.searchResult?.files?.length
    ? state.searchResult.files.map((f: any) => f.path)
    : null
  const scope = files ? `${files.length} 个文件` : '整个文件夹'
  if (!window.confirm(`将在 ${scope} 中替换「${state.findQuery}」→「${state.findReplace}」\n\n此操作直接写盘，不可撤销。确定继续？`)) {
    return
  }
  busy.value = true
  try {
    const report = await api.replaceInFiles({
      root: state.rootFolder,
      query: state.findQuery,
      replacement: state.findReplace,
      is_regex: state.findRegex,
      case_sensitive: state.findCaseSensitive,
      whole_word: state.findWholeWord,
      include: state.settings?.search_include || null,
      exclude: state.settings?.search_exclude || null,
      max_file_size: null,
      files
    })
    if (report.failed.length) {
      showToast(
        `改动 ${report.files_changed} 个文件，替换 ${report.replacements} 处，失败 ${report.failed.length} 个`,
        'error'
      )
    } else {
      showToast(`改动 ${report.files_changed} 个文件，替换 ${report.replacements} 处`, 'success')
    }
    await runFolderSearch()
    window.dispatchEvent(new CustomEvent('leon:reload-dirty-tabs'))
  } catch (e: any) {
    showToast(String(e?.message ?? e), 'error')
  } finally {
    busy.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    state.findVisible = false
    emit('clear-local')
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    if (isFolderMode.value) {
      runFolderSearch()
    } else if (e.shiftKey) {
      prev()
    } else {
      next()
    }
  }
}

function setMode(m: 'current' | 'folder') {
  state.findMode = m
  if (m === 'folder') {
    emit('clear-local')
    statusText.value = ''
  } else {
    window.setTimeout(() => runLocal(0), 30)
  }
}

function toggleReplace() {
  state.replaceVisible = !state.replaceVisible
  if (state.replaceVisible) {
    nextTick(() => replaceInput.value?.focus())
  }
}
</script>

<template>
  <div v-if="state.findVisible" class="find-panel" @keydown="onKeydown">
    <!-- 模式切换 -->
    <div class="mode-row">
      <button
        class="mode-btn"
        :class="{ active: !isFolderMode }"
        @click="setMode('current')"
      >
        当前文件
      </button>
      <button
        class="mode-btn"
        :class="{ active: isFolderMode }"
        @click="setMode('folder')"
      >
        整个文件夹
      </button>
      <div class="spacer" />
      <button class="icon-btn" title="关闭 (Esc)" @click="state.findVisible = false; emit('clear-local')">
        <Icon name="close" :size="13" />
      </button>
    </div>

    <!-- 查找行 -->
    <div class="input-row">
      <button
        class="icon-btn toggle-replace"
        :class="{ active: state.replaceVisible }"
        title="切换替换 (Ctrl+H)"
        @click="toggleReplace"
      >
        <Icon :name="state.replaceVisible ? 'chevron-down' : 'chevron-right'" :size="13" />
      </button>

      <div class="input-wrap">
        <input
          ref="queryInput"
          v-model="state.findQuery"
          class="field find-field"
          placeholder="查找内容"
          spellcheck="false"
          @input="onQueryInput"
        />
      </div>

      <button
        class="icon-btn opt"
        :class="{ active: state.findCaseSensitive }"
        title="区分大小写"
        @click="state.findCaseSensitive = !state.findCaseSensitive; onQueryInput()"
      >
        <Icon name="keep-case" :size="14" />
      </button>
      <button
        class="icon-btn opt"
        :class="{ active: state.findWholeWord }"
        title="全字匹配"
        @click="state.findWholeWord = !state.findWholeWord; onQueryInput()"
      >
        <Icon name="whole-word" :size="14" />
      </button>
      <button
        class="icon-btn opt"
        :class="{ active: state.findRegex }"
        title="正则表达式"
        @click="state.findRegex = !state.findRegex; onQueryInput()"
      >
        <Icon name="regex" :size="14" />
      </button>

      <template v-if="!isFolderMode">
        <span class="counter">{{ statusText || '0' }}</span>
        <button class="icon-btn" title="上一个 (Shift+Enter)" @click="prev">
          <Icon name="arrow-up" :size="13" />
        </button>
        <button class="icon-btn" title="下一个 (Enter)" @click="next">
          <Icon name="arrow-down" :size="13" />
        </button>
      </template>
      <template v-else>
        <button class="btn primary" :disabled="busy" @click="runFolderSearch">
          {{ busy ? '搜索中…' : '搜索' }}
        </button>
      </template>
    </div>

    <!-- 替换行 -->
    <div v-if="state.replaceVisible" class="input-row replace-row">
      <span class="replace-gap" />
      <div class="input-wrap">
        <input
          ref="replaceInput"
          v-model="state.findReplace"
          class="field find-field"
          placeholder="替换为（正则模式支持 $1 ${name}）"
          spellcheck="false"
        />
      </div>
      <template v-if="!isFolderMode">
        <button class="btn" title="替换当前" @click="replaceOne">替换</button>
        <button class="btn" title="全部替换" @click="replaceAllLocal">全部</button>
      </template>
      <template v-else>
        <button class="btn danger" :disabled="busy" @click="runFolderReplace">
          {{ busy ? '替换中…' : '全部替换' }}
        </button>
      </template>
    </div>

    <!-- 文件夹搜索附加过滤 -->
    <div v-if="isFolderMode" class="filter-row">
      <span class="lbl">包含</span>
      <input
        v-model="state.settings!.search_include"
        class="field tiny"
        placeholder="*.sql,*.java"
        spellcheck="false"
      />
      <span class="lbl">排除</span>
      <input
        v-model="state.settings!.search_exclude"
        class="field tiny"
        placeholder="*.log,*.min.js"
        spellcheck="false"
      />
    </div>
  </div>
</template>

<style scoped>
.find-panel {
  position: absolute;
  top: 6px;
  right: 22px;
  z-index: 50;
  width: 500px;
  max-width: calc(100% - 44px);
  padding: 6px 8px 8px;
  background: var(--bg-find);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.mode-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mode-btn {
  height: 22px;
  padding: 0 9px;
  border-radius: 4px;
  font-size: 11.5px;
  color: var(--text-dim);
  border: 1px solid transparent;
}

.mode-btn:hover {
  background: var(--bg-hover);
}

.mode-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: transparent;
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 3px;
}

.input-wrap {
  flex: 1;
  min-width: 0;
}

.find-field {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 12px;
}

.toggle-replace {
  width: 20px;
}

.opt {
  width: 22px;
  height: 24px;
}

.opt.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.counter {
  font-size: 11px;
  color: var(--text-faint);
  min-width: 52px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.replace-row {
  padding-left: 0;
}

.replace-gap {
  width: 20px;
  flex-shrink: 0;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-top: 3px;
  border-top: 1px solid var(--border);
  margin-top: 1px;
}

.filter-row .lbl {
  font-size: 11px;
  color: var(--text-faint);
  flex-shrink: 0;
}

.field.tiny {
  flex: 1;
  min-width: 0;
  height: 22px;
  font-size: 11px;
  font-family: var(--font-mono);
}
</style>
