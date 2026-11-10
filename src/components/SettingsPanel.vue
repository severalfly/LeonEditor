<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import { state, applySettings, persistSettings } from '../lib/store'
import { askConfirm } from '../lib/confirm'
import { api, type FontInfo } from '../lib/api'
import {
  keyActions,
  KEY_GROUPS,
  keymapState,
  formatKeys,
  keysFromEvent,
  findConflict,
  sameBinding,
  setKeys,
  resetKeys,
  resetAllKeys,
  applyBindings,
  collectOverrides
} from '../lib/keymap'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const local = ref<any>(null)
const fonts = ref<FontInfo[]>([])
const fontsLoading = ref(false)
const fontFilter = ref('')
const showFontList = ref(false)

watch(
  () => props.show,
  async (v) => {
    if (v && state.settings) {
      local.value = JSON.parse(JSON.stringify(state.settings))
      if (!local.value.keybindings) local.value.keybindings = {}
      showFontList.value = false
      fontFilter.value = ''
      stopRecord()
      if (fonts.value.length === 0) {
        fontsLoading.value = true
        try {
          fonts.value = await api.listSystemFonts()
        } catch {
          fonts.value = []
        } finally {
          fontsLoading.value = false
        }
      }
    } else {
      stopRecord()
    }
  }
)

const filteredFonts = computed(() => {
  const q = fontFilter.value.trim().toLowerCase()
  let list = fonts.value
  if (q) list = list.filter((f) => f.name.toLowerCase().includes(q))
  return list.slice(0, 300)
})

const monoFonts = computed(() => fonts.value.filter((f) => f.monospace))
const otherFonts = computed(() => fonts.value.filter((f) => !f.monospace))

