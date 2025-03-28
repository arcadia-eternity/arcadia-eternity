<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()

interface Props {
  image: string
  stack?: number
  duration: number
  name: string
  description: string
}

const props = withDefaults(defineProps<Props>(), {
  stack: 1,
})

const rootEl = ref<HTMLElement | null>(null)
const showTooltip = ref(false)
const stackText = computed(() => (props.stack > 1 ? `${props.stack}` : ''))

function updateTooltipPosition(e: MouseEvent) {
  if (!rootEl.value) return

  const rect = rootEl.value.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height + 10

  document.documentElement.style.setProperty('--tooltip-left', `${x}px`)
  document.documentElement.style.setProperty('--tooltip-top', `${y}px`)
}

function handleMouseEnter() {
  showTooltip.value = true
}

function handleMouseLeave() {
  showTooltip.value = false
}

onMounted(() => {
  if (rootEl.value) {
    rootEl.value.addEventListener('mouseenter', handleMouseEnter)
    rootEl.value.addEventListener('mouseleave', handleMouseLeave)
    rootEl.value.addEventListener('mousemove', updateTooltipPosition)
  }
})

onUnmounted(() => {
  if (rootEl.value) {
    rootEl.value.removeEventListener('mouseenter', handleMouseEnter)
    rootEl.value.removeEventListener('mouseleave', handleMouseLeave)
    rootEl.value.removeEventListener('mousemove', updateTooltipPosition)
  }
})
</script>

<template>
  <div
    ref="rootEl"
    class="relative inline-block overflow-visible transition-transform duration-200 ease-in-out hover:-translate-y-0.5 z-[1] isolate group"
  >
    <div class="relative">
      <img
        :src="image"
        class="w-12 h-12 object-contain transition-opacity duration-200 ease-in-out"
        :class="{ 'opacity-50': duration <= 1 }"
      />
      <div
        v-if="stack > 1"
        class="absolute -bottom-1 -right-1 text-white text-sm px-1.5 py-0.5 rounded-full leading-none [text-shadow:_0_0_2px_black]"
      >
        {{ stackText }}
      </div>
    </div>

    <!-- 悬停提示 -->
    <teleport to="body">
      <div
        class="fixed z-[9998] top-[var(--tooltip-top)] left-[var(--tooltip-left)] transform -translate-x-1/2 transition-opacity duration-300 ease-in-out pointer-events-none w-max"
        :class="{ 'opacity-100': showTooltip, 'opacity-0': !showTooltip }"
      >
        <div
          class="relative z-[9999] bg-black/90 text-white p-4 rounded-xl min-w-[280px] max-w-[320px] shadow-2xl shadow-black/30 backdrop-blur-sm border border-white/10"
        >
          <!-- 对话框箭头 -->
          <div class="absolute -top-3 left-1/2 -translate-x-1/2 w-4 h-4 overflow-hidden">
            <div class="w-4 h-4 bg-black/90 rotate-45 transform origin-bottom-left"></div>
          </div>
          <h3 class="text-lg font-bold mb-2">{{ name }}</h3>
          <div
            class="text-sm text-gray-200 leading-relaxed mb-3 prose prose-invert max-w-none"
            v-html="md.render(description)"
          ></div>
          <div class="text-xs text-gray-400 mt-2">剩余回合: {{ duration }}</div>
        </div>
      </div>
    </teleport>
  </div>
</template>
