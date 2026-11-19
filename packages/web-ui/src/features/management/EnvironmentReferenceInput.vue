<script setup lang="ts">
import { ElAutocomplete, ElInput } from 'element-plus'
import 'element-plus/theme-chalk/el-autocomplete.css'
import { matchingReferences, type ReferenceOption } from './environmentReferences'

const value = defineModel<string>({ required: true })
const props = defineProps<{ options: ReferenceOption[]; placeholder?: string }>()
</script>

<template>
  <ElAutocomplete
    v-if="options.length"
    v-model="value"
    :debounce="0"
    :fetch-suggestions="text => matchingReferences(props.options, text)"
    :placeholder="placeholder ?? '搜索名称或 ID'"
    select-when-unmatched
  >
    <template #default="{ item }">{{ item.label }}</template>
  </ElAutocomplete>
  <ElInput v-else v-model="value" :placeholder="placeholder" />
</template>
