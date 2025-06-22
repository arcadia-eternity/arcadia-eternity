<script setup lang="ts">
import type { SkillMessage, AttributeModifierInfo } from '@arcadia-eternity/const'
import ElementIcon from './ElementIcon.vue'
import Tooltip from './Tooltip.vue'
import ModifiedValue from './ModifiedValue.vue'
import { Z_INDEX } from '@/constants/zIndex'
import MarkdownIt from 'markdown-it'
import i18next from 'i18next'
import { computed, ref } from 'vue'
import { analyzeModifierType } from '@/utils/modifierStyles'
import { useBattleStore } from '@/stores/battle'
import { getSkillTypeEffectiveness } from '@/utils/typeEffectiveness'

const md = new MarkdownIt({
  html: true,
})

const battleStore = useBattleStore()

const props = defineProps<{
  skill: SkillMessage
  disabled?: boolean
  // Modifier 信息
  powerModifierInfo?: AttributeModifierInfo
  accuracyModifierInfo?: AttributeModifierInfo
  rageModifierInfo?: AttributeModifierInfo
  // 属性克制倍率（可选，如果不提供则自动计算）
  typeEffectiveness?: number
}>()

const emit = defineEmits<{
  (e: 'click', id: string): void
}>()

const category = computed(() =>
  i18next.t(`category.${props.skill.category}`, {
    ns: 'battle',
  }),
)

// 获取技能的原始类别，用于UI显示逻辑（避免回忆重现技能变身时的显示问题）
const originalCategory = computed(() => {
  // 如果技能有_originalCategory属性，使用它；否则使用当前category
  return (props.skill as any)._originalCategory || props.skill.category
})
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

// Modifier 效果类型
const powerModifierType = computed(() => {
  return analyzeModifierType(props.powerModifierInfo, 'power')
})

// 计算属性相性效果（自动计算或使用传入值）
const typeEffectivenessConfig = computed(() => {
  // 如果传入了typeEffectiveness，直接使用
  if (props.typeEffectiveness !== undefined) {
    return {
      multiplier: props.typeEffectiveness,
      bgColor: props.typeEffectiveness > 1 ? 'bg-red-500/30' : props.typeEffectiveness < 1 ? 'bg-blue-900/30' : '',
      type:
        props.typeEffectiveness > 1 ? 'super-effective' : props.typeEffectiveness < 1 ? 'not-very-effective' : 'normal',
    }
  }

  // 否则自动计算
  const opponent = battleStore.opponent
  if (!opponent) return { multiplier: 1, bgColor: '', type: 'normal' }

  const opponentActivePet = battleStore.getPetById(opponent.activePet)
  if (!opponentActivePet) return { multiplier: 1, bgColor: '', type: 'normal' }

  const effectivenessConfig = getSkillTypeEffectiveness(props.skill, opponentActivePet)
  return {
    multiplier: effectivenessConfig.multiplier,
    bgColor: effectivenessConfig.bgColor,
    type: effectivenessConfig.type,
  }
})

// 属性克制效果样式
const typeEffectivenessContainerClass = computed(() => {
  const effectiveness = typeEffectivenessConfig.value.multiplier

  if (effectiveness > 1) {
    // 效果拔群 - 蓝色边框
    return 'border-2 border-cyan-300 shadow-lg shadow-cyan-300/60'
  } else if (effectiveness < 1) {
    // 效果不佳 - 灰色边框
    return 'border-2 border-gray-500 shadow-lg shadow-gray-500/40'
  }

  // 普通效果 - 无特殊样式
  return ''
})

// 属性相性文本和样式
const typeEffectivenessInfo = computed(() => {
  const effectiveness = typeEffectivenessConfig.value.multiplier

  if (effectiveness > 1) {
    return {
      text: '效果拔群',
      multiplier: `×${effectiveness}`,
      textClass: 'text-red-400 font-bold',
      bgClass: 'bg-red-500/20 border border-red-500/50',
    }
  } else if (effectiveness < 1) {
    return {
      text: '效果不佳',
      multiplier: `×${effectiveness}`,
      textClass: 'text-gray-400 font-bold',
      bgClass: 'bg-gray-500/20 border border-gray-500/50',
    }
  }

  return {
    text: '普通效果',
    multiplier: '×1',
    textClass: 'text-gray-300',
    bgClass: 'bg-gray-600/20 border border-gray-600/50',
  }
})

