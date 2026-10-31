<script setup lang="ts">
import { computed, ref } from 'vue'
import { equal } from './fields'
import { fieldLabel, showValue } from './catalog'
import { parseProposals, type AssistantContext, type AssistantProposal, type ReviewedProposal } from './assistant'
const props = defineProps<{
  entries: { key: string; label: string }[]
  initialKeys: string[]
  context?: AssistantContext
  proposals: ReviewedProposal[]
  labels: Record<string, string>
  projectId: string
  value: (proposal: AssistantProposal) => unknown
  apply: (proposal: AssistantProposal) => void
}>()
const emit = defineEmits<{
  prepare: [options: { keys: string[]; related: boolean; drafts: boolean; request: string }]
  'update:proposals': [value: ReviewedProposal[]]
}>()
const keys = ref(
    props.context?.objects.filter(row => row.access === 'editable').map(row => row.key) ?? [...props.initialKeys],
  ),
  related = ref(props.context?.objects.some(row => row.access === 'reference-only') ?? false),
  drafts = ref(props.context?.includesDrafts ?? true),
  request = ref(props.context?.request ?? ''),
  error = ref(''),
  notice = ref('')
const proposals = computed({
  get: () => props.proposals,
  set: (value: ReviewedProposal[]) => emit('update:proposals', value),
})
function finish(item: ReviewedProposal) {
  proposals.value = proposals.value.map(value => (value === item ? { ...value, done: true } : value))
}
function prepare() {
  proposals.value = []
  emit('prepare', { keys: keys.value, related: related.value, drafts: drafts.value, request: request.value })
}
async function copyContext() {
  try {
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          ...props.context,
          reply: {
            baseSnapshotId: props.context?.snapshotId,
            proposals: [
              {
                key: 'object.key',
                target: 'record or locale',
                language: 'locale target only',
                path: ['field'],
                before: 'snapshot value',
                after: 'suggested value',
              },
            ],
          },
        },
        null,
        2,
      ),
    )
    notice.value = '已复制所选内容，尚未发送给任何外部工具。'
  } catch {
    error.value = '无法复制，请在工具上下文中手动复制。'
  }
}
async function read(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !props.context) return
  error.value = ''
  try {
    if (file.size > 1024 * 1024) throw new Error('建议文件不能超过 1 MiB')
    proposals.value = parseProposals(await file.text(), props.context).map(value => ({ value }))
  } catch (cause) {
    error.value = String(cause)
  }
  ;(event.target as HTMLInputElement).value = ''
}
function accept(item: { value: AssistantProposal; done?: boolean }) {
  try {
    props.apply(item.value)
    finish(item)
    notice.value = '已加入草稿，请通过查看并保存写入来源。'
  } catch (cause) {
    error.value = String(cause)
  }
}
</script>
<template>
  <section class="assistant-panel">
    <h1>与外部 AI 协作</h1>
    <p>准备本次上下文，带到外部 AI；返回的建议先进入草稿。</p>
    <label
      >希望 AI 帮什么忙？<textarea
        v-model="request"
        rows="3"
        placeholder="例如：补充这些内容的英文描述，保留已有数值"
      />
    </label>
    <fieldset>
      <legend>允许修改的内容</legend>
      <label v-for="entry in entries" :key="entry.key" class="check"
        ><input v-model="keys" type="checkbox" :value="entry.key" />{{ entry.label }}</label
      >
    </fieldset>
    <label class="check"><input v-model="related" type="checkbox" />附带直接关联内容，仅供参考</label>
    <label class="check"><input v-model="drafts" type="checkbox" />包含尚未保存的草稿</label>
    <button :disabled="!keys.length" @click="prepare">准备协作内容</button>
    <template v-if="context">
      <section class="context-summary">
        <strong>本次交接范围</strong>
        <p>
          允许修改：{{
            context.objects
              .filter(row => row.access === 'editable')
              .map(row => row.label)
              .join('、')
          }}
        </p>
        <p>
          仅供参考：{{
            context.objects
              .filter(row => row.access === 'reference-only')
              .map(row => row.label)
              .join('、') || '无'
          }}
        </p>
        <small>{{ context.includesDrafts ? '包含草稿快照' : '仅已保存内容' }} · 素材不随上下文上传</small>
      </section>
      <button @click="copyContext">复制给外部 AI 的上下文</button>
      <label>导入 AI 建议文件<input type="file" accept=".json,application/json" @change="read" /></label>
      <article v-for="(item, index) in proposals" :key="index">
        <h3>
          {{ context.objects.find(row => row.key === item.value.key)?.label }} · {{ fieldLabel(item.value.path) }}
          {{ item.value.language }}
        </h3>
        <div class="values">
          <div>
            <small>当前内容</small>
            <p>{{ showValue(value(item.value), labels, projectId) }}</p>
          </div>
          <div>
            <small>AI 建议</small>
            <p>{{ showValue(item.value.after, labels, projectId) }}</p>
          </div>
        </div>
        <template v-if="!item.done"
          ><p v-if="!equal(value(item.value), item.value.before)" class="error">
            你或外部工具又修改过此字段，请比较后决定。
          </p>
          <button @click="accept(item)">
            {{ equal(value(item.value), item.value.before) ? '采用到草稿' : '用建议替换当前值' }}</button
          ><button @click="finish(item)">保留当前内容</button></template
        >
        <p v-else>已处理</p>
      </article>
      <details>
        <summary>工具上下文（供 AI 与工具作者使用）</summary>
        <pre>{{ JSON.stringify(context, null, 2) }}</pre>
      </details>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>
<style scoped>
.assistant-panel {
  display: grid;
  gap: 16px;
  min-width: 0;
}
h1,
h3,
p {
  margin: 0;
}
label {
  display: grid;
  gap: 6px;
}
fieldset {
  border: 1px solid var(--author-border);
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
}
button,
textarea,
input {
  font: inherit;
  color: inherit;
}
button,
textarea {
  padding: 10px;
  border: 1px solid var(--author-border);
  background: var(--author-panel);
  border-radius: 8px;
}
button {
  width: fit-content;
}
button:disabled {
  opacity: 0.5;
}
article,
.context-summary {
  background: var(--author-panel);
  padding: 16px;
  border-radius: 10px;
}
article button {
  margin: 10px 10px 0 0;
}
.values {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}
.values > div {
  background: var(--author-soft);
  padding: 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
small,
summary {
  color: var(--author-muted);
}
.error {
  color: var(--author-danger);
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
input[type='file'] {
  max-width: 100%;
}
@media (max-width: 600px) {
  .values {
    grid-template-columns: 1fr;
  }
}
</style>
