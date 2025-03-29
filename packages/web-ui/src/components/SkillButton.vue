<script setup lang="ts">
import type { Category } from '@test-battle/const'
import ElementIcon from './ElementIcon.vue'
import type { Element } from '@test-battle/const'
import Tooltip from './Tooltip.vue'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()

defineProps<{
  element: Element
  category: Category
  power: number
  rage: number
  accuracy: number
  name: string
  description: string
  id: string
  disable?: boolean
}>()

const emit = defineEmits<{
  (e: 'click', id: string): void
}>()
</script>

<template>
  <Tooltip position="top">
    <template #trigger>
      <button
        class="group relative w-60 h-36 p-4 cursor-pointer overflow-visible disabled:opacity-75 disabled:cursor-not-allowed"
        :disabled="disable"
        @click="emit('click', id)"
      >
        <div
          class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-8 transition-all duration-300 border"
          :class="{
            'border-blue-500/30 group-hover:shadow-[0_0_10px_2px_rgba(100,200,255,0.7)] group-disabled:hover:shadow-none':
              category !== 'Climax',
            'border-yellow-300 border-3 group-hover:shadow-[0_0_10px_2px_rgba(245,158,11,0.7)] group-disabled:hover:shadow-none':
              category === 'Climax',
          }"
        >
          <div class="bg-gray-900 w-full h-10"></div>
          <div class="absolute bottom-2 right-2">
            <div class="flex">
              <div class="bg-white w-6 h-1 mt-6"></div>
              <div class="bg-white w-1 h-7"></div>
            </div>
          </div>
        </div>

        <div class="relative flex h-full pointer-events-none">
          <div class="flex flex-col items-center w-1/3">
            <ElementIcon :element="element" class="w-20 h-20 mb-4" />
            <div class="text-white text-base font-bold [text-shadow:_1px_1px_0_black]">{{ category }}</div>
          </div>

          <div class="flex flex-col w-2/3">
            <div class="text-cyan-300 text-xl font-bold [text-shadow:_1px_1px_0_black]">{{ name }}</div>
            <div class="text-orange-500 text-base font-semibold [text-shadow:_1px_1px_0_black] mt-1">
              威力 {{ power }}
            </div>
            <div class="text-yellow-300 text-base font-semibold [text-shadow:_1px_1px_0_black] mt-1">
              怒气 {{ rage }}
            </div>
            <div class="text-green-300 text-base font-semibold [text-shadow:_1px_1px_0_black] mt-1">
              命中 {{ accuracy }}
            </div>
          </div>
        </div>
      </button>
    </template>
    <div class="prose prose-invert max-w-none">
      <h3 class="text-cyan-300">{{ name }}</h3>
      <div v-html="md.render(description)" />
    </div>
  </Tooltip>
</template>
