<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import Icon from './Icon.vue'
import { state, showToast, activeTab } from '../lib/store'
import { askConfirm } from '../lib/confirm'
import { api } from '../lib/api'
import type { SearchResult } from '../lib/api'
import { replaceAllInModel, replaceOneInModel } from '../lib/search'

const props = defineProps<{
  /**
   * 查询当前文件内的匹配数。
   *
   * 这里**必须**是函数 prop 而不是 emit：Vue 3 的 emit() 返回 undefined，
   * 不会把父组件处理器的返回值传回来，之前用 emit 导致计数永远是 0，
   * 面板一直显示「无匹配」、也不跳转到第一个匹配（正文高亮却是好的）。
   */
  findLocal: (opts: {
    query: string
    regex: boolean
    caseSensitive: boolean
    wholeWord: boolean
  }) => number
}>()

const emit = defineEmits<{
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

// 面板已经打开时再按 Ctrl+F：findVisible 不变，靠 tick 重新聚焦
watch(
  () => state.findFocusTick,
  () => focusQuery()
)

function searchOpts() {
  return {
    query: state.findQuery,
    regex: state.findRegex,
    caseSensitive: state.findCaseSensitive,
    wholeWord: state.findWholeWord
  }
}

function runLocal(step = 0) {
  if (!state.findQuery) {
    localCount.value = 0
    localIndex.value = -1
    statusText.value = ''
    emit('clear-local')
    return
  }
  const n = props.findLocal(searchOpts())
  localCount.value = typeof n === 'number' ? n : 0
  if (localCount.value === 0) {
    statusText.value = '无匹配'
    localIndex.value = -1
    // 旧高亮必须清掉，否则正文还留着上一轮的黄块
    emit('clear-local')
    return
  }
  localIndex.value = step === 0 ? 0 : (localIndex.value + step + localCount.value) % localCount.value
  emit('goto-match', localIndex.value)
  statusText.value = `${localIndex.value + 1} / ${localCount.value}`
}

/** 替换之后只刷新计数，不移动选区（替换结果已经被选中了） */
function refreshCountKeepSelection() {
  if (!state.findQuery) return
  const n = props.findLocal(searchOpts())
  localCount.value = typeof n === 'number' ? n : 0
  if (localCount.value === 0) {
    localIndex.value = -1
    statusText.value = '无匹配'
    emit('clear-local')
    return
  }
  localIndex.value = 0
  statusText.value = `1 / ${localCount.value}`
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

/** 当前文件内的替换：改的是编辑器里的 model，不动磁盘 */
function canEditCurrent(): boolean {
  const tab = activeTab()
  if (!tab) {
    showToast('请先打开一个文件', 'error')
    return false
  }
  if (tab.binary || tab.readOnly) {
    showToast('当前文件只读，无法替换', 'error')
    return false
  }
  return true
}

function replaceOne() {
  if (!state.findQuery) return
  if (!canEditCurrent()) return
  const n = replaceOneInModel({ ...searchOpts(), replacement: state.findReplace })
  if (n === 0) {
    showToast('没有可替换的匹配', 'info')
    return
  }
  showToast(`已替换 ${n} 处（可 Ctrl+Z 撤销）`, 'success')
  refreshCountKeepSelection()
}

async function replaceAllLocal() {
  if (!state.findQuery) return
  if (!canEditCurrent()) return
  const tab = activeTab()!
  const c1 = await askConfirm({
    title: '在当前文件全部替换？',
    message: `「${state.findQuery}」→「${state.findReplace}」\n\n只改编辑器里的内容，可以 Ctrl+Z 撤销；Ctrl+S 保存后才写入磁盘。`,
    detail: tab.path ?? tab.name,
    buttons: [
      { label: '全部替换', value: 'ok', kind: 'danger' },
      { label: '取消', value: 'cancel', kind: 'default' }
    ]
  })
  if (c1 !== 'ok') return
  const n = replaceAllInModel({ ...searchOpts(), replacement: state.findReplace })
  if (n === 0) {
    showToast('没有可替换的匹配', 'info')
    return
  }
  showToast(`已替换 ${n} 处（可 Ctrl+Z 撤销）`, 'success')
  refreshCountKeepSelection()
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
  const c2 = await askConfirm({
    title: `在${scope}中全部替换？`,
    message: `「${state.findQuery}」→「${state.findReplace}」\n\n此操作直接写盘，不可撤销。`,
    buttons: [
      { label: '全部替换', value: 'ok', kind: 'danger' },
      { label: '取消', value: 'cancel', kind: 'default' }
    ]
  })
  if (c2 !== 'ok') return
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
