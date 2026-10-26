<script setup lang="ts">
import { computed, ref } from 'vue'
import { officialEffectTemplates } from '@arcadia-eternity/data-pack-base/native'
import type { Json } from '@arcadia-eternity/pack-loader/native'
import type { ReferenceOption } from './content'
interface Use {
  useId: string
  definitionId: string
  params: Record<string, Json>
  invalid?: boolean
}
const props = defineProps<{
  value: Json | undefined
  kind: 'skill' | 'mark'
  references: { mark: ReferenceOption[]; skill: ReferenceOption[] }
}>()
const emit = defineEmits<{ change: [value: Json] }>()
const selected = ref('')
const templates = computed(() =>
  officialEffectTemplates.filter(item => item.definition.sourceKind === (props.kind === 'skill' ? 'skill' : 'petMark')),
)
const rawUses = computed(() => (Array.isArray(props.value) ? props.value : []))
const object = (value: Json | undefined): Record<string, Json> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const uses = computed<Use[]>(() =>
  rawUses.value.map((raw, index) => {
    const item = object(raw)
    return {
      useId: typeof item.useId === 'string' ? item.useId : `unfinished-${index}`,
      definitionId: typeof item.definitionId === 'string' ? item.definitionId : '',
      params: object(item.params),
      invalid: typeof item.useId !== 'string' || typeof item.definitionId !== 'string',
    }
  }),
)
const template = (id: string) => officialEffectTemplates.find(item => item.id === id)
function update(index: number, key: string, value: Json) {
  const next = JSON.parse(JSON.stringify(rawUses.value)) as Json[]
  const current = object(next[index])
  next[index] = { ...current, params: { ...object(current.params), [key]: value } }
  emit('change', next as unknown as Json)
}
function add() {
  const item = template(selected.value)
  if (!item) return
  emit('change', [
    ...rawUses.value,
    {
      useId: crypto.randomUUID(),
      definitionId: item.id,
      params: Object.fromEntries(Object.entries(item.fields).map(([key, field]) => [key, field.contract.default])),
    },
  ] as unknown as Json)
}
function remove(index: number) {
  emit('change', rawUses.value.filter((_, i) => i !== index) as unknown as Json)
}
function move(index: number, delta: number) {
  const next = [...rawUses.value]
  ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
  emit('change', next as unknown as Json)
}
</script>
<template>
  <section class="behavior-editor">
    <h3>效果组合</h3>
    <p>每项效果独立配置，按各自的触发时机执行；列表顺序用于相同时机的组合。</p>
    <div v-for="(use, index) in uses" :key="`${index}-${use.useId}`" class="effect-card">
      <div class="toolbar">
        <strong>{{ template(use.definitionId)?.title ?? use.definitionId }}</strong>
        <button type="button" :disabled="index === 0" aria-label="效果上移" @click="move(index, -1)">↑</button>
        <button type="button" :disabled="index === uses.length - 1" aria-label="效果下移" @click="move(index, 1)">
          ↓
        </button>
        <button type="button" @click="remove(index)">移除效果</button>
      </div>
      <p v-if="use.invalid">这项效果记录尚未完成。草稿会保留原始数据；可移除后重新选择模板。</p>
      <p>{{ template(use.definitionId)?.description }}</p>
      <div class="fields">
        <label v-for="(field, key) in template(use.definitionId)?.fields" :key="key"
          >{{ field.label }} {{ field.unit ?? '' }}
          <input
            v-if="field.contract.kind === 'number'"
            type="number"
            :value="use.params[key] ?? field.contract.default"
            :min="field.contract.minimum"
            :max="field.contract.maximum"
            :step="field.contract.integer ? 1 : 'any'"
            @input="update(index, key, Number(($event.target as HTMLInputElement).value))"
          />
          <input
            v-else-if="field.contract.kind === 'boolean'"
            type="checkbox"
            :checked="Boolean(use.params[key] ?? field.contract.default)"
            @change="update(index, key, ($event.target as HTMLInputElement).checked)"
          />
          <select
            v-else-if="field.contract.reference"
            :aria-label="field.label"
            :value="JSON.stringify(use.params[key] ?? field.contract.default)"
            @change="update(index, key, JSON.parse(($event.target as HTMLSelectElement).value))"
          >
            <option :value="JSON.stringify('')">请选择</option>
            <option
              v-for="option in references[field.contract.reference]"
              :key="JSON.stringify(option.value)"
              :value="JSON.stringify(option.value)"
            >
              {{ option.label }}
            </option>
          </select>
          <select
            v-else-if="field.contract.enum"
            :aria-label="field.label"
            :value="use.params[key] ?? field.contract.default"
            @change="update(index, key, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in field.contract.enum" :key="option">{{ option }}</option>
          </select>
          <input
            v-else
            :value="use.params[key] ?? field.contract.default"
            :maxlength="field.contract.maxLength"
            @input="update(index, key, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </div>
    <div class="toolbar">
      <label
        >添加效果<select v-model="selected" aria-label="添加效果">
          <option value="">选择效果模板</option>
          <option v-for="item in templates" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select></label
      ><button type="button" :disabled="!selected" @click="add">加入组合</button>
    </div>
  </section>
</template>
