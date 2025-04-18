<script setup lang="ts">
import { computed, ref } from 'vue'
import PetIcon from '../PetIcon.vue'
import ElementIcon from './ElementIcon.vue'
import Tooltip from './Tooltip.vue'
import type { Element, PetMessage } from '@arcadia-eternity/const'
import { useGameDataStore } from '@/stores/gameData'
import i18next from 'i18next'

const gameDataStore = useGameDataStore()

interface Props {
  pet: PetMessage

  position: 'left' | 'bottom' | 'right'
  disabled?: boolean
  isActive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  isActive: false,
})

const emit = defineEmits<{
  (e: 'click', id: string): void
}>()

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
    emit('click', props.pet.id)
  }
}
</script>

<template>
  <div class="flex flex-wrap content-center justify-center">
    <Tooltip :show="showTooltip" :position="position === 'left' ? 'right' : position === 'right' ? 'left' : 'top'">
      <template #trigger>
        <div
          class="flex flex-col items-center transition-all duration-200"
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
          <div class="pet-icon flex flex-col">
            <!-- 图标容器 -->
            <div class="relative">
              <PetIcon
                :id="gameDataStore.getSpecies(pet.speciesID)?.num ?? 0"
                :name="pet.name"
                class="size-35"
                :reverse="position === 'right'"
              />

              <!-- 元素图标 -->
              <div class="absolute -top-3 -left-3" v-if="position === 'bottom'">
                <ElementIcon :element="pet.element" class="size-15" />
              </div>
              <!-- 血条和等级容器 (绝对定位在底部) -->
              <div class="absolute bottom-0 left-0 right-0">
                <!-- 等级 -->
                <div v-if="position === 'bottom'" class="text-center mb-[-4px] z-10 relative">
                  <span class="text-yellow-200 text-sm font-bold [text-shadow:_0_0_2px_black]">Lv.{{ pet.level }}</span>
                </div>

                <!-- 血条 -->
                <div class="h-2 bg-gray-300/80 rounded-sm overflow-hidden backdrop-blur-sm">
                  <div
                    class="h-full bg-gradient-to-r from-green-400 to-green-600 transition-all duration-300"
                    :style="{ width: `${(pet.currentHp / pet.maxHp) * 100}%` }"
                  ></div>
                </div>
              </div>
            </div>

            <!-- 名字显示在血条下方 -->
            <div
              v-if="position === 'bottom'"
              class="mt-2 bg-black/80 rounded-full px-2 py-0.5 text-xs font-medium text-white text-center"
            >
              {{ pet.name }}
            </div>
          </div>
        </div>
      </template>

      <div class="mt-2 space-y-1">
        <div v-for="skill in pet.skills" :key="skill.id" class="skill">
          <span class="font-medium">{{
            i18next.t(`${skill.baseId}.name`, {
              ns: 'skill',
            })
          }}</span>
          <span class="text-sm text-gray-200">{{
            i18next.t(`${skill.baseId}.description`, {
              skill: skill,
              ns: 'skill',
            })
          }}</span>
          <div class="flex gap-2 text-xs mt-1">
            <span>怒气: {{ skill.rage }}</span>
            <span>威力: {{ skill.power }}</span>
            <span>属性: {{ skill.element }}</span>
          </div>
        </div>
      </div>
    </Tooltip>
  </div>
</template>
