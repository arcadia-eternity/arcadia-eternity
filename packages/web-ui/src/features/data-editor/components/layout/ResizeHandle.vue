<script setup lang="ts">
/**
 * ResizeHandle - Draggable vertical divider between two resizable panels.
 *
 * Emits a `resize` event with deltaX on each mousemove during drag.
 * Handles full lifecycle: mousedown → mousemove → mouseup with proper cleanup.
 */
import { ref, onBeforeUnmount } from 'vue'

const emit = defineEmits<{
  resize: [deltaX: number]
}>()

const isDragging = ref(false)

function onMouseDown(e: MouseEvent) {
  // Only respond to primary button
  if (e.button !== 0) return
  e.preventDefault()

  isDragging.value = true
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  // Prevent text selection during drag
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  emit('resize', e.movementX)
}

function onMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

onBeforeUnmount(() => {
  // Safety cleanup: remove listeners if component unmounts mid-drag
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
})
</script>

<template>
  <div class="resize-handle" :class="{ 'is-dragging': isDragging }" @mousedown="onMouseDown" />
</template>

<style scoped>
.resize-handle {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: var(--ae-border-subtle);
  position: relative;
  transition: background 0.15s ease;
}

/* Subtle center-line accent */
.resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: transparent;
  transition: background 0.15s ease;
}

.resize-handle:hover {
  background: var(--ae-border-default);
}

.resize-handle:hover::after {
  background: var(--ae-accent-primary);
}

/* Active drag state: widen hit area and highlight */
.resize-handle.is-dragging {
  background: var(--ae-accent-primary);
}

.resize-handle.is-dragging::after {
  background: var(--ae-accent-primary);
}
</style>
