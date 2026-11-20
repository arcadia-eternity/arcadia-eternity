<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardDocumentIcon,
  CodeBracketSquareIcon,
  FolderIcon,
  ShieldCheckIcon,
} from '@heroicons/vue/24/outline'
import { ElCheckbox } from 'element-plus'
import { authorCall, type SourceProject } from './types'

const props = defineProps<{ project: SourceProject; readOnly: boolean; contextError: string }>()
const execute = ref(false)
type Connection = { mcpServers: { arcadia: { command: string; args: string[]; env: Record<string, string> } } }
const connection = ref<Connection>()
const config = computed(() => (connection.value ? JSON.stringify(connection.value, null, 2) : ''))
const clients = ['通用 JSON', 'Codex', 'Claude Code', 'Cursor', 'VS Code'] as const
const client = ref<(typeof clients)[number]>('通用 JSON')
const manualConfig = computed(() => {
  if (!connection.value) return ''
  const { arcadia } = connection.value.mcpServers
  if (client.value === 'VS Code')
    return JSON.stringify({ servers: { arcadia: { type: 'stdio', ...arcadia } } }, null, 2)
  if (client.value === 'Codex') {
    return [
      '[mcp_servers.arcadia]',
      'command = ' + JSON.stringify(arcadia.command),
      'args = ' + JSON.stringify(arcadia.args),
      '',
      '[mcp_servers.arcadia.env]',
      ...Object.entries(arcadia.env).map(([key, value]) => JSON.stringify(key) + ' = ' + JSON.stringify(value)),
    ].join('\n')
  }
  return config.value
})
const manualLocation = computed(() => {
  if (props.readOnly) return '客户端的本机配置'
  switch (client.value) {
    case 'Codex':
      return '.codex/config.toml'
    case 'Claude Code':
      return '.mcp.json'
    case 'Cursor':
      return '.cursor/mcp.json'
    case 'VS Code':
      return '.vscode/mcp.json'
    default:
      return 'mcpServers'
  }
})
const error = ref('')
const notice = ref('')
const manualCopy = ref('')
const copyField = ref<HTMLTextAreaElement>()
const retry = ref(0)
watch(
  [() => props.project.id, () => props.readOnly, execute, retry],
  async ([id, readOnly, allowExecution], _, onCleanup) => {
    let current = true
    onCleanup(() => {
      current = false
    })
    connection.value = undefined
    error.value = ''
    notice.value = ''
    manualCopy.value = ''
    try {
      const result = await authorCall<Connection>({
        action: 'connection',
        id,
        execute: allowExecution && !readOnly,
      })
      if (current) connection.value = result
    } catch (cause) {
      if (current) error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
  { immediate: true },
)

watch(client, () => {
  notice.value = ''
  manualCopy.value = ''
})
const introduction = computed(
  () => `请帮我连接本机的 Arcadia Eternity 创作项目「${props.project.name}」，并确认你能访问的项目和权限。`,
)
const prompt = computed(() => {
  if (!config.value) return ''
  return [
    introduction.value,
    '先完成连接验证，之后等我说明要创作的内容。',
    '项目目录为 ' + JSON.stringify(props.project.directory),
    props.readOnly
      ? '这是只读内容包。请在内容包目录之外的客户端本机设置中注册服务。'
      : '请使用项目级配置。Codex 用 .codex/config.toml 的 [mcp_servers.arcadia] 和 [mcp_servers.arcadia.env]。Claude Code 用 .mcp.json 的 mcpServers。Cursor 用 .cursor/mcp.json 的 mcpServers。VS Code 用 .vscode/mcp.json 的 servers，并设置 type 为 stdio。只配置你所在的客户端。',
    '使用下面的 stdio 启动参数，保留 command、args、env 的原值。合并配置并保留其他服务。如果同名服务属于其他项目，请另取名称。请将含本机路径的配置保留在本机。',
    config.value,
    '加载服务后，调用 workspace_describe 核对项目目录，并告诉我实际返回的项目名与读写权限。需要我信任项目、启用服务或重开会话时，请告诉我具体操作。',
    '如果创作工作台已打开，再调用 workspace_context 获取当前选中对象和草稿。',
  ].join('\n\n')
})
async function copy(value: string, success: string) {
  notice.value = ''
  manualCopy.value = ''
  try {
    await navigator.clipboard.writeText(value)
    notice.value = success
  } catch {
    manualCopy.value = value
    await nextTick()
    copyField.value?.focus()
    copyField.value?.select()
  }
}
</script>
<template>
  <section class="connection-page" aria-labelledby="ai-connection-title">
    <div class="connection-layout">
      <header class="connection-header">
        <div class="assistant-icon"><ChatBubbleLeftRightIcon aria-hidden="true" /></div>
        <h1 id="ai-connection-title">连接 AI 助手</h1>
      </header>
      <div class="setup-column">
        <section class="prompt-card" aria-labelledby="connection-prompt-title">
          <h2 id="connection-prompt-title">连接提示词</h2>
          <p class="instructions">复制后，粘贴到 Codex、Claude Code、Cursor 或 VS Code 的项目对话中。</p>
          <blockquote>{{ introduction }}</blockquote>
          <div class="prompt-actions">
            <button class="copy-primary" :disabled="!prompt" @click="copy(prompt, '已复制连接提示词')">
              <ClipboardDocumentIcon aria-hidden="true" />复制连接提示词
            </button>
          </div>
        </section>
        <details class="manual-card">
          <summary>
            <CodeBracketSquareIcon aria-hidden="true" />手动配置 MCP<ChevronDownIcon
              class="chevron"
              aria-hidden="true"
            />
          </summary>
          <div class="manual-body">
            <label
              >客户端<select v-model="client">
                <option v-for="name in clients" :key="name">{{ name }}</option>
              </select></label
            >
            <div class="config-box">
              <div class="code-header">
                <code>{{ manualLocation }}</code>
                <button :disabled="!manualConfig" @click="copy(manualConfig, '已复制 MCP 配置')">
                  <ClipboardDocumentIcon aria-hidden="true" />复制 MCP 配置
                </button>
              </div>
              <pre tabindex="0" aria-label="MCP 配置"><code>{{ manualConfig }}</code></pre>
            </div>
          </div>
        </details>
        <p v-if="error" role="alert">{{ error }} <button @click="retry++">重试</button></p>
        <p v-if="notice" class="feedback" role="status"><CheckIcon aria-hidden="true" />{{ notice }}</p>
        <label v-if="manualCopy" class="copy-fallback"
          >请手动复制<textarea ref="copyField" readonly :value="manualCopy" rows="5"></textarea>
        </label>
      </div>
      <aside class="project-panel" aria-label="项目与权限">
        <h2><FolderIcon aria-hidden="true" />当前项目</h2>
        <strong>{{ project.name }}</strong>
        <code class="directory">{{ project.directory }}</code>
        <hr />
        <h2><ShieldCheckIcon aria-hidden="true" />助手权限</h2>
        <p>{{ readOnly ? '只读访问' : '读写项目内容' }}</p>
        <p v-if="!readOnly" class="scope-note">可读取未保存的草稿</p>
        <ElCheckbox v-if="!readOnly" v-model="execute">允许运行测试、演示对战和打包</ElCheckbox>
        <p v-if="contextError" role="alert">草稿同步失败：{{ contextError }}</p>
      </aside>
    </div>
  </section>
</template>
<style scoped>
.connection-page {
  background: var(--author-bg);
}
.connection-layout {
  max-width: 1020px;
  margin: 0 auto;
  padding-block: clamp(24px, 5vh, 56px);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(225px, 0.43fr);
  gap: 22px 28px;
  align-items: start;
}
.connection-header,
h2,
summary,
.code-header,
.feedback,
button {
  display: flex;
  align-items: center;
  gap: 9px;
}
.connection-header {
  grid-column: 1 / -1;
  gap: 14px;
}
.assistant-icon {
  color: var(--author-accent);
  background: color-mix(in srgb, var(--author-accent) 11%, var(--author-panel));
  border: 1px solid color-mix(in srgb, var(--author-accent) 22%, var(--author-border));
  border-radius: 14px;
  padding: 11px;
}
svg {
  width: 18px;
  height: 18px;
  flex: none;
}
.assistant-icon svg {
  display: block;
  width: 26px;
  height: 26px;
}
h1,
h2,
p,
blockquote {
  margin: 0;
}
h1 {
  font-size: clamp(23px, 3vw, 30px);
  line-height: 1.25;
}
h2 {
  font-size: 18px;
  font-weight: 650;
}
.setup-column {
  display: grid;
  gap: 14px;
  min-width: 0;
}
.prompt-card,
.manual-card,
.project-panel {
  min-width: 0;
  background: var(--author-panel);
  border: 1px solid var(--author-border);
  border-radius: 12px;
}
.prompt-card,
.project-panel {
  padding: clamp(18px, 2.4vw, 28px);
}
.instructions,
.scope-note,
.directory,
.code-header {
  color: var(--author-muted);
}
.instructions {
  line-height: 1.65;
  margin-top: 6px;
}
blockquote {
  margin: 20px 0;
  padding: 14px 18px;
  line-height: 1.8;
  overflow-wrap: anywhere;
  background: var(--author-bg);
  border-inline-start: 3px solid var(--author-accent);
  border-radius: 0 6px 6px 0;
}
button {
  cursor: pointer;
  font: inherit;
  gap: 6px;
}
.copy-primary {
  padding: 9px 14px;
  font-weight: 600;
  border: 0;
  border-radius: 8px;
  color: var(--author-on-accent);
  background: var(--author-accent);
}
.copy-primary:hover:not(:disabled) {
  background: var(--author-accent-hover);
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
summary {
  padding: 15px 20px;
  list-style: none;
  cursor: pointer;
  font-weight: 600;
}
summary::-webkit-details-marker {
  display: none;
}
summary svg,
.project-panel svg {
  color: var(--author-muted);
}
.chevron {
  margin-inline-start: auto;
  width: 15px;
}
details[open] .chevron {
  transform: rotate(180deg);
}
.manual-body {
  padding: 0 20px 18px;
}
.manual-body label {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
select {
  color: inherit;
  font: inherit;
  background: var(--author-panel);
  border: 1px solid var(--author-border);
  border-radius: 6px;
  padding: 5px;
}
.config-box {
  overflow: hidden;
  border: 1px solid var(--author-border);
  border-radius: 8px;
  background: var(--author-bg);
}
.code-header {
  justify-content: space-between;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--author-border);
  padding: 6px 12px;
  font-size: 12px;
}
.code-header button {
  background: transparent;
  color: var(--author-accent);
  border: 0;
  padding: 5px 0;
}
pre {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 12px;
  font-size: 12px;
}
.project-panel h2 {
  font-size: 14px;
  margin-bottom: 14px;
}
.project-panel strong {
  display: block;
  font-size: 17px;
  overflow-wrap: anywhere;
}
.directory {
  display: block;
  overflow-wrap: anywhere;
  font-size: 12px;
  margin-top: 6px;
}
.project-panel hr {
  border: 0;
  border-top: 1px solid var(--author-border);
  margin: 20px 0;
}
.scope-note {
  margin: 4px 0 8px;
  font-size: 13px;
}
.project-panel :deep(.el-checkbox) {
  height: auto;
  align-items: baseline;
  white-space: normal;
}
.project-panel :deep(.el-checkbox__label) {
  line-height: 1.5;
}
.feedback {
  font-size: 13px;
  color: var(--author-accent);
}
[role='alert'] {
  color: var(--author-danger);
}
.copy-fallback textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 6px;
}
@media (max-width: 760px) {
  .connection-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
}
</style>
