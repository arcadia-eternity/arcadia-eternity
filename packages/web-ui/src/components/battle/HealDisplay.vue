<script setup lang="ts">
import { computed } from 'vue'
import { useBattleViewStore } from '@/stores/battleView'

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

// 使用store获取缩放比例
const battleViewStore = useBattleViewStore()
</script>

<template>
  <div
    class="font-sans font-bold subpixel-antialiased text-5xl"
    :style="{
      color: '#a3e635',
      textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 5px rgba(0, 0, 0, 0.3)',
      transform: `scale(${battleViewStore.scale})`,
      transformOrigin: 'center center',
    }"
  >
    {{ displayText }}
  </div>
</template>

<style scoped></style>
