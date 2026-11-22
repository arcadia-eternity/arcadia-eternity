<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { DraftMediaSource } from '@/services/mediaLoader'
import { useMediaImage } from '@/composition/useMediaImage'
const props = defineProps<{ kind: string; source?: DraftMediaSource }>()
const failed = ref(false),
  element = ref<HTMLElement>(),
  visible = ref(false)
let observer: IntersectionObserver | undefined
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') {
    visible.value = true
    return
  }
  observer = new IntersectionObserver(
    entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        visible.value = true
        observer?.disconnect()
      }
    },
    { rootMargin: '200px' },
  )
  observer.observe(element.value!)
})
onBeforeUnmount(() => observer?.disconnect())
const { url } = useMediaImage(
  () => props.source,
  () => visible.value,
)
watch(url, () => {
  failed.value = false
})
</script>
<template>
  <span ref="element" class="object-icon" aria-hidden="true">
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
      <template v-if="kind === 'species'">
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
