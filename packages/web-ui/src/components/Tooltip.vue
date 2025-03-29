<template>
  <div class="absolute z-50 p-2 bg-white rounded shadow-lg border border-gray-200 min-w-max" :class="positionClass">
    <div v-html="content"></div>
    <div
      class="absolute w-3 h-3 bg-white transform rotate-45 border-t border-l border-gray-200"
      :class="arrowClass"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  position: {
    type: String as () => 'top' | 'bottom' | 'left' | 'right',
    default: 'bottom',
  },
  content: {
    type: String,
    required: true,
  },
})

const positionClass = computed(() => {
  switch (props.position) {
    case 'top':
      return 'bottom-full left-1/2 transform -translate-x-1/2 mb-2'
    case 'bottom':
      return 'top-full left-1/2 transform -translate-x-1/2 mt-2'
    case 'left':
      return 'right-full top-1/2 transform -translate-y-1/2 mr-2'
    case 'right':
      return 'left-full top-1/2 transform -translate-y-1/2 ml-2'
    default:
      return 'top-full left-1/2 transform -translate-x-1/2 mt-2'
  }
})

const arrowClass = computed(() => {
  switch (props.position) {
    case 'top':
      return 'bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2'
    case 'bottom':
      return 'top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2'
    case 'left':
      return 'right-0 top-1/2 transform translate-x-1/2 -translate-y-1/2'
    case 'right':
      return 'left-0 top-1/2 transform -translate-x-1/2 -translate-y-1/2'
    default:
      return 'top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2'
  }
})
</script>

<style scoped>
.text-shadow {
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
}
</style>
