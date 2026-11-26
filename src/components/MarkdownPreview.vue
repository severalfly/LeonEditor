<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const props = defineProps<{ text: string }>()
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
const html = computed(() => DOMPurify.sanitize(md.render(props.text ?? '')))
</script>

<template>
  <div class="md-preview">
    <div class="md-head">Markdown 预览</div>
    <div class="md-body" v-html="html" />
  </div>
</template>

<style scoped>
.md-preview {
  flex: 0 0 50%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg-editor);
}
.md-head {
  flex: 0 0 28px;
  height: 28px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  background: var(--bg-tabbar);
}
.md-body {
  flex: 1;
  overflow: auto;
  padding: 16px 22px 60px;
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.75;
}
.md-body :deep(h1), .md-body :deep(h2) { border-bottom: 1px solid var(--border); padding-bottom: 6px; }
.md-body :deep(pre) {
  background: var(--bg-sidebar);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.md-body :deep(code) { font-family: var(--font-mono); background: var(--bg-hover); border-radius: 4px; padding: 1px 4px; font-size: 12.5px; }
.md-body :deep(pre code) { background: none; padding: 0; }
.md-body :deep(blockquote) { margin: 0; padding-left: 12px; border-left: 3px solid var(--border-strong); color: var(--text-dim); }
.md-body :deep(a) { color: var(--accent); }
.md-body :deep(table) { border-collapse: collapse; }
.md-body :deep(th), .md-body :deep(td) { border: 1px solid var(--border); padding: 4px 8px; }
.md-body :deep(img) { max-width: 100%; }
</style>
