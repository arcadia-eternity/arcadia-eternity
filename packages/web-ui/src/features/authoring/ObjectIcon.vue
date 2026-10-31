<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { authorCall } from './types'
const props = defineProps<{ kind: string; source?: string; project?: string; revision?: number }>()
const url = ref(''),
  failed = ref(false)
let generation = 0,
  blob = ''
function release() {
  if (blob) URL.revokeObjectURL(blob)
  blob = ''
}
watch(
  () => [props.source, props.project, props.revision],
  async () => {
    const request = ++generation
    release()
    url.value = ''
    failed.value = false
    if (!props.source) return
    if (/^https?:\/\//.test(props.source)) {
      url.value = props.source
      return
    }
    try {
      const result = await authorCall<{ bytes: Uint8Array }>({ action: 'media', id: props.project, file: props.source })
      if (request !== generation) return
      const mime = /\.webp$/i.test(props.source)
        ? 'image/webp'
        : /\.jpe?g$/i.test(props.source)
          ? 'image/jpeg'
          : 'image/png'
      blob = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: mime }))
      url.value = blob
    } catch {
      if (request === generation) failed.value = true
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation++
  release()
})
</script>
<template>
  <span class="object-icon" aria-hidden="true">
    <img v-if="url && !failed" :src="url" alt="" loading="lazy" @error="failed = true" />
    <svg
      v-else
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path v-if="kind === 'skills'" d="M13 2 4 14h7l-1 8 10-13h-7z" />
      <template v-else-if="kind === 'species'">
        <ellipse cx="8" cy="7" rx="2" ry="3" />
        <ellipse cx="16" cy="7" rx="2" ry="3" />
        <path d="M7 13c-6 5-2 9 2 7 2-1 4-1 6 0 4 2 8-2 2-7-3-3-7-3-10 0Z" />
      </template>
      <path v-else d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3 5-6" />
    </svg>
  </span>
</template>
<style scoped>
.object-icon {
  display: inline-flex;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  vertical-align: middle;
  margin-right: 10px;
  color: var(--author-accent);
}
img,
svg {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
svg {
  padding: 6px;
  box-sizing: border-box;
  border-radius: 10px;
  background: var(--author-soft);
}
</style>
