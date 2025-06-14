<script setup lang="ts">
import { computed, ref } from 'vue'
import PetIcon from '../PetIcon.vue'
import ElementIcon from './ElementIcon.vue'
import Tooltip from './Tooltip.vue'
import type { PetMessage } from '@arcadia-eternity/const'
import { useGameDataStore } from '@/stores/gameData'
import { Z_INDEX } from '@/constants/zIndex'
import i18next from 'i18next'
import MarkdownIt from 'markdown-it'

const gameDataStore = useGameDataStore()

const md = new MarkdownIt({
  html: true,
})

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
  // 侧边模式：己方（left）可以点击，敌方（right）不可点击
  // 底部模式：根据disabled状态决定
  if (props.position === 'left') {
    return !props.disabled && props.pet.currentHp > 0 // 己方侧栏：存活且不被禁用时可点击
  } else if (props.position === 'right') {
    return false // 敌方侧栏：永远不可点击
  } else {
    return !props.disabled // 底部模式：根据disabled状态
  }
})

const handleClick = () => {
  if (canClick.value) {
    emit('click', props.pet.id)
  }
}

// 计算pet是否未知
const isPetUnknown = computed(() => props.pet.isUnknown)

// 计算species信息，处理未知情况
const speciesInfo = computed(() => {
  if (isPetUnknown.value) {
    return null
  }
  try {
    return gameDataStore.getSpecies(props.pet.speciesID)
  } catch {
    return null
  }
})

// 计算pet图标ID，未知时使用占位符
const petIconId = computed(() => {
  if (isPetUnknown.value || !speciesInfo.value) {
    return 0 // 使用任意ID，因为会通过isUnknown控制显示
  }
  return speciesInfo.value.num ?? 0
})

// 计算pet名称
const petDisplayName = computed(() => {
  if (isPetUnknown.value) {
    return i18next.t('unknown_pet', { ns: 'webui' }) || '未知精灵'
  }
  return props.pet.name || i18next.t('unknown_pet', { ns: 'webui' }) || '未知精灵'
})

// 计算species名称
const speciesDisplayName = computed(() => {
  if (isPetUnknown.value || !speciesInfo.value) {
    return i18next.t('unknown_species', { ns: 'webui' }) || '未知种族'
  }
  try {
    return (
      i18next.t(`${props.pet.speciesID}.name`, { ns: 'species' }) ||
      i18next.t('unknown_species', { ns: 'webui' }) ||
      '未知种族'
    )
  } catch {
    return i18next.t('unknown_species', { ns: 'webui' }) || '未知种族'
  }
})

// 处理技能信息，包括未知技能
const processedSkills = computed(() => {
  if (isPetUnknown.value || !props.pet.skills) {
    return []
  }

  return props.pet.skills.map(skill => {
    const isSkillUnknown = skill.isUnknown

    let skillName = i18next.t('unknown_skill', { ns: 'webui' }) || '未知技能'
    let skillDescription = i18next.t('unknown_skill', { ns: 'webui' }) || '未知技能'

    if (!isSkillUnknown && skill.baseId) {
      try {
        skillName = i18next.t(`${skill.baseId}.name`, { ns: 'skill' }) || skill.baseId
      } catch {
        skillName = skill.baseId || i18next.t('unknown_skill', { ns: 'webui' }) || '未知技能'
      }

      try {
        const rawDescription =
          i18next.t(`${skill.baseId}.description`, {
            skill: skill,
            ns: 'skill',
          }) ||
          i18next.t('unknown_skill', { ns: 'webui' }) ||
          '未知技能'
        skillDescription = md.render(rawDescription)
      } catch {
        skillDescription = i18next.t('unknown_skill', { ns: 'webui' }) || '未知技能'
      }
    }

    return {
      ...skill,
      displayName: skillName,
      displayDescription: skillDescription,
      isUnknown: isSkillUnknown,
    }
  })
})
</script>

