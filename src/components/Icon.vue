<script setup lang="ts">
/**
 * 内联 SVG 图标。用 path 字符串避免额外依赖，减小包体。
 */
const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    stroke?: number
  }>(),
  { size: 16, stroke: 1.8 }
)

const PATHS: Record<string, string> = {
  // 文件与文件夹
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  'folder-open': 'M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1H5.5a2 2 0 0 0-1.9 1.4L3 17V7z M3.6 18.6 5.4 12A2 2 0 0 1 7.3 10.6h13.1a1 1 0 0 1 .96 1.27l-1.6 5.6a2 2 0 0 1-1.92 1.46H4.5a1 1 0 0 1-.9-1.33z',
  file: 'M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M13 3v5h5',
  'file-plus': 'M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M13 3v5h5 M9 14h6 M12 11v6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'arrow-up': 'M12 19V5 M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14 M19 12l-7 7-7-7',
  'keep-case': 'M4 18h3l2-6h6l2 6h3 M8.5 10h7',
  'whole-word': 'M4 6h4v12H4z M14 6h6v12h-6z M8 12h6',
  regex: 'M4 8h3v3H4z M11 5l3 3 M14 5l-3 3 M17 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6z M5 16h4',
  // 操作
  close: 'M6 6l12 12 M18 6L6 18',
  save: 'M5 4h11l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 4v6h8V4 M8 20v-6h8v6',
  'save-as': 'M5 4h11l3 3v6 M8 4v6h8V4 M8 20v-6h5 M17 14v3h3 M18.5 17v3',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M20 20l-4.2-4.2',
  'search-folder': 'M3 6a1 1 0 0 1 1-1h4l2 2h5a1 1 0 0 1 1 1v3 M11 18a4 4 0 1 1 0-8 4 4 0 0 1 0 8z M14 17l3 3',
  replace: 'M4 7h12l-3-3 M4 7l3 3 M20 17H8l3 3 M20 17l-3-3',
  'replace-all': 'M4 6h10l-2.5-2.5 M4 6l2.5 2.5 M4 12h10l-2.5-2.5 M4 12l2.5 2.5 M14 18l3-6 3 6 M15.2 16h3.6',
  'fold-all': 'M8 6l4 4 4-4 M8 18l4-4 4 4',
  'unfold-all': 'M8 10l4-4 4 4 M8 14l4 4 4-4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z',
  sidebar: 'M4 5h16 M4 5v14h16V5 M9 5v14',
  'sidebar-off': 'M4 5h16 M4 5v14h16V5 M9 5v14',
  'panel-right': 'M4 5h16v14H4z M15 5v14',
  'close-all': 'M6 6l8 8 M14 6l-8 8 M17 6l4 4-4 4',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  'more-v': 'M12 5v.01 M12 12v.01 M12 19v.01',
  'wrap-text': 'M4 6h16 M4 12h12a3 3 0 0 1 0 6h-3 M4 18h.01 M13 15l-2 3 2 3',
  'line-numbers': 'M4 6h1 M4 12h1 M4 18h1 M8 6h12 M8 12h12 M8 18h12',
  minimap: 'M4 4h16v16H4z M13 7h5v9h-5z',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 8v4l3 2',
  encoding: 'M4 18h6 M7 6v12 M4 6h6 M14 18h6 M17 6v12 M14 6h6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8v.01',
  warning: 'M12 3l9 16H3z M12 9v4 M12 16v.01',
  check: 'M5 13l4 4L19 7',
  x: 'M6 6l12 12 M18 6L6 18',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  refresh: 'M20 11A8 8 0 0 0 6.3 6.3L3 9 M4 13a8 8 0 0 0 13.7 4.7L21 15 M3 4v5h5 M21 20v-5h-5',
  'edit-file': 'M11 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5 M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
  'external': 'M14 4h6v6 M20 4l-9 9 M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  'go-to': 'M12 3v14 M7 12l5 5 5-5 M5 21h14',
  'copy-path': 'M9 9h10v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9z M5 15V5a1 1 0 0 1 1-1h10',
  'sort-alpha': 'M4 18V6l4 12V6 M12 6h8 M12 12h6 M12 18h8'
}

const d = computed(() => PATHS[props.name] ?? '')
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    :stroke-width="stroke"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="svg-icon"
  >
    <path :d="d" />
  </svg>
</template>

<script lang="ts">
import { computed } from 'vue'
export default { name: 'Icon' }
</script>

<style scoped>
.svg-icon {
  display: block;
  flex-shrink: 0;
}
</style>
