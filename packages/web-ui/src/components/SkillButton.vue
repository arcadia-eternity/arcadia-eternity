<script setup lang="ts">
import type { Category, SkillMessage } from '@test-battle/const'
import ElementIcon from './ElementIcon.vue'
import type { Element } from '@test-battle/const'
import Tooltip from './Tooltip.vue'
import MarkdownIt from 'markdown-it'
import { useGameDataStore } from '@/stores/gameData'
import i18next from 'i18next'
import { computed } from 'vue'

const gameDataStore = useGameDataStore()

const md = new MarkdownIt({
  html: true,
})

const props = defineProps<{
  skill: SkillMessage
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'click', id: string): void
}>()

const category = computed(() => i18next.t(`category.${props.skill.category}`))
const name = computed(() =>
  i18next.t(`${props.skill.baseId}.name`, {
    ns: 'skill',
  }),
)
const description = computed(() =>
  i18next.t(`${props.skill.baseId}.description`, {
    skill: props.skill,
    ns: 'skill',
  }),
)
</script>

<template>
  <div class="flex flex-wrap content-center justify-center">
    <Tooltip position="top">
      <template #trigger>
        <button
          class="group relative w-50 h-30 p-4 cursor-pointer overflow-visible disabled:opacity-75 disabled:cursor-not-allowed"
          :disabled="disabled"
          @click="emit('click', skill.id)"
        >
          <div
            class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-8 transition-all duration-300 border"
            :class="{
              'border-blue-500/30 group-hover:shadow-[0_0_10px_2px_rgba(100,200,255,0.7)] group-disabled:hover:shadow-none':
                skill.category !== 'Climax',
              'border-yellow-300 border-3 group-hover:shadow-[0_0_10px_2px_rgba(245,158,11,0.7)] group-disabled:hover:shadow-none':
                skill.category === 'Climax',
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
              <ElementIcon :element="skill.element" class="w-20 h-20 mb-4" />
              <div class="text-white text-base font-bold [text-shadow:_1px_1px_0_black]">{{ category }}</div>
            </div>

            <div class="flex flex-col w-2/3">
              <div class="text-cyan-300 text-base font-bold [text-shadow:_1px_1px_0_black]">{{ name }}</div>
              <div class="text-orange-500 text-sm font-semibold [text-shadow:_1px_1px_0_black]">
                威力 {{ skill.power }}
              </div>
              <div class="text-yellow-300 text-sm font-semibold [text-shadow:_1px_1px_0_black]">
                怒气 {{ skill.rage }}
              </div>
              <div class="text-green-300 text-sm font-semibold [text-shadow:_1px_1px_0_black]">
                命中 {{ skill.accuracy }}
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
  </div>
</template>
