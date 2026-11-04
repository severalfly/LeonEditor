<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { state, toggleExpand } from '../lib/store'
import type { TreeNode } from '../lib/api'

defineOptions({ name: 'TreeNodeRow' })

const props = defineProps<{
  node: TreeNode
  depth: number
  filter: string
  activePath: string | null
  openPaths: string[]
}>()

const emit = defineEmits<{
  (e: 'toggle', node: TreeNode): void
  (e: 'open', path: string): void
  (e: 'ctx', ev: MouseEvent, node: TreeNode): void
}>()

const expanded = computed(() => state.expandedPaths.has(props.node.path))
const isActive = computed(() => props.activePath === props.node.path)
const isOpen = computed(() => props.openPaths.includes(props.node.path))

const visibleChildren = computed(() => {
  const ch = props.node.children ?? []
  if (!props.filter) return ch
  const q = props.filter.toLowerCase()
  return ch.filter((c) => c.isDir || c.name.toLowerCase().includes(q))
})

function iconClass(n: TreeNode): string {
  if (n.isDir) return 'dir'
  const name = n.name.toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  if (['sql', 'ddl', 'dml'].includes(ext)) return 'sql'
  if (['java', 'kt'].includes(ext)) return 'java'
  if (['py'].includes(ext)) return 'py'
  if (['ts', 'tsx', 'js', 'jsx', 'vue'].includes(ext)) return 'js'
  if (['json', 'yml', 'yaml', 'toml', 'ini', 'properties', 'xml', 'conf', 'csv'].includes(ext))
    return 'cfg'
  if (['md', 'txt', 'log', 'rst'].includes(ext)) return 'doc'
  if (['sh', 'bash', 'ps1', 'bat', 'cmd'].includes(ext)) return 'sh'
  return 'plain'
}

function onClick() {
  if (props.node.isDir) emit('toggle', props.node)
  else emit('open', props.node.path)
}

const indent = computed(() => 8 + props.depth * 12)
</script>

<template>
  <div
    class="row"
    :class="{ active: isActive, open: isOpen && !isActive, dir: node.isDir }"
    :style="{ paddingLeft: indent + 'px' }"
    :title="node.path"
    @click="onClick"
    @contextmenu.prevent.stop="emit('ctx', $event, node)"
  >
    <span class="twisty">
      <Icon v-if="node.isDir" :name="expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
    </span>
    <span class="ficon" :class="'ficon-' + iconClass(node)">
      <Icon :name="node.isDir ? 'folder' : 'file'" :size="node.isDir ? 14 : 13" />
    </span>
    <span class="fname" :class="{ filtered: filter && node.name.toLowerCase().includes(filter.toLowerCase()) }">
      {{ node.name }}
    </span>
  </div>

  <template v-if="node.isDir && expanded">
    <TreeNodeRow
      v-for="child in visibleChildren"
      :key="child.path"
      :node="child"
      :depth="depth + 1"
      :filter="filter"
      :active-path="activePath"
      :open-paths="openPaths"
      @toggle="(n: TreeNode) => emit('toggle', n)"
      @open="(p: string) => emit('open', p)"
      @ctx="(e: MouseEvent, n: TreeNode) => emit('ctx', e, n)"
    />
  </template>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 23px;
  padding-right: 8px;
  cursor: pointer;
  color: var(--text);
  font-size: 12.5px;
  white-space: nowrap;
}

.row:hover {
  background: var(--bg-hover);
}

.row.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.twisty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  flex-shrink: 0;
  color: var(--text-faint);
}

.ficon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.ficon-dir {
  color: #d4a72c;
}
.ficon-sql {
  color: #e3a008;
}
.ficon-java {
  color: #c94a2a;
}
.ficon-py {
  color: #3572a5;
}
.ficon-js {
  color: #c9a227;
}
.ficon-cfg {
  color: #8b949e;
}
.ficon-doc {
  color: #57606a;
}
.ficon-sh {
  color: #3fb950;
}
.ficon-plain {
  color: var(--text-faint);
}

.fname {
  overflow: hidden;
  text-overflow: ellipsis;
}

.fname.filtered {
  background: var(--match-bg);
  color: var(--match-text);
  border-radius: 2px;
  padding: 0 2px;
}
</style>
