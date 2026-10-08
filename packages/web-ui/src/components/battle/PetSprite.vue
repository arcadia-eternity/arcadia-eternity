<script setup lang="ts">
import 'seer2-pet-animator'
import { ActionState, type PetRendererEvent } from 'seer2-pet-animator'
import { computed, nextTick, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { asyncComputed } from '@vueuse/core'
import { petResourceCache } from '@/services/petResourceCache'

type AnimationCompleteEventDetail = PetRendererEvent['animationComplete'] extends CustomEvent<infer D> ? D : never
type HitEventDetail = PetRendererEvent['hit'] extends CustomEvent<infer D> ? D : never
const props = withDefaults(defineProps<{ num: number; swfUrl?: string; imageUrl?: string; reverse?: boolean }>(), {
  num: 999,
  swfUrl: '',
  imageUrl: '',
  reverse: false,
})
const emit = defineEmits<{ hit: [detail: HitEventDetail]; animateComplete: [detail: AnimationCompleteEventDetail] }>()
const petRenderRef = useTemplateRef('pet-render')
const inited = ref(false)
const imageFailed = ref(false)
const availableState = ref<ActionState[]>([])
const ready = ref<Promise<void>>(Promise.resolve())
const forceHttps = computed(() => window.location.protocol === 'https:')
const resolvedSwfUrl = asyncComputed(
  async () => (props.imageUrl ? '' : props.swfUrl || (props.num ? petResourceCache.getPetSwfUrl(props.num) : '')),
  '',
)
const portrait = computed(() => props.imageUrl || `https://seer2-resource.yuuinih.com/png/pet/${props.num}.png`)
let generation = 0
let resolveReady: (() => void) | undefined
let rejectReady: ((error: Error) => void) | undefined

watch(
  () => [props.num, props.swfUrl, props.imageUrl],
  () => {
    generation++
    rejectReady?.(new Error('精灵资源已切换'))
    inited.value = false
    imageFailed.value = false
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
  () => [resolvedSwfUrl.value, petRenderRef.value, props.num, props.swfUrl, props.imageUrl] as const,
  async ([url]) => {
    if (!url || props.imageUrl) return
    const current = generation
    const finish = resolveReady
    const fail = rejectReady
    await nextTick()
    const renderer = petRenderRef.value
    if (!renderer || url !== resolvedSwfUrl.value || current !== generation) return
    try {
      await renderer.updateComplete
      let states: ActionState[] = []
      for (let retry = 0; retry < 40 && current === generation; retry++) {
        states = ((await renderer.getAvailableStates()) as ActionState[]) || []
        if (states.length) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (current !== generation || renderer !== petRenderRef.value) return
      if (!states.length) throw new Error('精灵动画回调未就绪')
      availableState.value = states
      inited.value = true
      finish?.()
    } catch (error) {
      if (current === generation && renderer === petRenderRef.value) {
        fail?.(error instanceof Error ? error : new Error('精灵动画加载失败'))
      }
    }
  },
  { flush: 'post' },
)

onUnmounted(() => {
  generation++
  rejectReady?.(new Error('精灵组件已卸载'))
})
const handleImageLoad = () => {
  if (props.imageUrl) resolveReady?.()
}
const handleImageError = () => {
  imageFailed.value = true
  if (props.imageUrl) rejectReady?.(new Error('精灵图片加载失败'))
}
const setState = async (state: ActionState) => {
  if (inited.value) await petRenderRef.value?.setState(state)
}
const getState = async () => (inited.value ? petRenderRef.value?.getState() : ActionState.IDLE)
const handleHit = (event: CustomEvent<HitEventDetail>) => emit('hit', event.detail)
const handleComplete = (event: CustomEvent<AnimationCompleteEventDetail>) => emit('animateComplete', event.detail)
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
        v-if="!imageFailed"
        :key="portrait"
        :src="portrait"
        alt="精灵静态形象"
        @load="handleImageLoad"
        @error="handleImageError"
      />
      <svg v-else viewBox="0 0 180 180" aria-label="精灵形象不可用" role="img">
        <path d="M90 15 160 55v70l-70 40-70-40V55Z" fill="var(--battle-panel)" stroke="var(--battle-cyan)" />
        <path d="M65 65q25-30 50 0t-25 35v16m0 12v8" fill="none" stroke="var(--battle-cyan)" stroke-width="8" />
      </svg>
    </div>
    <pet-render
      v-if="resolvedSwfUrl"
      :key="resolvedSwfUrl"
      class="overflow-visible pet-render"
      :style="{ opacity: inited ? 1 : 0 }"
      ref="pet-render"
      :url="resolvedSwfUrl"
      :reverse="reverse"
      salign="TL"
      :offsetX="275"
      :offsetY="160"
      :scaleX="1.1"
      :scaleY="1.1"
      @hit="handleHit"
      @animationComplete="handleComplete"
      :forceHttps="forceHttps"
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
