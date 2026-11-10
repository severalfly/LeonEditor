<script setup lang="ts">
import { computed, nextTick } from 'vue'
import Icon from './Icon.vue'
import { state, dirtyLabel, closeTab, createUntitled, getEditorInstance, type Tab } from '../lib/store'

const emit = defineEmits<{
  (e: 'closed-all'): void
  (e: 'context-menu', payload: { x: number; y: number; tab: Tab }): void
}>()

function onTabClick(id: string) {
  state.activeId = id
}

async function onClose(e: MouseEvent, tab: Tab) {
  e.stopPropagation()
  await closeTab(tab.id)
}

function onCtx(e: MouseEvent, tab: Tab) {
  e.preventDefault()
  emit('context-menu', { x: e.clientX, y: e.clientY, tab })
}

function onWheel(e: WheelEvent) {
  // 横向滚动标签栏
  const el = e.currentTarget as HTMLElement
  el.scrollLeft += e.deltaY
}

/**
 * 双击标签栏的空白区域 → 新建未命名标签（等价 Ctrl+N）。
 * 必须排除点在标签本身上的情况，否则双击标签会误建新文件。
 */
function onBlankDblClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (!t) return
  // .tab / .tab-name / .tab-close 及其子元素都算「点在标签上」
  if (t.closest('.tab')) return
  e.preventDefault()
  e.stopPropagation()
  createUntitled()
  // 新建后立即能打字：等 model 挂到编辑器上再聚焦
  nextTick(() => {
    const ed = getEditorInstance()
    ed?.focus()
  })
}
</script>

<template>
  <div class="tabbar">
    <div class="tabs" @wheel.passive="onWheel" @dblclick="onBlankDblClick">
      <div
        v-for="tab in state.tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === state.activeId, dirty: tab.dirty }"
        :title="tab.path ?? tab.name"
        @click="onTabClick(tab.id)"
        @mousedown.middle.prevent="onClose($event, tab)"
        @contextmenu="onCtx($event, tab)"
      >
        <span class="tab-name">{{ dirtyLabel(tab) }}</span>
        <button class="tab-close" :title="'关闭 (Ctrl+W)'" @click="onClose($event, tab)">
          <Icon name="close" :size="11" :stroke="2" />
        </button>
      </div>
      <div class="tab-filler" />
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: stretch;
  height: var(--tabbar-h);
  background: var(--bg-tabbar);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  overflow: hidden;
}

.tabs {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
  padding: 0 0 0 4px;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
  height: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: calc(var(--tabbar-h) - 1px);
  padding: 0 6px 0 12px;
  max-width: 220px;
  min-width: 90px;
  background: var(--bg-tab);
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  font-size: 12.5px;
  color: var(--text-dim);
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: background var(--transition), color var(--transition);
}

.tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tab.active {
  background: var(--bg-tab-active);
  color: var(--text);
  border-color: var(--border-strong);
}

.tab.active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--bg-tab-active);
}

.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.tab.dirty .tab-name {
  font-style: normal;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 3px;
  color: var(--text-faint);
  opacity: 0;
  flex-shrink: 0;
  transition: opacity var(--transition), background var(--transition);
}

.tab:hover .tab-close,
.tab.active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--bg-active);
  color: var(--text);
}

.tab-filler {
  flex: 1;
  min-width: 20px;
}
</style>
