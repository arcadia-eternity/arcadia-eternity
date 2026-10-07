<script setup lang="ts">
import { type SkillMessage, type AttributeModifierInfo, Category } from '@arcadia-eternity/const'
import BattleFrame from './BattleFrame.vue'
import ElementIcon from './ElementIcon.vue'
import Tooltip from './Tooltip.vue'
import ModifiedValue from './ModifiedValue.vue'
import BattleMarkInfo from './BattleMarkInfo.vue'
import { Z_INDEX } from '@/constants/zIndex'
import MarkdownIt from 'markdown-it'
import i18next from 'i18next'
import { computed, ref } from 'vue'
import { useBattleStore } from '@/stores/battle'
import { useGameDataStore } from '@/stores/gameData'
import { SkillMarkRelationService } from '@/services/skillMarkRelationService'
import { getSkillTypeEffectiveness } from '@/utils/typeEffectiveness'

const md = new MarkdownIt({
  html: true,
})

const battleStore = useBattleStore()
const gameDataStore = useGameDataStore()

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

const showDetails = ref(false)
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
  return (props.skill as SkillMessage & { _originalCategory?: string })._originalCategory || props.skill.category
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

  if (props.skill.category !== Category.Status) {
    if (effectiveness > 1) {
      // 效果拔群 - 蓝色边框
      return 'border-2 border-cyan-300 shadow-lg shadow-cyan-300/60'
    } else if (effectiveness < 1) {
      // 效果不佳 - 灰色边框
      return 'border-2 border-gray-500 shadow-lg shadow-gray-500/40'
    }
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

// 技能印记关联分析
const skillMarkRelations = computed(() => {
  if (!gameDataStore.loaded || !props.skill.baseId) return []

  const relationService = new SkillMarkRelationService(
    gameDataStore.skills.byId,
    gameDataStore.marks.byId,
    gameDataStore.effects.byId,
  )

  const analysis = relationService.analyzeSkillMarkRelations(props.skill.baseId)
  // 只显示前3个最相关的印记，避免tooltip过长
  return analysis.relatedMarks.slice(0, 3)
})
</script>

<template>
  <div class="battle-skill-slot">
    <Tooltip portal position="top" v-model:show="showDetails" :trigger="showDetails ? 'click' : 'hover'">
      <template #trigger>
        <div class="battle-skill__trigger">
          <button
            :class="[
              'battle-skill',
              { 'battle-skill--climax': originalCategory === 'Climax' },
              `z-[${Z_INDEX.SKILL_BUTTON}]`,
            ]"
            data-testid="skill-button"
            :data-skill-id="skill.id"
            :data-skill-base-id="skill.baseId"
            :disabled="disabled"
            :aria-label="`${name} · ${category} · 威力 ${skill.power} · 怒气 ${skill.rage} · 命中 ${skill.accuracy}`"
            @click="emit('click', skill.id)"
          >
            <BattleFrame :accent="originalCategory === 'Climax' ? 'gold' : 'cyan'" />
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
                <div class="text-cyan-300 text-base font-bold [text-shadow:_1px_1px_0_black] leading-tight">
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
          <button
            class="battle-skill__info"
            type="button"
            :aria-label="`${name}详情`"
            :aria-expanded="showDetails"
            @click.stop="showDetails = !showDetails"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="7" />
              <path d="M10 9v5m0-9v1" />
            </svg>
          </button>
        </div>
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

        <!-- 相关印记 -->
        <div v-if="skillMarkRelations.length > 0" class="mt-4 border-t border-gray-600 pt-3">
          <div class="space-y-2">
            <BattleMarkInfo
              v-for="relation in skillMarkRelations"
              :key="`${relation.markId}-${relation.relationType}`"
              :mark-id="relation.markId"
              :relation="relation"
              :show-description="true"
            />
          </div>
        </div>
      </div>
    </Tooltip>
  </div>
</template>

<style scoped>
.battle-skill__trigger {
  position: relative;
}
.battle-skill__info {
  position: absolute;
  right: 2px;
  top: 2px;
  width: 28px;
  height: 28px;
  color: var(--battle-muted);
  cursor: pointer;
  z-index: 40;
}
.battle-skill__info svg {
  width: 18px;
  height: 18px;
  margin: auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
}
.battle-skill__info:focus-visible {
  outline: 2px solid var(--battle-cyan);
}
.battle-skill-slot {
  width: 100%;
  min-width: 0;
}
.battle-skill-slot :deep(.relative.inline-block) {
  width: 100%;
}
.battle-skill {
  display: block;
  position: relative;
  width: 100%;
  min-height: 120px;
  padding: 10px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.12s;
}
.battle-skill:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.battle-skill:hover:not(:disabled) {
  transform: translateY(-3px);
}
.battle-skill:active:not(:disabled) {
  transform: translateY(0);
}
.battle-skill:focus-visible {
  outline: 2px solid var(--battle-cyan);
  outline-offset: 4px;
}
.battle-skill .w-14 {
  width: 36px;
  height: 36px;
}
.battle-skill .w-11 {
  width: 30px;
  height: 30px;
}
.battle-skill .text-base {
  font-size: 13px;
  color: var(--battle-text);
  padding-right: 8px;
  min-height: 32px;
  display: flex;
  align-items: center;
}
.battle-skill .text-sm {
  font-size: 12px;
}
.battle-skill .text-orange-500,
.battle-skill .text-green-300 {
  color: var(--battle-muted);
}
.battle-skill .text-yellow-300 {
  color: var(--battle-gold);
}
.battle-skill .mb-2 {
  margin-bottom: 4px;
}
.battle-skill--climax .text-base {
  color: var(--battle-gold);
}
.battle-skill--climax:not(:disabled) {
  filter: drop-shadow(0 0 4px #f4c56a20);
}
</style>
