<script setup lang="ts">
import ResourceImage from '@/components/ResourceImage.vue'
import { battleUiUrl } from '@/services/mediaLoader'
import type { Element } from '@arcadia-eternity/const'
import { computed } from 'vue'

const props = defineProps<{
  element: Element
  size?: number
}>()

const iconUrl = computed(() => battleUiUrl('element:' + props.element))

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
  <ResourceImage v-if="iconUrl" :src="iconUrl" :alt="element" class="element-icon" :style="iconSizeStyle" />
  <span v-else class="element-icon" :title="element" :style="iconSizeStyle">{{ element }}</span>
</template>

<style scoped>
.element-icon {
  display: inline-block;
  object-fit: contain;
}
</style>