<template>
  <div class="flex flex-wrap content-center justify-center">
    <Tooltip :show="showTooltip" :position="position === 'left' ? 'right' : position === 'right' ? 'left' : 'top'">
      <template #trigger>
        <div
          class="relative flex flex-col items-center transition-all duration-200"
          :class="[
            `z-[${Z_INDEX.PET_BUTTON}]`,
            position === 'left' ? 'mr-auto' : '',
            position === 'right' ? 'ml-auto' : '',
            position === 'bottom' ? 'flex-row gap-2' : '',
            isActive ? 'ring-2 ring-yellow-400' : '',
            // 侧边模式：只有倒下时才变暗，底部模式：disabled时变暗
            position === 'left' || position === 'right'
              ? pet.currentHp <= 0
                ? 'opacity-50 grayscale'
                : ''
              : disabled
                ? 'opacity-50 grayscale'
                : '',
            // 侧边模式的己方按钮：可点击时添加hover效果和cursor
            position === 'left' && canClick ? 'hover:scale-110 cursor-pointer' : '',
            // 敌方侧栏和不可点击的按钮：默认cursor
            position === 'right' || !canClick ? 'cursor-default' : '',
          ]"
          @click="handleClick"
          @mouseenter="handleMouseEnter"
          @mouseleave="handleMouseLeave"
        >
          <div class="pet-icon flex flex-col">
            <!-- 图标容器 -->
            <div class="relative">
              <PetIcon
                :id="petIconId"
                :name="petDisplayName"
                :is-unknown="isPetUnknown || !speciesInfo"
                :class="position === 'left' || position === 'right' ? 'size-16' : 'size-35'"
                :reverse="position === 'right'"
              />

              <!-- 元素图标 -->
              <div class="absolute -top-3 -left-3" v-if="position === 'bottom'">
                <ElementIcon :element="pet.element" class="size-15" />
              </div>
              <!-- 血条和等级容器 (绝对定位在底部) -->
              <div class="absolute bottom-0 left-0 right-0">
                <!-- 等级 -->
                <div
                  v-if="position === 'bottom'"
                  class="text-center mb-[-4px] relative"
                  :class="`z-[${Z_INDEX.PET_BUTTON_LEVEL}]`"
                >
                  <span class="text-yellow-200 text-sm font-bold [text-shadow:_0_0_2px_black]">Lv.{{ pet.level }}</span>
                </div>

                <!-- 血条 -->
                <div
                  :class="position === 'left' || position === 'right' ? 'h-1' : 'h-2'"
                  class="bg-gray-300/80 rounded-sm overflow-hidden backdrop-blur-sm"
                >
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
              {{ petDisplayName }}
            </div>
          </div>
        </div>
      </template>

      <div class="space-y-3">
        <!-- Pet基本信息 -->
        <div class="border-b border-white/20 pb-2">
          <!-- 精灵名称和属性图标 -->
          <div class="flex items-center gap-2 mb-2">
            <ElementIcon v-if="!isPetUnknown" :element="pet.element" class="size-5 flex-shrink-0" />
            <h3 class="text-cyan-300 font-bold">{{ petDisplayName }}</h3>
          </div>

          <div class="text-sm text-gray-300">
            <div>{{ i18next.t('species', { ns: 'webui' }) || '种族' }}: {{ speciesDisplayName }}</div>
            <div v-if="!isPetUnknown">{{ i18next.t('level', { ns: 'webui' }) || '等级' }}: {{ pet.level }}</div>
            <div v-if="!isPetUnknown">HP: {{ pet.currentHp }}/{{ pet.maxHp }}</div>
          </div>
        </div>

        <!-- 技能信息 -->
        <div v-if="processedSkills.length > 0" class="space-y-2">
          <h4 class="text-yellow-300 font-medium">{{ i18next.t('skills', { ns: 'webui' }) || '技能' }}</h4>
          <div v-for="skill in processedSkills" :key="skill.id" class="space-y-1">
            <!-- 技能名称、属性图标和类别 -->
            <div class="flex items-center gap-2">
              <ElementIcon v-if="!skill.isUnknown" :element="skill.element" class="size-4 flex-shrink-0" />
              <div class="font-medium text-white">{{ skill.displayName }}</div>
              <span v-if="!skill.isUnknown" class="text-xs text-gray-400 ml-1">
                ({{ i18next.t(`category.${skill.category}`, { ns: 'battle' }) || skill.category }})
              </span>
            </div>

            <!-- 技能描述 -->
            <div
              v-if="!skill.isUnknown"
              class="text-sm text-gray-200 prose prose-invert prose-sm max-w-none"
              v-html="skill.displayDescription"
            />
            <div v-else class="text-sm text-gray-400">
              {{ i18next.t('unknown_skill', { ns: 'webui' }) || '未知技能' }}
            </div>

            <!-- 技能属性 -->
            <div v-if="!skill.isUnknown" class="flex gap-3 text-xs text-gray-300">
              <span>{{ i18next.t('rage', { ns: 'battle' }) || '怒气' }}: {{ skill.rage }}</span>
              <span>{{ i18next.t('power', { ns: 'battle' }) || '威力' }}: {{ skill.power }}</span>
              <span>{{ i18next.t('accuracy', { ns: 'battle' }) || '命中' }}: {{ skill.accuracy }}</span>
            </div>
          </div>
        </div>

        <!-- 未知精灵提示 -->
        <div v-if="isPetUnknown" class="text-center text-gray-400 italic">
          {{ i18next.t('unknown_pet_hint', { ns: 'webui' }) || '该精灵尚未出现过，信息未知' }}
        </div>
      </div>
    </Tooltip>
  </div>
</template>
