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
  return `https://seer2.61.com/res/pet/fight/${props.num}.swf`
})

const scale = computed(() => {
  const baseWidth = 960
  const baseHeight = 560
  const { width: containerWidth, height: containerHeidht } = useElementBounding(petSpriteRef)
  const scaleX = containerWidth.value / baseWidth
  const scaleY = containerHeidht.value / baseHeight
  return Math.min(scaleX, scaleY)
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
    />
  </div>
</template>
