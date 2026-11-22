<script setup lang="ts">
import { watch } from 'vue'
import { useMediaImage } from '@/composition/useMediaImage'
const props = defineProps<{ src: string }>()
const emit = defineEmits<{ error: [error: Error] }>()
const { url, error } = useMediaImage(() => props.src)
watch(error, value => {
  if (value) emit('error', value)
})
</script>
<template><img v-if="src" :src="url || undefined" @error="emit('error', new Error('图片解码失败'))" /></template>
