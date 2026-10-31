<script setup lang="ts">
import { computed } from 'vue'
import type { AuthorDraft } from './drafts'
import { decisionKey } from './drafts'
import { atField, changes, sharedAt } from './fields'
import { fieldLabel, showValue } from './catalog'
const props = defineProps<{
  drafts: AuthorDraft[]
  mode: 'save' | 'conflict'
  projectId: string
  labels: Record<string, string>
  impacts: Record<string, string[]>
  choices: Record<string, string>
}>()
const emit = defineEmits<{ choose: [key: string, value: string]; external: [file?: string] }>()
const title = (draft: AuthorDraft) => props.labels[`${draft.kind}:${draft.id}`] || draft.id
const rows = computed(() =>
  props.drafts.map(draft => {
    const fields = changes(draft.base, draft.value)
    const local = new Set(fields.map(field => JSON.stringify(field.path)))
    const external = draft.latest
      ? changes(draft.base, draft.latest.value).filter(field => !local.has(JSON.stringify(field.path)))
      : []
    return { draft, fields, external }
  }),
)
</script>
<template>
  <div class="review-list">
    <article v-for="{ draft, fields, external } in rows" :key="draft.key">
      <header>
        <div>
          <h3>{{ title(draft) }}</h3>
          <small>{{
            draft.type === 'locale' ? `名称与描述 · ${draft.language}` : draft.created ? '新建内容' : '内容定义'
          }}</small>
        </div>
        <span>{{ fields.length }} 项修改</span>
      </header>
      <p v-if="impacts[draft.key]?.length" class="impact">
        这项内容被 {{ impacts[draft.key]!.join('、') }} 使用，保存后会影响这些引用。
      </p>
      <template v-if="mode === 'conflict'">
        <p v-if="!draft.latest" class="warning" role="alert">
          {{
            draft.created
              ? '新建位置或标识已被占用。草稿已保留，不会覆盖外部内容。'
              : '来源已缺失、无法解析或存在重复对象。草稿已保留，请在外部恢复或整理后继续；不会重新创建旧文件。'
          }}<button @click="emit('external')">打开项目</button>
        </p>
        <p v-else-if="draft.latest.file !== draft.file || draft.latest.index !== draft.index" class="warning">
          对象的来源位置已改变。完成核对后，草稿将使用新的位置。
        </p>
      </template>
      <section v-for="field in fields" :key="JSON.stringify(field.path)" class="change-row">
        <h4>{{ fieldLabel(field.path) }}</h4>
        <div class="values" :class="{ three: mode === 'conflict' }">
          <div>
            <small>{{ mode === 'conflict' ? '读取时' : '已保存' }}</small>
            <p>{{ showValue(field.before, labels, projectId) }}</p>
          </div>
          <div>
            <small>你的草稿</small>
            <p>{{ showValue(field.after, labels, projectId) }}</p>
          </div>
          <div v-if="mode === 'conflict'">
            <small>外部最新</small>
            <p>
              {{ draft.latest ? showValue(atField(draft.latest.value, field.path), labels, projectId) : '来源不可用' }}
            </p>
          </div>
        </div>
        <label v-if="mode === 'conflict'"
          >这一项保留哪个值？<select
            :disabled="!draft.latest"
            :value="choices[decisionKey(draft, field)] ?? ''"
            @change="emit('choose', decisionKey(draft, field), ($event.target as HTMLSelectElement).value)"
          >
            <option value="">请选择</option>
            <option value="draft" :disabled="!!draft.latest && sharedAt(draft.latest.sharedFields, field.path)">
              使用我的草稿
            </option>
            <option value="latest">使用外部最新值</option>
          </select></label
        >
        <p v-if="mode === 'conflict' && draft.latest && sharedAt(draft.latest.sharedFields, field.path)" class="hint">
          此字段现在属于共享配置，需采用外部值；共享定义请在外部修改。
        </p>
      </section>
      <details v-if="mode === 'conflict' && external.length">
        <summary>另有 {{ external.length }} 项仅在外部改变，将采用最新值</summary>
        <p v-for="field in external" :key="JSON.stringify(field.path)">
          {{ fieldLabel(field.path) }}：{{ showValue(field.before, labels, projectId) }} →
          {{ showValue(field.after, labels, projectId) }}
        </p>
      </details>
      <details class="source">
        <summary>来源详情</summary>
        <p>{{ draft.file }}</p>
        <p v-if="draft.latest && draft.latest.file !== draft.file">新的来源：{{ draft.latest.file }}</p>
        <button @click="emit('external', draft.latest?.file ?? draft.file)">在外部编辑器打开</button>
      </details>
    </article>
  </div>
</template>
<style scoped>
.review-list {
  display: grid;
  gap: 16px;
}
article {
  border: 1px solid var(--author-border);
  border-radius: 12px;
  background: var(--author-panel);
  padding: 20px;
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
h3,
h4,
p {
  margin: 0;
}
h3 {
  font-size: 17px;
  font-weight: 500;
}
h4 {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
}
small,
summary,
.hint {
  font-size: 12px;
  color: var(--author-muted);
}
.change-row {
  margin-top: 20px;
}
.values {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.values.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.values > div {
  padding: 12px;
  background: var(--author-soft);
  border-radius: 8px;
  min-width: 0;
}
.values p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-top: 5px;
  font-size: 14px;
  max-height: 240px;
  overflow: auto;
}
label {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  font-size: 13px;
}
select {
  width: min(100%, 320px);
  padding: 10px;
  background: var(--author-bg);
  color: inherit;
  border: 1px solid var(--author-border);
  border-radius: 8px;
}
button {
  font: inherit;
  color: inherit;
  background: var(--author-bg);
  border: 1px solid var(--author-border);
  border-radius: 8px;
  padding: 7px 10px;
}
details {
  margin-top: 16px;
}
details p {
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.impact {
  margin-top: 12px;
  color: var(--author-accent);
  font-size: 13px;
}
.warning {
  margin-top: 12px;
  color: var(--author-danger);
  font-size: 13px;
}
.warning button {
  margin-left: 8px;
}
@media (max-width: 680px) {
  .values,
  .values.three {
    grid-template-columns: 1fr;
  }
  article {
    padding: 14px;
  }
}
</style>
