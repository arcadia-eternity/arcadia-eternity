<script setup lang="ts">
import { ElFormItem, ElRadioButton, ElRadioGroup } from 'element-plus'
import 'element-plus/theme-chalk/el-radio-group.css'
import 'element-plus/theme-chalk/el-radio-button.css'

defineProps<{ label: string; modelValue?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <ElFormItem :label="label">
    <ElRadioGroup
      :aria-label="label"
      :model-value="modelValue"
      @update:model-value="value => emit('update:modelValue', value === true)"
    >
      <ElRadioButton :value="true">开启</ElRadioButton>
      <ElRadioButton :value="false">关闭</ElRadioButton>
    </ElRadioGroup>
  </ElFormItem>
</template>
