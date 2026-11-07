<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { createSwfPlayer } from '@/services/swf/adapter'
import type { SwfPlayer } from '@/services/swf/protocol'
import { readResourceBytes } from '@/services/resourceTransport'
const props = defineProps<{ file: string; bytes: Uint8Array }>()
const host = ref<HTMLElement>(),
  url = ref(''),
  error = ref(''),
  states = ref<string[]>([])
let player: SwfPlayer | undefined,
  generation = 0,
  controller: AbortController | undefined
const containerUrl = new URL(
  '../../../node_modules/seer2-pet-animator/dist/assets/0a23df2694577cca.swf',
  import.meta.url,
).href
function clear() {
  generation++
  controller?.abort()
  player?.dispose()
  player = undefined
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
  states.value = []
}
watch(
  () => [props.file, props.bytes, host.value],
  async () => {
    clear()
    error.value = ''
    const epoch = generation
    const extension = props.file.split('.').at(-1)?.toLowerCase()
    if (extension === 'swf' && host.value) {
      try {
        controller = new AbortController()
        const container = await readResourceBytes(containerUrl, {
          signal: controller.signal,
          maxBytes: 16 * 1024 * 1024,
        })
        if (epoch !== generation) return
        player = createSwfPlayer(host.value, event => {
          if (event.type === 'error') error.value = event.message
        })
        states.value = await player.load({
          container: container.slice().buffer as ArrayBuffer,
          movie: new Uint8Array(props.bytes).buffer,
        })
        await player.setState('待机')
      } catch (cause) {
        if (epoch === generation) error.value = String(cause)
      }
    } else {
      const mime = (
        {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          mp3: 'audio/mpeg',
          ogg: 'audio/ogg',
        } as Record<string, string>
      )[extension ?? '']
      if (mime) url.value = URL.createObjectURL(new Blob([new Uint8Array(props.bytes)], { type: mime }))
    }
  },
  { immediate: true, flush: 'post' },
)
onBeforeUnmount(clear)
</script>
<template>
  <div class="media-preview">
    <div v-if="file.toLowerCase().endsWith('.swf')" ref="host" class="swf" />
    <audio v-else-if="/\.(mp3|ogg)$/i.test(file) && url" :src="url" controls /><img
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
