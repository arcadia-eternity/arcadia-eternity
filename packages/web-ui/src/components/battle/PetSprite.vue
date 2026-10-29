<script setup lang="ts">
import { officialAssetUrl } from '@/utils/officialAssetUrl'
import { ActionState, type PetRendererEvent } from 'seer2-pet-animator'
import { computed, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { asyncComputed } from '@vueuse/core'
import { useUncachedResource } from '@/composition/useUncachedResource'
import { petResourceCache } from '@/services/petResourceCache'
import { createSwfPlayer } from '@/services/swf/adapter'
import type { SwfPlayer } from '@/services/swf/protocol'
import { readResourceBytes } from '@/services/resourceTransport'
const containerUrl = new URL(
  '../../../node_modules/seer2-pet-animator/dist/assets/0a23df2694577cca.swf',
  import.meta.url,
).href

type AnimationCompleteEventDetail = PetRendererEvent['animationComplete'] extends CustomEvent<infer D> ? D : never
type HitEventDetail = PetRendererEvent['hit'] extends CustomEvent<infer D> ? D : never
const props = withDefaults(
  defineProps<{
    num: number
    swfUrl?: string
    imageUrl?: string
    fallbackImageUrl?: string
    uncached?: boolean
    reverse?: boolean
    imageOnly?: boolean
    allowRecovery?: boolean
  }>(),
  {
    num: 999,
    swfUrl: '',
    imageUrl: '',
    fallbackImageUrl: '',
    uncached: false,
    reverse: false,
    imageOnly: false,
    allowRecovery: true,
  },
)
const emit = defineEmits<{ hit: [detail: HitEventDetail]; animateComplete: [detail: AnimationCompleteEventDetail] }>()
const petRenderRef = useTemplateRef<HTMLDivElement>('pet-render')
let player: SwfPlayer | undefined
let loadAbort: AbortController | undefined
const loadedStates = ref<ActionState[]>([])
const inited = ref(false)
const imageFailed = ref(false)
const availableState = ref<ActionState[]>([])
const ready = ref<Promise<void>>(Promise.resolve())
const originalSwfUrl = asyncComputed(
  async () =>
    props.imageOnly || props.imageUrl
      ? ''
      : props.swfUrl ||
        (props.num
          ? props.uncached
            ? petResourceCache.getRemotePetUrl(props.num)
            : petResourceCache.getPetSwfUrl(props.num)
          : ''),
  '',
)
const portrait = computed(
  () =>
    props.imageUrl ||
    props.fallbackImageUrl ||
    officialAssetUrl(`https://seer2-resource.yuuinih.com/png/pet/${props.num}.png`),
)
const { url: portraitUrl, error: portraitLoadError } = useUncachedResource(
  () => portrait.value,
  () => props.uncached,
)
const fallbackActive = ref(false)
const portraitLoaded = ref(false)
let generation = 0
let resolveReady: (() => void) | undefined
let rejectReady: ((error: Error) => void) | undefined

watch(
  () => [props.num, props.swfUrl, props.imageUrl, props.imageOnly, props.fallbackImageUrl],
  () => {
    generation++
    rejectReady?.(new Error('精灵资源已切换'))
    loadedStates.value = []
    inited.value = false
    imageFailed.value = false
    fallbackActive.value = false
    portraitLoaded.value = false
    availableState.value = []
    ready.value = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // A source can fail before the battle preparation starts awaiting it.
    void ready.value.catch(() => {})
  },
  { immediate: true, flush: 'sync' },
)

watch(
  () => [originalSwfUrl.value, petRenderRef.value, props.imageUrl, props.imageOnly] as const,
  async ([url, element]) => {
    loadAbort?.abort()
    player?.dispose()
    player = undefined
    if (!url || !element || props.imageUrl || props.imageOnly) return
    const current = generation
    const finish = resolveReady
    const fail = rejectReady
    const controller = new AbortController()
    loadAbort = controller
    try {
      const [movie, containerResponse] = await Promise.all([
        readResourceBytes(url, { signal: controller.signal, maxBytes: 16 * 1024 * 1024 }),
        fetch(containerUrl, { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' }),
      ])
      if (!containerResponse.ok) throw new Error('动画容器加载失败')
      const container = await containerResponse.arrayBuffer()
      if (current !== generation || controller.signal.aborted) return
      const renderer = createSwfPlayer(element, event => {
        if (current !== generation) return
        if (event.type === 'error') {
          inited.value = false
          availableState.value = []
          fallbackActive.value = true
          return
        }
        if (!inited.value) return
        if (event.type === 'hit')
          emit('hit', { state: event.state, instanceId: event.instance } as unknown as HitEventDetail)
        if (event.type === 'complete')
          emit('animateComplete', {
            state: event.state,
            duration: event.duration,
            instanceId: event.instance,
          } as unknown as AnimationCompleteEventDetail)
      })
      player = renderer
      const states = await renderer.load({ container, movie: movie.slice().buffer as ArrayBuffer })
      if (current !== generation || player !== renderer) return
      renderer.configure({
        reverse: props.reverse,
        width: element.clientWidth || 1000,
        height: element.clientHeight || 600,
      })
      loadedStates.value = states as ActionState[]
      finish?.()
    } catch (error) {
      if (current !== generation || controller.signal.aborted) return
      if (props.fallbackImageUrl) {
        fallbackActive.value = true
        if (portraitLoaded.value) finish?.()
      } else fail?.(error instanceof Error ? error : new Error('精灵动画加载失败'))
    }
  },
  { flush: 'post' },
)
watch(
  () => props.reverse,
  reverse => {
    const element = petRenderRef.value
    if (element) player?.configure({ reverse, width: element.clientWidth || 1000, height: element.clientHeight || 600 })
  },
)

// Publishing recovered states changes the renderer used by the next skill.
// Keep that switch outside the currently running battle task.
watch(
  () => [loadedStates.value, props.allowRecovery] as const,
  ([states, allowed]) => {
    if (allowed && states.length) {
      availableState.value = states
      inited.value = true
    }
  },
  { flush: 'sync' },
)

onUnmounted(() => {
  generation++
  loadAbort?.abort()
  player?.dispose()
  rejectReady?.(new Error('精灵组件已卸载'))
})
const handleImageLoad = () => {
  portraitLoaded.value = true
  if (props.imageOnly || props.imageUrl || fallbackActive.value) resolveReady?.()
}
const handleImageError = () => {
  imageFailed.value = true
  if (props.imageOnly || props.imageUrl || fallbackActive.value) rejectReady?.(new Error('精灵图片加载失败'))
}
watch(portraitLoadError, error => {
  if (error) handleImageError()
})
const setState = async (state: ActionState) => {
  if (inited.value) await player?.setState(state)
}
const getState = async () => (inited.value ? player?.getState() : ActionState.IDLE)
defineExpose({ setState, getState, availableState, ready })
</script>
<template>
  <div class="w-full h-full overflow-visible">
    <div
      v-if="!inited"
      class="battle-pet-fallback"
      :class="{ 'battle-pet-fallback--reverse': reverse }"
      data-testid="pet-static-fallback"
    >
      <img
        v-if="!imageFailed && portraitUrl"
        :key="`${portraitUrl}-${imageOnly}`"
        :src="portraitUrl"
        alt="精灵静态形象"
        @load="handleImageLoad"
        @error="handleImageError"
      />
      <svg v-else viewBox="0 0 180 180" aria-label="精灵形象不可用" role="img">
        <path d="M90 15 160 55v70l-70 40-70-40V55Z" fill="var(--battle-panel)" stroke="var(--battle-cyan)" />
        <path d="M65 65q25-30 50 0t-25 35v16m0 12v8" fill="none" stroke="var(--battle-cyan)" stroke-width="8" />
      </svg>
    </div>
    <div
      v-if="!imageOnly && !imageUrl"
      class="overflow-visible pet-render w-full h-full"
      :style="{ opacity: inited ? 1 : 0 }"
      ref="pet-render"
    />
  </div>
</template>
<style scoped>
.battle-pet-fallback {
  position: absolute;
  left: 260px;
  top: 260px;
  width: 310px;
  height: 310px;
  display: grid;
  place-items: center;
}
.battle-pet-fallback img,
.battle-pet-fallback svg {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.battle-pet-fallback--reverse {
  left: auto;
  right: 260px;
  transform: scaleX(-1);
}
</style>
