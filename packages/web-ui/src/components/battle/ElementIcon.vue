<script setup lang="ts">
import { Element } from '@arcadia-eternity/const'
import { computed } from 'vue'

const props = defineProps<{
  element: Element
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
  [Element.Fighting]: 12,
  [Element.Trait]: 13,
  [Element.Light]: 14,
  [Element.Mystery]: 15,
  [Element.Shadow]: 16,
  [Element.Dragon]: 17,
  [Element.Desert]: 18,
  [Element.Ancient]: 19,
  [Element.Divine]: 20,
  [Element.Miracle]: 21,
  [Element.Holy]: 22,
  [Element.ElfKing]: 23,
}

const iconUrl = computed(() => {
  const index = elementIndexMap[props.element]
  return `https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/petElementIcon/${index}.png`
})
</script>

<template>
  <img :src="iconUrl" :alt="element" class="element-icon" />
</template>

<style scoped>
.element-icon {
  /* width: 24px; */
  min-height: 24px;
  object-fit: contain;
}
</style>
