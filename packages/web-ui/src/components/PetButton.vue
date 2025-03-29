<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import PetIcon from './PetIcon.vue'
import ElementIcon from './ElementIcon.vue'
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

function updateTooltipPosition() {
  if (!rootEl.value) return

  const rect = rootEl.value.getBoundingClientRect()
  let x, y

  if (props.position === 'left') {
    x = rect.right + 10
    y = rect.top + rect.height / 2
  } else if (props.position === 'right') {
    x = rect.left - 10
    y = rect.top + rect.height / 2
  } else {
    // bottom
    x = rect.left + rect.width / 2
    y = rect.top - 10
  }

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
        <div v-if="position === 'bottom'" class="flex items-center gap-1 text-base whitespace-nowrap mb-1 font-bold">
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
          <div
            class="absolute w-4 h-4 overflow-hidden"
            :class="{
              '-top-3 left-1/2 -translate-x-1/2': position === 'bottom',
              '-left-3 top-1/2 -translate-y-1/2': position === 'left',
              '-right-3 top-1/2 -translate-y-1/2': position === 'right',
            }"
          >
            <div
              class="w-4 h-4 bg-black/90 rotate-45 transform"
              :class="{
                'origin-bottom-left': position === 'bottom',
                'origin-top-right': position === 'left',
                'origin-top-left': position === 'right',
              }"
            ></div>
          </div>

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
        </div>
      </div>
    </teleport>
  </div>
</template>
