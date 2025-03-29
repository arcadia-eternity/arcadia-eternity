<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import Tooltip from './Tooltip.vue'

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
</script>

<template>
  <div
    ref="rootEl"
    class="relative inline-block overflow-visible transition-transform duration-200 ease-in-out hover:-translate-y-0.5 z-[1] isolate group"
    data-tooltip-parent
  >
    <Tooltip :show="showTooltip" position="bottom" v-if="rootEl">
      <template #trigger>
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
      </template>

      <h3 class="text-lg font-bold mb-2">{{ name }}</h3>
      <div
        class="text-sm text-gray-200 leading-relaxed mb-3 prose prose-invert max-w-none"
        v-html="md.render(description)"
      ></div>
      <div class="text-xs text-gray-400 mt-2">剩余回合: {{ duration }}</div>
    </Tooltip>
  </div>
</template>