const accuracyModifierType = computed(() => {
  return analyzeModifierType(props.accuracyModifierInfo, 'accuracy')
})

const rageModifierType = computed(() => {
  return analyzeModifierType(props.rageModifierInfo, 'rage')
})

// 技能按钮的特殊样式
const skillButtonClasses = computed(() => {
  return [
    'group relative w-44 h-26 p-2 cursor-pointer overflow-visible disabled:opacity-75 disabled:cursor-not-allowed',
  ]
})

// 粒子效果配置
const particlesId = ref(`particles-${Math.random().toString(36).substring(2, 11)}`)
const isHovered = ref(false)

// 基础粒子配置
const baseParticlesOptions = {
  background: {
    color: {
      value: 'transparent',
    },
  },
  fpsLimit: 60,
  fullScreen: {
    enable: false,
  },
  particles: {
    color: {
      value: ['#fbbf24', '#f59e0b', '#d97706', '#92400e'],
    },
    move: {
      direction: 'none',
      enable: true,
      outModes: {
        default: 'out',
        top: 'out',
        bottom: 'out',
        left: 'out',
        right: 'out',
      },
      random: true,
      speed: { min: 0.5, max: 1.5 },
      straight: false,
    },
    number: {
      density: {
        enable: false,
      },
      value: 12,
    },
    opacity: {
      value: { min: 0.4, max: 0.8 },
      animation: {
        enable: true,
        speed: 1.2,
        minimumValue: 0.2,
      },
    },
    shape: {
      type: 'circle',
    },
    size: {
      value: { min: 1, max: 2.5 },
      animation: {
        enable: true,
        speed: 1.5,
        minimumValue: 0.5,
      },
    },
  },
  detectRetina: true,
}

// hover状态的粒子配置 - 更多、更亮、更躁动
const hoverParticlesOptions = {
  ...baseParticlesOptions,
  particles: {
    ...baseParticlesOptions.particles,
    number: {
      density: { enable: false },
      value: 20,
    },
    opacity: {
      value: { min: 0.7, max: 1.0 },
      animation: {
        enable: true,
        speed: 2.5,
        minimumValue: 0.4,
      },
    },
    size: {
      value: { min: 1.5, max: 3.5 },
      animation: {
        enable: true,
        speed: 3,
        minimumValue: 0.8,
      },
    },
    move: {
      ...baseParticlesOptions.particles.move,
      speed: { min: 1.2, max: 2.8 },
      random: true,
      outModes: {
        default: 'out',
        top: 'out',
        bottom: 'out',
        left: 'out',
        right: 'out',
      },
    },
    color: {
      value: ['#fbbf24', '#f59e0b', '#d97706', '#eab308', '#facc15'],
    },
  },
}

// 响应式粒子配置
const particlesOptions = computed(() => {
  return isHovered.value ? hoverParticlesOptions : baseParticlesOptions
})

const particlesLoaded = async () => {
  // 粒子系统加载完成
}
</script>

