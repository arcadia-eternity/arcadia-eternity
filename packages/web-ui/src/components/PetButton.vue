<script setup lang="ts">
import { computed, ref } from 'vue'
import PetIcon from './PetIcon.vue'
import ElementIcon from './ElementIcon.vue'
import Tooltip from './Tooltip.vue'
import type { Element } from '@test-battle/const'

interface Skill {
  name: string
  description: string
  rage: number
  power: number
  element: Element
}

interface Props {
  id: string
  name: string
  level: number
  health: number
  maxHealth: number
  element: Element
  skills: Skill[]
  position: 'left' | 'right' | 'bottom'
  disabled?: boolean
  isActive?: boolean
  num: number
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  isActive: false,
})

const emit = defineEmits<{
  (e: 'click', id: string): void
}>()

const rootEl = ref<HTMLElement | null>(null)
const showTooltip = ref(false)

function handleMouseEnter() {
  showTooltip.value = true
}

function handleMouseLeave() {
  showTooltip.value = false
}

const canClick = computed(() => {
  return !props.disabled && (props.position === 'left' || props.position === 'bottom')
})

const handleClick = () => {
  if (canClick.value) {
    emit('click', props.id)
  }
}
</script>

<template>
  <Tooltip :show="showTooltip" :position="position === 'left' ? 'right' : position === 'right' ? 'left' : 'top'">
    <template #trigger>
      <div
        ref="rootEl"
        class="relative flex flex-col items-center transition-all duration-200"
        :class="[
          position === 'left' ? 'mr-auto' : '',
          position === 'right' ? 'ml-auto opacity-70' : '',
          position === 'bottom' ? 'flex-row gap-2' : '',
          isActive ? 'ring-2 ring-yellow-400' : '',
          disabled ? 'opacity-50 grayscale' : '',
        ]"
        @click="handleClick"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
      >
        <div class="pet-icon relative">
          <PetIcon :id="num" :name="name" size="md" :reverse="position === 'right'" />

          <!-- 元素图标 -->
          <div class="absolute -top-2 -left-2" v-if="position === 'bottom'">
            <ElementIcon :element="element" size="xs" />
          </div>

          <!-- 等级HP和血条 -->
          <div class="absolute bottom-0 left-0 right-0 flex flex-col items-center">
            <!-- 等级和HP -->
            <div
              v-if="position === 'bottom'"
              class="flex items-center gap-1 text-base whitespace-nowrap mb-1 font-bold"
            >
              <span class="text-yellow-200 [text-shadow:_0_0_2px_black]">Lv.{{ level }}</span>
              <span class="text-white [text-shadow:_0_0_2px_black]">{{ health }}/{{ maxHealth }}</span>
            </div>

            <!-- 血条 -->
            <div class="w-full h-2 bg-gray-300 rounded-none overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-green-400 to-green-600 transition-all duration-300"
                :style="{ width: `${(health / maxHealth) * 100}%` }"
              ></div>
            </div>
          </div>

          <!-- 名字 -->
          <div
            v-if="position === 'bottom'"
            class="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-black rounded-full px-2 py-0.5 text-xs font-medium text-white"
          >
            {{ name }}
          </div>
        </div>
      </div>
    </template>

    <div class="mt-2 space-y-1">
      <div v-for="skill in skills" :key="skill.name" class="skill">
        <span class="font-medium">{{ skill.name }}</span>
        <span class="text-sm text-gray-200">{{ skill.description }}</span>
        <div class="flex gap-2 text-xs mt-1">
          <span>怒气: {{ skill.rage }}</span>
          <span>威力: {{ skill.power }}</span>
          <span>属性: {{ skill.element }}</span>
        </div>
      </div>
    </div>
  </Tooltip>
</template>