/** 当前字体串里的首个字体名（用于展示） */
const currentFontName = computed(() => {
  const f = local.value?.font_family ?? ''
  return f.split(',')[0].trim().replace(/^["']|["']$/g, '')
})

function pickFont(name: string) {
  if (!local.value) return
  // 保留等宽兜底链，确保选到非等宽字体时代码列仍对齐
  local.value.font_family = `"${name}", Consolas, "Microsoft YaHei", monospace`
  showFontList.value = false
  fontFilter.value = ''
}

function clearFont() {
  if (!local.value) return
  local.value.font_family = 'Consolas, "Microsoft YaHei", monospace'
}

async function save() {
  if (!local.value) return
  stopRecord()
  // 保存时把当前生效的绑定收进配置（只存改过的项）
  local.value.keybindings = collectOverrides()
  await applySettings(local.value)
  await persistSettings()
  emit('close')
}

/** 关闭（取消）：运行时快捷键还原到已保存的版本，避免「取消」却留下改动 */
function cancel() {
  stopRecord()
  applyBindings(state.settings?.keybindings ?? {})
  emit('close')
}

/* ---------------- 快捷键自定义 ---------------- */

const recordingId = ref<string | null>(null)
const recordError = ref('')

const groupedActions = computed(() =>
  KEY_GROUPS.map((g) => ({ group: g, items: keyActions.filter((a) => a.group === g) })).filter(
    (g) => g.items.length > 0
  )
)

function startRecord(id: string) {
  recordingId.value = id
  recordError.value = ''
  keymapState.recording = true
}

function stopRecord() {
  recordingId.value = null
  recordError.value = ''
  keymapState.recording = false
}

function toggleRecord(id: string) {
  if (recordingId.value === id) stopRecord()
  else startRecord(id)
}

/** 录制态下的按键捕获（window 捕获阶段，先于 Monaco 拿到） */
function onRecordKey(e: KeyboardEvent) {
  if (!recordingId.value) return
  // 注意：只 stopPropagation 挡不住同在 window 捕获阶段注册的其它监听
  // （App.vue 的快捷键分发就是那个），必须 stopImmediatePropagation
  e.preventDefault()
  e.stopImmediatePropagation()

  if (e.key === 'Escape') {
    stopRecord()
    return
  }

  const keys = keysFromEvent(e)
  if (!keys) {
    recordError.value = '请按下字母 / 数字 / 功能键（不能只有修饰键）'
    return
  }
  // 至少含 Ctrl 或 Alt，避免把普通输入吃掉
  if (!/(^|\+)ctrl(\+|$)/.test(keys) && !/(^|\+)alt(\+|$)/.test(keys)) {
    recordError.value = '必须包含 Ctrl 或 Alt（否则会占用正常输入）'
    return
  }

  const conflict = findConflict(keys, recordingId.value)
  if (conflict) {
    recordError.value = `与「${conflict.label}」冲突（${formatKeys(conflict.keys)}），已拒绝`
    return
  }

  setKeys(recordingId.value, keys)
  if (local.value) local.value.keybindings = collectOverrides()
  stopRecord()
}

function resetOne(id: string) {
  stopRecord()
  resetKeys(id)
  if (local.value) local.value.keybindings = collectOverrides()
}

function resetAllBindings() {
  stopRecord()
  resetAllKeys()
  if (local.value) local.value.keybindings = collectOverrides()
}

onMounted(() => {
  // 组件先于 App 挂载，所以这个捕获监听排在 App 的清空监听之前
  window.addEventListener('keydown', onRecordKey, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onRecordKey, true)
  stopRecord()
})

async function reset() {
  const choice = await askConfirm({
    title: '恢复默认设置？',
    message: '当前所有设置项会被重置为默认值。',
    buttons: [
      { label: '恢复默认', value: 'ok', kind: 'danger' },
      { label: '取消', value: 'cancel', kind: 'default' }
    ]
  })
  if (choice !== 'ok') return
  local.value = {
    theme: 'light',
    font_family: 'Cascadia Code, Consolas, Microsoft YaHei, monospace',
    font_size: 14,
    tab_size: 4,
    insert_spaces: true,
    word_wrap: true,
    show_minimap: true,
    show_line_numbers: true,
    highlight_current_line: true,
    auto_save: false,
    restore_session: true,
    show_hidden_files: false,
    trim_trailing_whitespace: false,
    ensure_final_newline: false,
    search_include: '',
    search_exclude: '',
    sidebar_width: 260,
    keybindings: {}
  }
  resetAllBindings()
}
</script>

<template>
  <div v-if="show && local" class="modal-mask" @click.self="cancel">
    <div class="modal settings-modal">
      <div class="modal-header">
        <span>设置</span>
        <button class="icon-btn" @click="cancel"><Icon name="close" :size="14" /></button>
      </div>

      <div class="modal-body">
        <div class="group">
          <div class="group-title">外观</div>

          <div class="row">
            <label>主题</label>
            <div class="seg">
              <button :class="{ on: local.theme === 'light' }" @click="local.theme = 'light'">
                <Icon name="sun" :size="12" /> 浅色
              </button>
              <button :class="{ on: local.theme === 'dark' }" @click="local.theme = 'dark'">
                <Icon name="moon" :size="12" /> 深色
              </button>
            </div>
          </div>

          <div class="row">
            <label>字体</label>
            <div class="font-picker">
              <button class="field font-btn" type="button" @click="showFontList = !showFontList">
                <span class="font-current" :style="{ fontFamily: local.font_family }">
                  {{ currentFontName || '（默认）' }}
                </span>
                <span class="font-sample" :style="{ fontFamily: local.font_family }">Aa 中文 0x1F</span>
                <Icon :name="showFontList ? 'chevron-up' : 'chevron-down'" :size="12" />
              </button>

              <div v-if="showFontList" class="font-dropdown">
                <div class="font-search-row">
                  <input
                    v-model="fontFilter"
                    class="field font-search"
                    placeholder="搜索字体名…"
                    spellcheck="false"
                    autofocus
                  />
                  <button class="btn" type="button" @click="clearFont">恢复默认</button>
                </div>

                <div v-if="fontsLoading" class="font-loading">正在读取系统字体…</div>

                <div v-else class="font-list">
                  <template v-if="!fontFilter">
                    <div v-if="monoFonts.length" class="font-group-label">等宽字体（推荐用于代码）</div>
                    <button
                      v-for="f in monoFonts"
                      :key="'m' + f.name"
                      type="button"
                      class="font-item mono"
                      :class="{ active: currentFontName === f.name }"
                      :style="{ fontFamily: `'${f.name}', monospace` }"
                      @click="pickFont(f.name)"
                    >
                      <span class="fi-name">{{ f.name }}</span>
                      <span class="fi-sample">const x = 1;</span>
                    </button>

                    <div v-if="otherFonts.length" class="font-group-label">其他字体</div>
                    <button
                      v-for="f in otherFonts"
                      :key="'o' + f.name"
                      type="button"
                      class="font-item"
                      :class="{ active: currentFontName === f.name }"
                      :style="{ fontFamily: `'${f.name}', sans-serif` }"
                      @click="pickFont(f.name)"
                    >
                      <span class="fi-name">{{ f.name }}</span>
                      <span class="fi-sample">中文示例</span>
                    </button>
                  </template>

                  <template v-else>
                    <button
                      v-for="f in filteredFonts"
                      :key="f.name"
                      type="button"
                      class="font-item"
                      :class="{ active: currentFontName === f.name }"
                      :style="{ fontFamily: `'${f.name}', ${f.monospace ? 'monospace' : 'sans-serif'}` }"
                      @click="pickFont(f.name)"
                    >
                      <span class="fi-name">{{ f.name }}</span>
                      <span class="fi-sample">Aa 中文 0x1F</span>
                    </button>
                    <div v-if="filteredFonts.length === 0" class="font-loading">没有匹配的字体</div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div class="row">
            <label>字号</label>
            <input v-model.number="local.font_size" type="number" min="9" max="32" class="field num" />
            <span class="hint">px</span>
          </div>

          <div class="row">
            <label>小地图</label>
            <input v-model="local.show_minimap" type="checkbox" />
          </div>

          <div class="row">
            <label>行号</label>
            <input v-model="local.show_line_numbers" type="checkbox" />
          </div>

          <div class="row">
            <label>高亮当前行</label>
            <input v-model="local.highlight_current_line" type="checkbox" />
          </div>
        </div>

        <div class="group">
          <div class="group-title">编辑</div>

          <div class="row">
            <label>Tab 宽度</label>
            <input v-model.number="local.tab_size" type="number" min="1" max="8" class="field num" />
          </div>

          <div class="row">
            <label>用空格缩进</label>
            <input v-model="local.insert_spaces" type="checkbox" />
          </div>

          <div class="row">
            <label>软换行</label>
            <input v-model="local.word_wrap" type="checkbox" />
            <span class="hint">快捷键 Alt+Z</span>
          </div>

          <div class="row">
            <label>保存时删除行尾空格</label>
            <input v-model="local.trim_trailing_whitespace" type="checkbox" />
          </div>

          <div class="row">
            <label>保存时确保末尾换行</label>
            <input v-model="local.ensure_final_newline" type="checkbox" />
          </div>
        </div>

        <div class="group">
          <div class="group-title">文件与搜索</div>

          <div class="row">
            <label>启动时恢复上次会话</label>
            <input v-model="local.restore_session" type="checkbox" />
          </div>

          <div class="row">
            <label>显示隐藏文件</label>
            <input v-model="local.show_hidden_files" type="checkbox" />
          </div>

          <div class="row">
            <label>默认包含</label>
            <input v-model="local.search_include" class="field wide" placeholder="*.sql,*.java（留空为全部）" spellcheck="false" />
          </div>

          <div class="row">
            <label>默认排除</label>
            <input v-model="local.search_exclude" class="field wide" placeholder="*.log,*.min.js" spellcheck="false" />
          </div>
        </div>

        <div class="group">
          <div class="group-title">快捷键</div>

          <div class="kb-note">
            点「修改」后按下新的组合键（需包含 <kbd>Ctrl</kbd> 或 <kbd>Alt</kbd>），立即生效；
            点「保存」后写入配置，下次启动依然有效。
            编辑器自带的快捷键（撤销、多光标、缩进、折叠等）由 Monaco 管理，不在此列表中。
          </div>

          <div v-for="g in groupedActions" :key="g.group" class="kb-group">
            <div class="kb-group-label">{{ g.group }}</div>
            <div
              v-for="a in g.items"
              :key="a.id"
              class="kb-row"
              :data-action-id="a.id"
              :data-keys="a.keys"
            >
              <span class="kb-label">
                {{ a.label }}
                <span v-if="a.desc" class="kb-desc">{{ a.desc }}</span>
              </span>
              <span class="kb-keys" :class="{ recording: recordingId === a.id }">
                <template v-if="recordingId === a.id">按下组合键…</template>
                <template v-else>{{ formatKeys(a.keys) }}</template>
              </span>
              <button
                class="btn tiny"
                :data-rec="a.id"
                @click="toggleRecord(a.id)"
              >
                {{ recordingId === a.id ? '取消' : '修改' }}
              </button>
              <button
                class="btn tiny"
                :disabled="sameBinding(a.keys, a.defaultKeys)"
                @click="resetOne(a.id)"
              >
                默认
              </button>
            </div>
          </div>

          <div v-if="recordError" class="kb-error">{{ recordError }}</div>

          <div class="kb-footer">
            <button class="btn tiny" data-kb-reset-all @click="resetAllBindings">全部恢复默认</button>
            <span class="hint">共 {{ keyActions.length }} 个可自定义动作</span>
          </div>
        </div>

        <div v-if="state.appInfo" class="group info-group">
          <div class="group-title">关于</div>
          <div class="info-line">
            <span>版本</span><span>{{ state.appInfo.version }}</span>
          </div>
          <div class="info-line">
            <span>模式</span>
            <span :class="state.appInfo.portable ? 'ok' : ''">
              {{ state.appInfo.portable ? '便携模式（配置写在程序目录）' : '标准模式' }}
            </span>
          </div>
          <div class="info-line">
            <span>配置目录</span>
            <span class="mono selectable">{{ state.appInfo.config_dir }}</span>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn" @click="reset">恢复默认</button>
        <div style="flex: 1" />
        <button class="btn" @click="cancel">取消</button>
        <button class="btn primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-modal {
  width: 620px;
}

.group {
  margin-bottom: 18px;
}

.group:last-child {
  margin-bottom: 0;
}

.group-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--text-faint);
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--border);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
  margin-bottom: 5px;
}

