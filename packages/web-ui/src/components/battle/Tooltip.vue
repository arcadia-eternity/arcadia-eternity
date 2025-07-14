<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, useTemplateRef } from 'vue'
import { Z_INDEX } from '@/constants/zIndex'

interface Props {
  position?: 'top' | 'bottom' | 'left' | 'right'
  trigger?: 'hover' | 'click' | 'focus'
  show?: boolean
  contentClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  position: 'bottom',
  trigger: 'hover',
  contentClass: '',
})

const showTooltip = ref(props.show || false)
const tooltipRef = useTemplateRef('tooltipRef')

// 偏移量，只在需要调整位置时使用
const dynamicOffset = ref({ x: 0, y: 0 })

// 检测并调整tooltip位置以防止超出视窗边界
const adjustTooltipPosition = async () => {
  if (!showTooltip.value || !tooltipRef.value) return

  await nextTick()

  const tooltip = tooltipRef.value
  const tooltipRect = tooltip.getBoundingClientRect()
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  }

  // 重置偏移量
  let offsetX = 0
  let offsetY = 0

  // 检查水平边界
  if (tooltipRect.left < 0) {
    // 左边界溢出
    offsetX = -tooltipRect.left + 8 // 留8px间距
  } else if (tooltipRect.right > viewport.width) {
    // 右边界溢出
    offsetX = viewport.width - tooltipRect.right - 8 // 留8px间距
  }

  // 检查垂直边界
  if (tooltipRect.top < 0) {
    // 上边界溢出
    offsetY = -tooltipRect.top + 8 // 留8px间距
  } else if (tooltipRect.bottom > viewport.height) {
    // 下边界溢出
    offsetY = viewport.height - tooltipRect.bottom - 8 // 留8px间距
  }

  // 只有在需要调整时才设置偏移量
  dynamicOffset.value = { x: offsetX, y: offsetY }
}

// CSS类名计算
const tooltipClasses = computed(() => {
  // 使用常量确保始终在所有战斗组件之上
  // PetSprite(5) < PetButton(45) < SkillButton(30) < BattleStatus(40) < Mark(50) < Tooltip(200)
  const baseClasses = `absolute w-max pointer-events-none z-[${Z_INDEX.TOOLTIP}]`
  const positionClasses = {
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  }
  return `${baseClasses} ${positionClasses[props.position]}`
})

// 动态样式，包含偏移量
const tooltipStyle = computed(() => {
  return {
    transform: `translate(${dynamicOffset.value.x}px, ${dynamicOffset.value.y}px)`,
  }
})

const arrowClasses = computed(() => {
  return {
    'top-0 left-1/2 -translate-x-1/2 -mt-2.5': props.position === 'bottom',
    'bottom-0 left-1/2 -translate-x-1/2 -mb-2.5': props.position === 'top',
    'right-0 top-1/2 -translate-y-1/2 -mr-2.5': props.position === 'left',
    'left-0 top-1/2 -translate-y-1/2 -ml-2.5': props.position === 'right',
  }
})

function toggleTooltip(show: boolean) {
  if (props.trigger === 'hover') {
    showTooltip.value = show
    if (show) {
      // 显示tooltip时调整位置
      nextTick(() => {
        adjustTooltipPosition()
      })
    }
  }
}

// 监听show prop的变化
watch(
  () => props.show,
  newShow => {
    if (newShow !== undefined) {
      showTooltip.value = newShow
      if (newShow) {
        nextTick(() => {
          adjustTooltipPosition()
        })
      }
    }
  },
)

// 监听窗口大小变化，重新调整位置
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (showTooltip.value) {
      adjustTooltipPosition()
    }
  })
  resizeObserver.observe(document.body)
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})
</script>

<template>
  <div class="relative inline-block" @mouseenter="toggleTooltip(true)" @mouseleave="toggleTooltip(false)">
    <slot name="trigger" />

    <!-- 直接使用CSS定位的tooltip -->
    <transition name="fade">
      <div v-show="showTooltip" ref="tooltipRef" :class="tooltipClasses" :style="tooltipStyle">
        <div
          class="relative bg-black/90 text-white p-4 rounded-xl min-w-[280px] max-w-[320px] shadow-2xl shadow-black/30 backdrop-blur-sm border border-white/10"
          :class="contentClass"
        >
          <!-- 对话框箭头 -->
          <div class="absolute w-3 h-3" :class="arrowClasses">
            <div
              class="w-full h-full bg-black/90"
              :class="{
                'clip-path-triangle-bottom': props.position === 'top',
                'clip-path-triangle-top': props.position === 'bottom',
                'clip-path-triangle-right': props.position === 'left',
                'clip-path-triangle-left': props.position === 'right',
              }"
            ></div>
          </div>

          <slot />
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.clip-path-triangle-bottom {
  clip-path: polygon(50% 100%, 0 0, 100% 0);
}
.clip-path-triangle-top {
  clip-path: polygon(50% 0%, 0 100%, 100% 100%);
}
.clip-path-triangle-right {
  clip-path: polygon(100% 50%, 0 0, 0 100%);
}
.clip-path-triangle-left {
  clip-path: polygon(0 50%, 100% 0, 100% 100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
