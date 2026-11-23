<script setup lang="ts">
const url = 'https://battle-docs.yuuinih.com/'
const emit = defineEmits<{ error: [message: string] }>()

async function open(event: MouseEvent) {
  if (!window.arcadiaDesktop?.openServerWebsite) return
  event.preventDefault()
  try {
    await window.arcadiaDesktop.openServerWebsite({ url })
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : String(cause))
  }
}
</script>

<template>
  <a :href="url" target="_blank" rel="noopener" @click="open"><slot />创作者文档</a>
</template>
