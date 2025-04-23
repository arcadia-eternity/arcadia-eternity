<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import Tooltip from './Tooltip.vue'
import type { MarkMessage } from '@arcadia-eternity/const'
import { useResourceStore } from '@/stores/resource'
import i18next from 'i18next'

const md = new MarkdownIt({
  html: true,
})
const resourceStore = useResourceStore()

const props = withDefaults(
  defineProps<{
    mark: MarkMessage
  }>(),
  {},
)

const rootEl = ref<HTMLElement | null>(null)
const showTooltip = ref(false)
const stackText = computed(() => `${props.mark.stack}`)
const image = computed(
  () =>
    resourceStore.getMarkImage(props.mark.baseId) ??
    'https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png/traitMark/inc.png',
)
const name = computed(() =>
  i18next.t(`${props.mark.baseId}.name`, {
    ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
  }),
)
const description = computed(() =>
  i18next.t(`${props.mark.baseId}.description`, {
    mark: props.mark,
    ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
  }),
)
const duration = computed(() => props.mark.duration ?? -1)
const stack = computed(() => props.mark.stack ?? 1)
</script>

<template>
  <div
    ref="rootEl"
    class="relative inline-block overflow-visible transition-transform duration-200 ease-in-out hover:-translate-y-0.5 z-[100] isolate group"
    data-tooltip-parent
  >
    <Tooltip :show="showTooltip" position="bottom" v-if="rootEl">
      <template #trigger>
        <div class="relative">
          <img
            :src="image"
            class="w-12 h-12 object-contain transition-opacity duration-200 ease-in-out"
            :class="{ 'opacity-50': !mark.config.persistent && duration == 1 }"
          />
          <div
            v-if="mark.config.stackable && (mark.config.maxStacks ?? 1) > 1"
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
      <div class="text-xs text-gray-400 mt-2" v-if="!mark.config.persistent">剩余回合: {{ duration }}</div>
    </Tooltip>
  </div>
</template>
