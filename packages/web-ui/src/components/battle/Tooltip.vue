<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'

interface Props {
  position?: 'top' | 'bottom' | 'left' | 'right'
  trigger?: 'hover' | 'click' | 'focus'
  show?: boolean
  contentClass?: string
  zIndex?: number
}

const props = withDefaults(defineProps<Props>(), {
  position: 'bottom',
  trigger: 'hover',
  contentClass: '',
  zIndex: 2147483647, // 最大的32位整数
})

const showTooltip = ref(props.show || false)
const triggerRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)
const tooltipPosition = ref({ top: 0, left: 0 })

const arrowClasses = computed(() => {
  return {
    'top-0 left-1/2 -translate-x-1/2 -mt-2.5': props.position === 'bottom',
    'bottom-0 left-1/2 -translate-x-1/2 -mb-2.5': props.position === 'top',
    'right-0 top-1/2 -translate-y-1/2 -mr-2.5': props.position === 'left',
    'left-0 top-1/2 -translate-y-1/2 -ml-2.5': props.position === 'right',
  }
})

function updateTooltipPosition() {
  if (!triggerRef.value || !showTooltip.value) return

  const triggerRect = triggerRef.value.getBoundingClientRect()
  const offset = 8 // 间距

  let top = 0
  let left = 0

  switch (props.position) {
    case 'bottom':
      top = triggerRect.bottom + offset
      left = triggerRect.left + triggerRect.width / 2
      break
    case 'top':
      top = triggerRect.top - offset
      left = triggerRect.left + triggerRect.width / 2
      break
    case 'right':
      top = triggerRect.top + triggerRect.height / 2
      left = triggerRect.right + offset
      break
    case 'left':
      top = triggerRect.top + triggerRect.height / 2
      left = triggerRect.left - offset
      break
  }

  tooltipPosition.value = { top, left }
}

function toggleTooltip(show: boolean) {
  if (props.trigger === 'hover') {
    showTooltip.value = show
    if (show) {
      nextTick(() => {
        updateTooltipPosition()
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
          updateTooltipPosition()
        })
      }
    }
  },
)

function getTransform() {
  switch (props.position) {
    case 'bottom':
      return 'translateX(-50%)'
    case 'top':
      return 'translateX(-50%) translateY(-100%)'
    case 'right':
      return 'translateY(-50%)'
    case 'left':
      return 'translateX(-100%) translateY(-50%)'
    default:
      return ''
  }
}
</script>

<template>
  <div class="relative inline-block" @mouseenter="toggleTooltip(true)" @mouseleave="toggleTooltip(false)">
    <div ref="triggerRef" class="inline-block">
      <slot name="trigger" />
    </div>

    <!-- 使用 Teleport 将 tooltip 传送到 body -->
    <Teleport to="body">
      <transition name="fade">
        <div
          v-show="showTooltip"
          ref="tooltipRef"
          class="fixed w-max"
          :style="{
            top: tooltipPosition.top + 'px',
            left: tooltipPosition.left + 'px',
            zIndex: props.zIndex,
            transform: getTransform(),
          }"
        >
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
    </Teleport>
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
