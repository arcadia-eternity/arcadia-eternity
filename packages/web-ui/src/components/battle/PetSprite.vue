<script setup lang="ts">
import 'seer2-pet-animator'
import { ActionState, type PetRendererEvent } from 'seer2-pet-animator'
import { computed, nextTick, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { asyncComputed } from '@vueuse/core'
import { petResourceCache } from '@/services/petResourceCache'
import { withDeadline } from '@/composition/useBattlePreparation'

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
let fallbackTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => [props.num, props.swfUrl, props.imageUrl],
  () => {
    generation++
    resolveReady?.()
    clearTimeout(fallbackTimer)
    inited.value = false
    imageFailed.value = false
    availableState.value = []
    ready.value = new Promise<void>(resolve => {
      resolveReady = resolve
    })
    const current = generation
    fallbackTimer = setTimeout(() => {
      if (current === generation) resolveReady?.()
    }, 6500)
    if (props.imageUrl) resolveReady?.()
  },
  { immediate: true, flush: 'sync' },
)

watch(
  () => [resolvedSwfUrl.value, props.num, props.swfUrl, props.imageUrl] as const,
  async ([url]) => {
    if (!url) return
    const current = generation
    const finish = resolveReady
    await nextTick()
    const renderer = petRenderRef.value
    if (!renderer) return
    try {
      await withDeadline(renderer.updateComplete, 6000)
      let states: ActionState[] = []
      for (let retry = 0; retry < 40 && current === generation; retry++) {
        states = ((await withDeadline(renderer.getAvailableStates(), 6000)) as ActionState[]) || []
        if (states.length) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (current !== generation) return
      availableState.value = states
      inited.value = states.length > 0
    } catch {
      /* The static portrait keeps the scene usable. */
    } finally {
      if (current === generation) {
        clearTimeout(fallbackTimer)
        finish?.()
      }
    }
  },
  { flush: 'post' },
)

onUnmounted(() => {
  generation++
  clearTimeout(fallbackTimer)
  resolveReady?.()
})
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
      <img v-if="!imageFailed" :src="portrait" alt="精灵静态形象" @error="imageFailed = true" />
      <svg v-else viewBox="0 0 180 180" aria-label="精灵形象不可用" role="img">
        <path d="M90 15 160 55v70l-70 40-70-40V55Z" fill="var(--battle-panel)" stroke="var(--battle-cyan)" />
        <path d="M65 65q25-30 50 0t-25 35v16m0 12v8" fill="none" stroke="var(--battle-cyan)" stroke-width="8" />
      </svg>
    </div>
    <pet-render
      v-if="resolvedSwfUrl"
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
