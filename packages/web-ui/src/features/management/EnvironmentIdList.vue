<script setup lang="ts">
import { ElInputTag } from 'element-plus'

defineProps<{ modelValue?: string[]; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [items: string[]] }>()
</script>

<template>
  <ElInputTag
    :model-value="modelValue ?? []"
    :delimiter="/[，,\s]+/u"
    save-on-blur
    :placeholder="placeholder"
    @update:model-value="
      items => emit('update:modelValue', [...new Set((items ?? []).map(item => item.trim()).filter(Boolean))])
    "
  />
</template>
