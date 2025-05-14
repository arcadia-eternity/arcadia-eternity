<script setup lang="ts">
import 'seer2-pet-animator'
import { ActionState } from 'seer2-pet-animator'
import type {} from 'seer2-pet-animator' //Vue Declare
import { computed, markRaw, onMounted, useTemplateRef } from 'vue'
import { useElementBounding } from '@vueuse/core'
const props = withDefaults(
  defineProps<{
    num: number
    reverse?: boolean
  }>(),
  {
    num: 999,
    reverse: false,
  },
)

const petSpriteRef = useTemplateRef('petSpriteRef')
const petRenderRef = markRaw(useTemplateRef('pet-render'))

const swfUrl = computed(() => {
  // return `https://seer2.61.com/res/pet/fight/${props.num}.swf`
  return `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-pet-preview@master/public/fight/${props.num}.swf`
})
const { width: containerWidth, height: containerHeidht } = useElementBounding(petSpriteRef)

const scale = computed(() => {
  const baseWidth = 960
  const baseHeight = 560

  const scaleX = containerWidth.value / baseWidth
  const scaleY = containerHeidht.value / baseHeight
  return Math.min(scaleX, scaleY)
})

const availableState = computed(async () => {
  return (await petRenderRef.value?.getAvailableStates()) as ActionState[]
})

const setState = async (state: ActionState) => {
  await petRenderRef.value?.setState(state)
}

const getState = async () => {
  return petRenderRef.value?.getState()
}

const handleHitEvent = (event: { detail: any }) => {
  console.debug('hit', event.detail)
  emit('hit', event.detail)
}

const handleAnimationComplete = (event: { detail: any }) => {
  console.debug('播放完毕:', event.detail)
  emit('animateComplete', event.detail)
}

const emit = defineEmits<{
  hit: [detail: any]
  animateComplete: [detail: any]
}>()
defineExpose({
  setState,
  getState,
  availableState,
})
</script>
<template>
  <div ref="petSpriteRef" class="w-full h-full overflow-visible">
    <pet-render
      class="overflow-visible pet-render"
      ref="pet-render"
      :url="swfUrl"
      :reverse="reverse"
      :scaleX="scale"
      :scaleY="scale"
      salign="TL"
      :offsetX="300"
      @hit="handleHitEvent"
      @animationComplete="handleAnimationComplete"
    />
  </div>
</template>
