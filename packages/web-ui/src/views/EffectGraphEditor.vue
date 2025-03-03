<template>
  <canvas ref="graph"></canvas>
</template>

<script setup lang="ts">
import { createEditor } from '@/graph/graph'
import { onMounted, onUnmounted, useTemplateRef, type Ref } from 'vue'
import '@comfyorg/litegraph/style.css'
const graph = useTemplateRef('graph')
onMounted(() => {
  const container = graph.value
  if (container) {
    container.width = container.clientWidth
    container.height = container.clientHeight
    createEditor(container)
  }
})
</script>

<style scoped></style>
