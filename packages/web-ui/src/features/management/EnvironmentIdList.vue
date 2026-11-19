<script setup lang="ts">
import { computed, ref } from 'vue'
import { matchingReferences, type ReferenceOption } from './environmentReferences'
import { ElInputTag, ElOption, ElSelect } from 'element-plus'

const props = defineProps<{
  modelValue?: string[]
  placeholder?: string
  options?: ReferenceOption[]
}>()
const emit = defineEmits<{ 'update:modelValue': [items: string[]] }>()
const delimiter = /[，,\s]+/u
const query = ref('')
const matches = computed(() => matchingReferences(props.options ?? [], query.value))
const custom = computed(() => {
  const value = query.value.trim()
  return value &&
    value.split(delimiter).every(id => /^[a-zA-Z0-9_./:-]+$/.test(id)) &&
    !props.options?.some(option => option.value === value)
    ? value
    : ''
})
function update(items: string[] = []) {
  emit('update:modelValue', [...new Set(items.flatMap(value => value.split(delimiter)).filter(Boolean))])
  query.value = ''
}
function finishInput() {
  // A search fragment should never become a content ID when leaving the field.
  const exact = props.options?.find(option => option.value === query.value.trim())
  const id = exact?.value ?? (!matches.value.length ? custom.value : '')
  if (id) update([...(props.modelValue ?? []), id])
  query.value = ''
}
</script>

<template>
  <ElSelect
    v-if="options?.length"
    multiple
    default-first-option
    filterable
    :reserve-keyword="false"
    :model-value="modelValue ?? []"
    :placeholder="placeholder || '搜索名称或 ID'"
    :filter-method="text => (query = text)"
    @update:model-value="update"
    @blur="finishInput"
    @visible-change="
      open => {
        if (open) query = ''
      }
    "
  >
    <ElOption v-for="item in matches" :key="item.value" :value="item.value" :label="item.label" />
    <ElOption v-if="custom" :value="custom" :label="custom">使用 {{ custom }}</ElOption>
  </ElSelect>
  <ElInputTag
    v-else
    :model-value="modelValue ?? []"
    :delimiter="delimiter"
    save-on-blur
    :placeholder="placeholder"
    @update:model-value="update"
  />
</template>
