<script setup lang="ts">
import { computed } from 'vue'

// 定义属性
interface Props {
  value: number
  type?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: '',
})

// 属性验证
if (props.value <= 0) {
  console.warn('DamageDisplay: value must be greater than 0')
}

// 计算背景图片路径
const backgroundImage = computed(() => {
  const baseUrl = 'https://seer2-resource.yuuinih.com/png/damage/'
  if (props.type === 'blue') {
    return `${baseUrl}damage_blue.png`
  } else if (props.type === 'red') {
    return `${baseUrl}damage_red.png`
  } else {
    return `${baseUrl}damage.png`
  }
})

// 将数字转换为数字数组
const digits = computed(() => {
  return props.value.toString().split('')
})

// Fit long values within the fixed canvas-sized damage graphic.
const contentStyle = computed(() => {
  const length = digits.value.length
  let scale = 1

  if (length >= 6) scale = 0.7
  else if (length >= 5) scale = 0.75
  else if (length >= 4) scale = 0.8

  return {
    transform: `scale(${scale})`,
    transformOrigin: 'center center',
    display: 'inline-block',
    width: 'auto',
  }
})
</script>

<template>
  <div class="battle-damage relative inline-block" :aria-label="`伤害 ${value}`">
    <!-- Pixel sizes are canvas coordinates; the battle shell supplies the only viewport scale. -->
    <img :src="backgroundImage" alt="damage background" class="battle-damage__background" />

    <!-- 外层容器 - 覆盖整个背景并居中内容 -->
    <div class="absolute inset-0 flex items-center justify-center overflow-visible">
      <!-- 内容容器 - 应用动态缩放 -->
      <div :style="contentStyle" class="inline-block">
        <!-- 将所有内容置于单一容器内，使用行内显示模式确保尺寸由内容决定 -->
        <div class="flex items-center justify-center whitespace-nowrap">
          <img
            src="https://seer2-resource.yuuinih.com/png/damageNumber/minus.png"
            alt="minus"
            class="battle-damage__minus object-contain"
          />

          <!-- Keep the original digit artwork. -->
          <img
            v-for="(digit, index) in digits"
            :key="index"
            :src="`https://seer2-resource.yuuinih.com/png/damageNumber/${digit}.png`"
            :alt="`digit ${digit}`"
            class="battle-damage__digit object-contain"
            :class="index > 0 ? 'battle-damage__digit--following' : ''"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.battle-damage {
  width: 720px;
  height: 320px;
}
.battle-damage__background {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.battle-damage__minus {
  height: 80px;
  width: auto;
}
.battle-damage__digit {
  height: 128px;
  width: auto;
}
.battle-damage__digit--following {
  margin-left: -16px;
}
</style>
