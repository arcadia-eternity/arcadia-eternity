<script lang="ts">
import type { SwfBytes, SwfPlayer } from '@/services/swf/protocol'
export type MediaPreview = { kind: 'swf'; bytes: SwfBytes } | { kind: 'image' | 'audio'; blob: Blob }
</script>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { createSwfPlayer } from '@/services/swf/adapter'
const props = defineProps<{ file: string; media: MediaPreview }>()
const host = ref<HTMLElement>(),
  url = ref(''),
  error = ref(''),
  states = ref<string[]>([])
let player: SwfPlayer | undefined
watch(
  [() => props.media, host],
  async ([media, element], _, cleanup) => {
    url.value = ''
    error.value = ''
    states.value = []
    if (media.kind !== 'swf') {
      const address = URL.createObjectURL(media.blob)
      url.value = address
      cleanup(() => URL.revokeObjectURL(address))
      return
    }
    if (!element) return
    const current = createSwfPlayer(element, event => {
      if (player === current && event.type === 'error') error.value = event.message
    })
    player = current
    cleanup(() => {
      player = undefined
      current.dispose()
    })
    try {
      const next = await current.load(media.bytes)
      if (player !== current) return
      states.value = next
      await current.setState('待机')
    } catch (cause) {
      if (player === current) error.value = String(cause)
    }
  },
  { immediate: true, flush: 'post' },
)
</script>
<template>
  <div class="media-preview">
    <div v-if="media.kind === 'swf'" ref="host" class="swf" />
    <audio v-else-if="media.kind === 'audio' && url" :src="url" controls /><img
      v-else-if="url"
      :src="url"
      :alt="file"
      @error="error = '无法解码此图片'"
    />
    <div v-if="states.length">
      <button
        v-for="state in states"
        :key="state"
        @click="player?.setState(state).catch(cause => (error = String(cause)))"
      >
        {{ state }}
      </button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.media-preview {
  padding: 18px;
  background: var(--author-soft, #f1f5f9);
  border-radius: 10px;
}
.media-preview img {
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
}
.swf {
  height: 300px;
  width: 100%;
}
audio {
  max-width: 100%;
}
button {
  margin: 4px;
  padding: 4px 8px;
  border: 1px solid var(--author-border, #cbd5e1);
  border-radius: 4px;
  background: var(--author-panel, #f8fafc);
  color: inherit;
}
</style>
