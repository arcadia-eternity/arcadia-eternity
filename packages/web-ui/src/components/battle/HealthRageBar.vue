<script setup lang="ts">
import { computed, watch, useTemplateRef, onMounted } from 'vue'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'

gsap.registerPlugin(Flip)

interface Props {
  current: number
  max: number
  rage?: number
  maxRage?: number
  reverse?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  rage: 0,
  maxRage: 100,
  reverse: false,
})

const healthValueRef = useTemplateRef('healthValueRef')
const rageValueRef = useTemplateRef('rageValueRef')

const healthPercentage = computed(() => {
  return Math.min(100, Math.max(0, (props.current / props.max) * 100))
})

const healthColor = computed(() => {
  const hue = (healthPercentage.value * 120) / 100 // 120° (green) to 0° (red)
  return `hsl(${hue}, 100%, 50%)`
})

const ragePercentage = computed(() => {
  return Math.min(100, Math.max(0, (props.rage / props.maxRage) * 100))
})

onMounted(() => {
  if (healthValueRef.value) {
    gsap.set(healthValueRef.value, {
      width: `${healthPercentage.value}%`,
      backgroundColor: healthColor.value,
    })
  }
  if (rageValueRef.value) {
    gsap.set(rageValueRef.value, {
      width: `${ragePercentage.value}%`,
    })
  }
})

watch(healthPercentage, newPercentage => {
  if (healthValueRef.value) {
    // 告诉 Flip 捕获 backgroundColor 以及默认的 transform/layout 属性
    const state = Flip.getState(healthValueRef.value, { props: 'backgroundColor' })

    // 设置最终状态
    healthValueRef.value.style.width = `${newPercentage}%`
    healthValueRef.value.style.backgroundColor = healthColor.value

    // Flip 从捕获的状态动画到当前（最终）状态
    Flip.from(state, {
      duration: 0.3,
      ease: 'power1.out',
      props: 'backgroundColor', // 明确告诉 Flip 也动画 backgroundColor
      // absolute: true, // 根据需要取消注释，如果布局复杂
    })
  }
})

watch(ragePercentage, (newPercentage, oldPercentage) => {
  if (rageValueRef.value) {
    const state = Flip.getState(rageValueRef.value)
    rageValueRef.value.style.width = `${newPercentage}%`

    Flip.from(state, {
      duration: 0.3,
      ease: 'power1.out',
      // targets: rageValueRef.value,
      // absolute: true,
    })
  }
})
</script>

<template>
  <div class="relative block w-full my-2 overflow-hidden" :class="{ 'direction-rtl': reverse }">
    <div
      class="relative w-full h-8 mb-1"
      :class="[
        reverse
          ? '[clip-path:polygon(0_0,100%_0,100%_100%,8px_100%)]'
          : '[clip-path:polygon(0_0,100%_0,calc(100%-8px)_100%,0%_100%)]',
      ]"
    >
      <div class="absolute w-full h-full bg-black"></div>
      <div
        ref="healthValueRef"
        class="relative h-full"
        :class="[
          reverse
            ? '[clip-path:polygon(0_0,100%_0,100%_100%,8px_100%)]'
            : '[clip-path:polygon(0_0,100%_0,calc(100%-8px)_100%,0%_100%)]',
        ]"
      ></div>
      <span
        class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white [text-shadow:1px_1px_1px_rgba(0,0,0,0.5)] text-xl font-bold w-full text-center pointer-events-none z-20"
      >
        {{ current }}/{{ max }}
      </span>
    </div>

    <div
      class="relative w-full h-8"
      :class="[
        reverse
          ? '[clip-path:polygon(0_0,100%_0,100%_100%,8px_100%)]'
          : '[clip-path:polygon(0_0,100%_0,calc(100%-8px)_100%,0%_100%)]',
      ]"
    >
      <div class="absolute w-full h-full bg-black"></div>
      <div
        ref="rageValueRef"
        class="relative h-full"
        :class="[
          reverse
            ? '[clip-path:polygon(0_0,100%_0,100%_100%,8px_100%)]'
            : '[clip-path:polygon(0_0,100%_0,calc(100%-8px)_100%,0%_100%)]',
        ]"
        :style="{
          background: `linear-gradient(to right, #ff6b00, #ffcc00)`,
        }"
      ></div>
      <span
        class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white [text-shadow:1px_1px_1px_rgba(0,0,0,0.5)] text-xl font-bold pointer-events-none z-20"
      >
        {{ rage }}/{{ maxRage }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Tailwind's JIT mode allows for arbitrary values which is used for clip-path */
/* We also use a custom class 'direction-rtl' for the reverse state as Tailwind doesn't have a direct 'direction' utility */
.direction-rtl {
  direction: rtl;
}
</style>
