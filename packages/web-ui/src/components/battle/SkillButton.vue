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
            <BattleFrame variant="skill" />
            <div v-if="originalCategory === 'Climax' && !disabled" class="battle-skill__particles" aria-hidden="true">
              <span
                v-for="particle in 8"
                :key="particle"
                class="battle-skill__particle"
                :style="{ '--particle': particle }"
              />
            </div>
            <div class="battle-skill__content" aria-hidden="true">
              <div class="battle-skill__identity">
                <div class="battle-skill__element" :class="typeEffectivenessContainerClass">
                  <ElementIcon :element="skill.element" />
                </div>
                <span class="battle-skill__category">{{ category }}</span>
              </div>
              <div class="battle-skill__data">
                <span class="battle-skill__name">{{ name }}</span>
                <div class="battle-skill__stat battle-skill__stat--power">
                  <span>{{ i18next.t('power', { ns: 'battle' }) }}</span>
                  <ModifiedValue :value="skill.power" :attribute-info="powerModifierInfo" size="sm" inline />
                </div>
                <div class="battle-skill__stat battle-skill__stat--rage">
                  <span>{{ i18next.t('rage', { ns: 'battle' }) }}</span>
                  <ModifiedValue :value="skill.rage" :attribute-info="rageModifierInfo" size="sm" inline />
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
  right: 7px;
  bottom: 4px;
  width: 20px;
  height: 20px;
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
  height: 108px;
  padding: 0;
  text-align: left;
  cursor: pointer;
  border-radius: 12px;
  transition:
    filter 0.12s,
    box-shadow 0.12s;
}
.battle-skill:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.battle-skill:hover:not(:disabled) {
  filter: brightness(1.22);
  box-shadow:
    0 0 12px #66ffff30,
    inset 0 0 12px #66ffff20;
}
.battle-skill:active:not(:disabled) {
  filter: brightness(0.9);
}
.battle-skill:focus-visible {
  outline: 2px solid var(--battle-cyan);
  outline-offset: 4px;
}
/* UI_FightSkillBrief positions mapped from the original 158 × 85 symbol. */
.battle-skill__content {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--battle-gold);
  text-shadow: 1px 1px #000;
}
.battle-skill__element {
  position: absolute;
  left: 6.96%;
  top: 15.29%;
  width: 25.32%;
  height: 47.06%;
  display: grid;
  place-items: center;
  border-radius: 50%;
}
.battle-skill__element :deep(img) {
  width: 80% !important;
  height: 80% !important;
  min-height: 0 !important;
  object-fit: contain;
}
.battle-skill__category {
  position: absolute;
  left: 5.06%;
  top: 67.06%;
  width: 29.11%;
  font-size: 14px;
  line-height: 19px;
  text-align: center;
}
.battle-skill__name {
  position: absolute;
  left: 39.87%;
  top: 15.29%;
  right: 5%;
  font-size: 16px;
  line-height: 20px;
  font-weight: 600;
  white-space: nowrap;
}
.battle-skill__stat {
  position: absolute;
  left: 39.87%;
  right: 7%;
  display: grid;
  grid-template-columns: 41.6% minmax(0, 1fr);
  align-items: center;
  font-size: 15px;
  line-height: 19px;
}
.battle-skill__stat--power {
  top: 40.59%;
}
.battle-skill__stat--rage {
  top: 66.47%;
}
.battle-skill__stat :deep(span) {
  font-size: inherit;
  line-height: inherit;
}
.battle-skill--climax {
  box-shadow:
    0 0 9px #38bdf870,
    inset 0 0 12px #38bdf830;
}
.battle-skill--climax:not(:disabled) {
  animation: climax-blue-glow 2.4s ease-in-out infinite;
}
.battle-skill--climax .battle-skill__name {
  color: #c4f5ff;
  text-shadow:
    0 0 6px #38bdf8,
    0 0 12px #0284c7;
}
.battle-skill__particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.battle-skill__particle {
  position: absolute;
  left: calc(8% + var(--particle) * 10%);
  bottom: 3%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #b9f6ff;
  box-shadow:
    0 0 4px #38bdf8,
    0 0 8px #0284c7;
  opacity: 0;
  animation: climax-blue-particle 2.8s ease-out infinite;
  animation-delay: calc(var(--particle) * -0.35s);
}
@keyframes climax-blue-glow {
  0%,
  100% {
    box-shadow:
      0 0 9px #38bdf870,
      inset 0 0 12px #38bdf830;
  }
  50% {
    box-shadow:
      0 0 17px #38bdf8a0,
      inset 0 0 18px #38bdf850;
  }
}
@keyframes climax-blue-particle {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.6);
  }
  20% {
    opacity: 0.9;
  }
  100% {
    opacity: 0;
    transform: translate(8px, -85px) scale(0.2);
  }
}
:global(.battle-shell[data-motion='simple'] .battle-skill__particle),
:global(.battle-shell[data-motion='reduced'] .battle-skill__particle) {
  display: none;
}
:global(.battle-shell[data-motion='simple'] .battle-skill--climax),
:global(.battle-shell[data-motion='reduced'] .battle-skill--climax) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  .battle-skill__particle {
    display: none;
  }
  .battle-skill--climax {
    animation: none;
  }
}
</style>