.row label {
  width: 150px;
  flex-shrink: 0;
  font-size: 12.5px;
  color: var(--text-dim);
}

.field.wide {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.field.num {
  width: 66px;
  text-align: center;
}

.hint {
  font-size: 11px;
  color: var(--text-faint);
}

input[type='checkbox'] {
  width: 14px;
  height: 14px;
  accent-color: var(--accent);
  cursor: pointer;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 5px;
  overflow: hidden;
}

.seg button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 12px;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg-input);
}

.seg button.on {
  background: var(--accent);
  color: #fff;
}

.info-line {
  display: flex;
  gap: 10px;
  font-size: 11.5px;
  padding: 3px 0;
  color: var(--text-dim);
}

.info-line > span:first-child {
  width: 150px;
  flex-shrink: 0;
  color: var(--text-faint);
}

.info-line .mono {
  font-family: var(--font-mono);
  word-break: break-all;
}

.info-line .ok {
  color: var(--success);
}

/* ---------- 字体选择器 ---------- */

.font-picker {
  position: relative;
  flex: 1;
  min-width: 0;
}

.font-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  text-align: left;
  cursor: pointer;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
}

.font-btn:hover {
  border-color: var(--border-strong);
}

.font-current {
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}

.font-sample {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--text-faint);
  opacity: 0.85;
}

