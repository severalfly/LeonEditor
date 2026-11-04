<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import TreeNodeRow from './TreeNodeRow.vue'
import { state, toggleExpand } from '../lib/store'
import type { TreeNode } from '../lib/api'

const props = defineProps<{
  filter: string
}>()

const emit = defineEmits<{
  (e: 'file-open', path: string): void
  (e: 'context-menu', payload: { x: number; y: number; node: TreeNode }): void
}>()

const rootChildren = computed(() => {
  const ch = state.tree?.children ?? []
  if (!props.filter) return ch
  const q = props.filter.toLowerCase()
  return ch.filter((c) => c.isDir || c.name.toLowerCase().includes(q))
})

const rootName = computed(() => {
  if (!state.rootFolder) return ''
  return state.rootFolder.split(/[\\/]/).filter(Boolean).pop() ?? state.rootFolder
})

const activePath = computed(() => state.tabs.find((t) => t.id === state.activeId)?.path ?? null)
const openPaths = computed(() => state.tabs.map((t) => t.path).filter(Boolean) as string[])

function onCtx(e: MouseEvent, node: TreeNode) {
  emit('context-menu', { x: e.clientX, y: e.clientY, node })
}
</script>

<template>
  <div class="tree">
    <div v-if="state.rootFolder" class="root-header" :title="state.rootFolder">
      <Icon name="folder-open" :size="14" class="root-icon" />
      <span class="root-name">{{ rootName }}</span>
    </div>

    <div v-if="!state.rootFolder" class="empty-hint">
      <Icon name="folder" :size="28" style="opacity: 0.35" />
      <div>未打开文件夹</div>
      <div class="tiny">Ctrl+K 然后 Ctrl+O 打开文件夹</div>
    </div>

    <div v-else class="tree-body">
      <TreeNodeRow
        v-for="node in rootChildren"
        :key="node.path"
        :node="node"
        :depth="0"
        :filter="filter"
        :active-path="activePath"
        :open-paths="openPaths"
        @toggle="toggleExpand"
        @open="(p: string) => emit('file-open', p)"
        @ctx="onCtx"
      />
    </div>
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.root-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.root-icon {
  color: var(--accent);
}

.root-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-body {
  flex: 1;
  padding: 4px 0 12px;
  overflow: auto;
}

.empty-hint {
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

.empty-hint .tiny {
  font-size: 11px;
  opacity: 0.7;
}
</style>
