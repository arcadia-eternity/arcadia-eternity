<script setup lang="ts">
import { watch } from 'vue'
import { useUncachedResource } from '@/composition/useUncachedResource'
const props = withDefaults(defineProps<{ src: string; uncached?: boolean }>(), { uncached: true })
const emit = defineEmits<{ error: [error: Error] }>()
const { url, error } = useUncachedResource(
  () => props.src,
  () => props.uncached,
)
watch(error, value => {
  if (value) emit('error', value)
})
</script>
<template><img v-if="url" :src="url" @error="emit('error', new Error('图片解码失败'))" /></template>