<template>
  <div class="flex flex-wrap content-center justify-center">
    <Tooltip position="top">
      <template #trigger>
        <button
          :class="[...skillButtonClasses, `z-[${Z_INDEX.SKILL_BUTTON}]`]"
          :disabled="disabled"
          @click="emit('click', skill.id)"
          @mouseenter="isHovered = true"
          @mouseleave="isHovered = false"
        >
          <!-- 粒子效果容器 - 围绕光效区域 -->
          <div
            v-if="originalCategory === 'Climax' && !disabled"
            class="absolute pointer-events-none overflow-visible"
            style="top: -8px; left: -8px; right: -8px; bottom: -8px"
          >
            <vue-particles
              :id="particlesId"
              :options="particlesOptions"
              @particles-loaded="particlesLoaded"
              class="w-full h-full"
            />
          </div>

          <div
            class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-8 transition-all duration-300 border"
            :class="{
              'border-blue-500/30 group-hover:shadow-[0_0_10px_2px_rgba(100,200,255,0.7)] group-disabled:hover:shadow-none':
                originalCategory !== 'Climax',
              'border-yellow-300 border-3 climax-glow-available': originalCategory === 'Climax' && !disabled,
              'border-yellow-300 border-3': originalCategory === 'Climax' && disabled,
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

          <div class="relative flex h-full pointer-events-none gap-2 px-1">
            <div class="flex flex-col items-center w-1/4 justify-center pl-2">
              <div class="relative mb-2">
                <div
                  class="w-14 h-14 flex items-center justify-center rounded-full"
                  :class="typeEffectivenessContainerClass"
                >
                  <ElementIcon :element="skill.element" class="w-11 h-11 object-contain" />
                </div>
              </div>
              <div class="text-white text-sm font-bold [text-shadow:_1px_1px_0_black] text-center leading-tight mb-1">
                {{ category }}
              </div>
            </div>

            <div class="flex flex-col w-3/4 justify-center space-y-0.5 pl-1">
              <div class="text-cyan-300 text-base font-bold [text-shadow:_1px_1px_0_black] truncate leading-tight">
                {{ name }}
              </div>
              <div class="text-orange-500 text-sm font-semibold [text-shadow:_1px_1px_0_black] leading-tight">
                {{
                  i18next.t('power', {
                    ns: 'battle',
                  })
                }}
                <ModifiedValue :value="skill.power" :attribute-info="powerModifierInfo" size="sm" inline />
              </div>
              <div class="text-yellow-300 text-sm font-semibold [text-shadow:_1px_1px_0_black] leading-tight">
                {{
                  i18next.t('rage', {
                    ns: 'battle',
                  })
                }}
                <ModifiedValue :value="skill.rage" :attribute-info="rageModifierInfo" size="sm" inline />
              </div>
              <div class="text-green-300 text-sm font-semibold [text-shadow:_1px_1px_0_black] leading-tight">
                {{
                  i18next.t('accuracy', {
                    ns: 'battle',
                  })
                }}
                <ModifiedValue :value="skill.accuracy" :attribute-info="accuracyModifierInfo" size="sm" inline />
              </div>
            </div>
          </div>
        </button>
      </template>
      <div class="prose prose-invert max-w-none">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-cyan-300 m-0">{{ name }}</h3>
          <div class="px-2 py-1 rounded text-xs" :class="typeEffectivenessInfo.bgClass">
            <span :class="typeEffectivenessInfo.textClass">
              {{ typeEffectivenessInfo.text }} {{ typeEffectivenessInfo.multiplier }}
            </span>
          </div>
        </div>
        <div v-html="md.render(description)" />

        <!-- 技能属性详情 -->
        <div class="mt-4 border-t border-gray-600 pt-3">
          <h4 class="text-yellow-300 text-sm font-medium mb-2">技能属性</h4>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-300">威力:</span>
              <ModifiedValue :value="skill.power" :attribute-info="powerModifierInfo" size="sm" inline />
            </div>
            <div class="flex justify-between">
              <span class="text-gray-300">命中:</span>
              <ModifiedValue :value="skill.accuracy" :attribute-info="accuracyModifierInfo" size="sm" inline />
            </div>
            <div class="flex justify-between">
              <span class="text-gray-300">怒气:</span>
              <ModifiedValue :value="skill.rage" :attribute-info="rageModifierInfo" size="sm" inline />
            </div>
            <div class="flex justify-between">
              <span class="text-gray-300">类别:</span>
              <span class="text-white">{{ category }}</span>
            </div>
          </div>
        </div>
      </div>
    </Tooltip>
  </div>
</template>

<style scoped>
/* Climax技能呼吸光效动画 */
@keyframes climax-breathing {
  0%,
  100% {
    box-shadow: 0 0 10px 2px rgba(245, 158, 11, 0.4);
  }
  50% {
    box-shadow: 0 0 20px 4px rgba(245, 158, 11, 0.8);
  }
}

/* 可用状态的climax技能 - 持续呼吸光效 */
.climax-glow-available {
  animation: climax-breathing 2s ease-in-out infinite;
}

/* hover状态的呼吸动画 - 更快更亮 */
@keyframes climax-breathing-hover {
  0%,
  100% {
    box-shadow: 0 0 15px 3px rgba(245, 158, 11, 0.7);
  }
  50% {
    box-shadow: 0 0 25px 5px rgba(245, 158, 11, 1);
  }
}

/* hover状态 - 保持呼吸并增强高亮 */
.group:hover .background.climax-glow-available {
  animation: climax-breathing-hover 1.5s ease-in-out infinite !important;
}
</style>
