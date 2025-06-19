<script setup lang="ts">
import { computed, watch, useTemplateRef, onMounted } from 'vue'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import ModifiedValue from './ModifiedValue.vue'
import type { AttributeModifierInfo } from '@arcadia-eternity/const'
import { analyzeModifierType } from '@/utils/modifierStyles'

gsap.registerPlugin(Flip)

interface Props {
  current: number
  max: number
  rage?: number
  maxRage?: number
  reverse?: boolean
  // Modifier 信息
  currentHpModifierInfo?: AttributeModifierInfo
  maxHpModifierInfo?: AttributeModifierInfo
  rageModifierInfo?: AttributeModifierInfo
  maxRageModifierInfo?: AttributeModifierInfo
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

// Modifier 效果类型
const healthModifierType = computed(() => {
  return analyzeModifierType(props.currentHpModifierInfo, 'currentHp')
})

const maxHpModifierType = computed(() => {
  return analyzeModifierType(props.maxHpModifierInfo, 'maxHp')
})

const rageModifierType = computed(() => {
  return analyzeModifierType(props.rageModifierInfo, 'currentRage')
})

const maxRageModifierType = computed(() => {
  return analyzeModifierType(props.maxRageModifierInfo, 'maxRage')
})

// 检查是否有任何 modifier 影响
const hasHealthModifiers = computed(() => {
  return healthModifierType.value !== 'none' || maxHpModifierType.value !== 'none'
})

const hasRageModifiers = computed(() => {
  return rageModifierType.value !== 'none' || maxRageModifierType.value !== 'none'
})

// 动态样式
const healthBarStyle = computed(() => {
  const baseStyle = { backgroundColor: healthColor.value }

  if (hasHealthModifiers.value) {
    // 根据 modifier 类型添加边框效果
    const primaryType = healthModifierType.value !== 'none' ? healthModifierType.value : maxHpModifierType.value

    // 根据 modifier 类型选择边框颜色
    const borderColors = {
      buffed: 'rgba(34, 197, 94, 0.8)',
      debuffed: 'rgba(239, 68, 68, 0.8)',
      clamped: 'rgba(251, 146, 60, 0.8)',
      mixed: 'rgba(168, 85, 247, 0.8)',
      neutral: 'rgba(59, 130, 246, 0.8)',
      none: 'transparent',
    }

    return {
      ...baseStyle,
      boxShadow: `inset 0 0 0 2px ${borderColors[primaryType]}, inset 0 0 10px rgba(255, 255, 255, 0.2)`,
    }
  }

  return baseStyle
})

const rageBarStyle = computed(() => {
  const baseStyle = {
    background: `linear-gradient(to right, #ff6b00, #ffcc00)`,
  }

  if (hasRageModifiers.value) {
    // 根据 modifier 类型添加边框效果
    const primaryType = rageModifierType.value !== 'none' ? rageModifierType.value : maxRageModifierType.value

    // 根据 modifier 类型选择边框颜色
    const borderColors = {
      buffed: 'rgba(34, 197, 94, 0.8)',
      debuffed: 'rgba(239, 68, 68, 0.8)',
      clamped: 'rgba(251, 146, 60, 0.8)',
      mixed: 'rgba(168, 85, 247, 0.8)',
      neutral: 'rgba(59, 130, 246, 0.8)',
      none: 'transparent',
    }

    return {
      ...baseStyle,
      boxShadow: `inset 0 0 0 2px ${borderColors[primaryType]}, inset 0 0 10px rgba(255, 255, 255, 0.2)`,
    }
  }

  return baseStyle
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
  <div class="relative block w-full my-2 overflow-hidden" :dir="reverse ? 'rtl' : 'ltr'">
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
        class="relative h-full transition-all duration-300"
        :class="[
          reverse
            ? '[clip-path:polygon(0_0,100%_0,100%_100%,8px_100%)]'
            : '[clip-path:polygon(0_0,100%_0,calc(100%-8px)_100%,0%_100%)]',
        ]"
        :style="healthBarStyle"
      ></div>
      <span
        dir="ltr"
        class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white [text-shadow:1px_1px_1px_rgba(0,0,0,0.5)] text-xl font-bold w-full text-center pointer-events-none z-20 ltr"
      >
        <ModifiedValue :value="current" :attribute-info="currentHpModifierInfo" size="md" inline />/<ModifiedValue
          :value="max"
          :attribute-info="maxHpModifierInfo"
          size="md"
          inline
        />
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
        class="relative h-full transition-all duration-300"
        :class="[
          reverse
            ? '[clip-path:polygon(0_0,100%_0,100%_100%,8px_100%)]'
            : '[clip-path:polygon(0_0,100%_0,calc(100%-8px)_100%,0%_100%)]',
        ]"
        :style="rageBarStyle"
      ></div>
      <span
        dir="ltr"
        class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white [text-shadow:1px_1px_1px_rgba(0,0,0,0.5)] text-xl font-bold pointer-events-none z-20"
      >
        <ModifiedValue :value="rage" :attribute-info="rageModifierInfo" size="md" inline />/<ModifiedValue
          :value="maxRage"
          :attribute-info="maxRageModifierInfo"
          size="md"
          inline
        />
      </span>
    </div>
  </div>
</template>

<style scoped></style>
