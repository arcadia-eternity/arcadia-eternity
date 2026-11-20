<script setup lang="ts">
import { ElInput, type InputInstance } from 'element-plus'
import { computed, nextTick, ref } from 'vue'
import { descriptionValues } from '@/i18n/richDescription'
import type { ContentRow, LocaleText, SharedField } from './types'
import { sharedAt } from './fields'
import AuthorDescription, { descriptionProblem, type DescriptionMark } from './AuthorDescription'
import ChoicePicker from './ChoicePicker.vue'
const props = defineProps<{
  text: LocaleText
  fallback: LocaleText
  record: ContentRow
  language: string
  sharedFields: SharedField[]
  available: boolean
  readOnly?: boolean
  marks: DescriptionMark[]
}>()
const emit = defineEmits<{
  change: [text: LocaleText]
  external: [line?: number, column?: number]
  navigate: [kind: string, id: string]
}>()
const editor = ref<InputInstance>(),
  pickingMark = ref(false)
const locked = (field: string) => props.readOnly || !props.available || sharedAt(props.sharedFields, [field])
const variables = computed(() =>
  Object.keys(descriptionValues(props.record)).filter(
    key => !key.includes('.') && !['id', 'name', 'description'].includes(key),
  ),
)
const problem = computed(() => descriptionProblem(props.text.description ?? '', props.language))
function update(key: 'name' | 'description', value: string) {
  if (!locked(key)) emit('change', { ...props.text, [key]: value })
}
async function insert(value: string) {
  const text = props.text.description ?? '',
    start = editor.value?.textarea?.selectionStart ?? text.length,
    end = editor.value?.textarea?.selectionEnd ?? start
  update('description', text.slice(0, start) + value + text.slice(end))
  pickingMark.value = false
  await nextTick()
  editor.value?.textarea?.focus()
  editor.value?.textarea?.setSelectionRange(start + value.length, start + value.length)
}
</script>
<template>
  <section class="locale-fields">
    <header>
      <h3>名称与描述</h3>
      <small>{{ language }} · {{ text.name || text.description ? '已填写' : '尚未填写' }}</small>
    </header>
    <p v-if="!available" class="hint">
      尚未找到唯一的对应语言文件。请在外部编辑器添加或整理后继续。<button type="button" @click="emit('external')">
        打开项目
      </button>
    </p>
    <details v-if="fallback.name || fallback.description">
      <summary>默认语言参考 · {{ fallback.name || record.id }}</summary>
      <p>{{ fallback.description }}</p>
    </details>
    <label
      >显示名称<ElInput
        :model-value="text.name ?? ''"
        :disabled="locked('name')"
        :placeholder="fallback.name || record.id"
        @update:model-value="update('name', $event)"
    /></label>
    <label
      >描述<ElInput
        type="textarea"
        :autosize="{ minRows: 4, maxRows: 12 }"
        ref="editor"
        :model-value="text.description ?? ''"
        :disabled="locked('description')"
        :placeholder="fallback.description || '填写描述，可插入数值和印记引用'"
        @update:model-value="update('description', $event)"
      />
    </label>
    <details v-if="!locked('description')">
      <summary>插入数值或印记</summary>
      <div class="insert-tools">
        <button v-for="variable in variables" :key="variable" type="button" @click="insert(`{${variable}}`)">
          {{ variable }}</button
        ><button type="button" @click="pickingMark = !pickingMark">引用印记…</button>
      </div>
    </details>
    <ChoicePicker
      v-if="pickingMark"
      label="选择印记"
      :options="marks.map(mark => ({ id: mark.reference ?? mark.id, label: mark.name }))"
      @choose="id => insert(`<mark>${id}</mark>`)"
      @cancel="pickingMark = false"
    />
    <p v-if="problem" class="error" role="alert">描述格式需要修正：{{ problem }}</p>
    <p v-for="field in sharedFields" :key="JSON.stringify(field.path)" class="hint">
      {{ field.path.join('.') || '名称与描述' }} 来自共享配置 {{ field.anchor }}。<button
        type="button"
        @click="emit('external', field.line, field.column)"
      >
        打开共享定义
      </button>
    </p>
    <div class="description-preview">
      <small>玩家看到的内容 · 使用当前草稿数值预览</small><strong>{{ text.name || fallback.name || record.id }}</strong
      ><AuthorDescription
        :text="text.description ?? fallback.description ?? ''"
        :language="language"
        :context="record"
        :marks="marks"
        @mark="id => emit('navigate', 'marks', id)"
      />
    </div>
  </section>
</template>
<style scoped>
.locale-fields {
  padding: 20px;
  border: 1px solid var(--author-border, #dce4dd);
  border-radius: 12px;
  background: var(--author-panel, #fff);
  display: grid;
  gap: 14px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
h3,
p {
  margin: 0;
}
h3 {
  font-size: 16px;
  font-weight: 500;
}
label {
  display: grid;
  gap: 6px;
  font-size: 14px;
}
small,
.hint,
summary {
  font-size: 12px;
  color: var(--author-muted, #647267);
}
button {
  font: inherit;
  padding: 6px 10px;
  border: 1px solid var(--author-border, #dce4dd);
  border-radius: 8px;
  background: var(--author-bg, #f8faf8);
  color: inherit;
}
.insert-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.description-preview {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 8px;
  background: var(--author-soft, #eef3ee);
}
.error {
  color: var(--author-danger, #ae4728);
  overflow-wrap: anywhere;
}
details p {
  margin-top: 8px;
  white-space: pre-wrap;
}
</style>
