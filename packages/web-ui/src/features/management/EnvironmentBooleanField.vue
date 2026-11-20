<script setup lang="ts">
import { ElFormItem, ElRadioButton, ElRadioGroup } from 'element-plus'
import 'element-plus/theme-chalk/el-radio-group.css'
import 'element-plus/theme-chalk/el-radio-button.css'

defineProps<{ label: string; inherited?: boolean; modelValue?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean | undefined] }>()
</script>

<template>
  <ElFormItem :label="label">
    <ElRadioGroup
      :aria-label="label"
      :model-value="modelValue ?? 'inherit'"
      @update:model-value="value => emit('update:modelValue', typeof value === 'boolean' ? value : undefined)"
    >
      <ElRadioButton value="inherit">{{
        inherited === undefined ? '继承' : inherited ? '继承（开）' : '继承（关）'
      }}</ElRadioButton>
      <ElRadioButton :value="true">开启</ElRadioButton>
      <ElRadioButton :value="false">关闭</ElRadioButton>
    </ElRadioGroup>
  </ElFormItem>
</template>
