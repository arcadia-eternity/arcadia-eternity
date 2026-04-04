<script setup lang="ts">
import { Element } from '@arcadia-eternity/const'
import { computed } from 'vue'

const props = defineProps<{
  element: Element
  size?: number
}>()

const elementIndexMap: Record<Element, number> = {
  [Element.Normal]: 1,
  [Element.Grass]: 2,
  [Element.Water]: 3,
  [Element.Fire]: 4,
  [Element.Wind]: 5,
  [Element.Bug]: 6,
  [Element.Flying]: 7,
  [Element.Electric]: 8,
  [Element.Ground]: 9,
  [Element.Ice]: 10,
  [Element.Psychic]: 11,
  [Element.Light]: 12,
  [Element.Shadow]: 13,
  [Element.Fighting]: 14,
  [Element.Dragon]: 15,
  [Element.Desert]: 16,
  [Element.Mystery]: 17,
  [Element.Trait]: 18,
  [Element.Ancient]: 19,
  [Element.Divine]: 20,
  [Element.Miracle]: 21,
  [Element.Holy]: 22,
  [Element.ElfKing]: 19,
}

const iconUrl = computed(() => {
  const index = elementIndexMap[props.element]
  return `https://seer2-resource.yuuinih.com/png/petElementIcon/${index}.png`
})

const iconSizeStyle = computed(() => {
  const size = Number.isFinite(props.size) && (props.size ?? 0) > 0 ? Number(props.size) : 24
  return {
    width: `${size}px`,
    height: `${size}px`,
    minHeight: `${size}px`,
  }
})
</script>

<template>
  <img :src="iconUrl" :alt="element" class="element-icon" :style="iconSizeStyle" />
</template>

<style scoped>
.element-icon {
  display: inline-block;
  object-fit: contain;
}
</style>
