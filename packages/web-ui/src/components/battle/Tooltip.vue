<script setup lang="ts">
import { ref, computed } from 'vue'

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
const triggerRef = ref<HTMLElement | null>(null)

const positionClasses = computed(() => {
  return {
    'top-full left-1/2 -translate-x-1/2 mt-2': props.position === 'bottom',
    'bottom-full left-1/2 -translate-x-1/2 mb-2': props.position === 'top',
    'right-full top-1/2 -translate-y-1/2 mr-2': props.position === 'left',
    'left-full top-1/2 -translate-y-1/2 ml-2': props.position === 'right',
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
  }
}
</script>

<template>
  <div class="relative inline-block" @mouseenter="toggleTooltip(true)" @mouseleave="toggleTooltip(false)">
    <div ref="triggerRef" class="inline-block">
      <slot name="trigger" />
    </div>

    <transition name="fade">
      <div v-show="showTooltip" class="absolute z-[9999] w-max" :class="positionClasses">
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
