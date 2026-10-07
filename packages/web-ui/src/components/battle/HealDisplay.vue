<script setup lang="ts">
import { computed } from 'vue'

// 定义属性
interface Props {
  value: number
}

const props = defineProps<Props>()

// 属性验证
if (props.value <= 0) {
  console.warn('HealDisplay: value must be greater than 0')
}

const displayText = computed(() => `+${props.value}`)
</script>

<template>
  <div
    class="battle-heal font-sans font-bold subpixel-antialiased"
    :style="{
      color: '#a3e635',
      textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 5px rgba(0, 0, 0, 0.3)',
    }"
  >
    {{ displayText }}
  </div>
</template>

<style scoped>
.battle-heal {
  font-size: 32px;
  line-height: 40px;
  white-space: nowrap;
}
</style>