.font-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--bg-overlay);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.font-search-row {
  display: flex;
  gap: 6px;
  padding: 7px;
  border-bottom: 1px solid var(--border);
}

.font-search {
  flex: 1;
  min-width: 0;
  height: 26px;
}

.font-list {
  max-height: 300px;
  overflow-y: auto;
  padding: 4px;
}

.font-group-label {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-faint);
  padding: 8px 8px 4px;
  letter-spacing: 0.3px;
}

.font-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border-radius: 4px;
  text-align: left;
  color: var(--text);
  cursor: pointer;
}

.font-item:hover {
  background: var(--bg-hover);
}

.font-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.fi-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}

.fi-sample {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-faint);
  opacity: 0.85;
}

.font-loading {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--text-faint);
}

/* ---------- 快捷键 ---------- */

.kb-note {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-faint);
  margin-bottom: 10px;
}

.kb-note kbd {
  display: inline-block;
  padding: 0 4px;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: 3px;
  background: var(--bg-sidebar);
  font-family: var(--font-ui);
  font-size: 10px;
  color: var(--text-dim);
}

.kb-group {
  margin-bottom: 8px;
}

.kb-group-label {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-faint);
  letter-spacing: 0.3px;
  padding: 4px 0 2px;
}

.kb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 2px 0;
  border-top: 1px solid var(--border);
}

.kb-label {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--text-dim);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.kb-desc {
  font-size: 10.5px;
  color: var(--text-faint);
  opacity: 0.85;
}

.kb-keys {
  flex-shrink: 0;
  min-width: 118px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-input);
  border: 1px solid var(--border);
}

.kb-keys.recording {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
  font-family: var(--font-ui);
  animation: kb-pulse 1s ease-in-out infinite;
}

@keyframes kb-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

.btn.tiny {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
  flex-shrink: 0;
}

.btn.tiny:disabled {
  opacity: 0.4;
  cursor: default;
}

.kb-error {
  font-size: 11.5px;
  color: var(--danger);
  padding: 4px 0 2px;
}

.kb-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
}
</style>
