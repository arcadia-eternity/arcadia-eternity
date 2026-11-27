<script setup lang="ts">
import { type SkillMessage, type AttributeModifierInfo, Category } from '@arcadia-eternity/const'
import BattleFrame from './BattleFrame.vue'
import ElementIcon from './ElementIcon.vue'
import Tooltip from './Tooltip.vue'
import ModifiedValue from './ModifiedValue.vue'
import BattleMarkInfo from './BattleMarkInfo.vue'
import { Z_INDEX } from '@/constants/zIndex'
import ContentDescription from '@/components/ContentDescription'
import i18next from 'i18next'
import { computed, ref, useTemplateRef } from 'vue'
import { onClickOutside, useMediaQuery } from '@vueuse/core'
import { useBattleStore } from '@/stores/battle'
import { useGameDataStore } from '@/stores/gameData'
import { SkillMarkRelationService } from '@/services/skillMarkRelationService'
import { getSkillTypeEffectiveness } from '@/utils/typeEffectiveness'
import climaxEmblem from '@/assets/battle/climax-emblem.svg?inline'

const battleStore = useBattleStore()
const gameDataStore = useGameDataStore()

const props = defineProps<{
  skill: SkillMessage
  disabled?: boolean
  // Modifier 信息
  powerModifierInfo?: AttributeModifierInfo<number>
  accuracyModifierInfo?: AttributeModifierInfo<number>
  rageModifierInfo?: AttributeModifierInfo<number>
  // 属性克制倍率（可选，如果不提供则自动计算）
  typeEffectiveness?: number
}>()

const showDetails = ref(false)
const canHover = useMediaQuery('(hover: hover) and (pointer: fine)')
const infoButton = useTemplateRef('infoButton')
onClickOutside(infoButton, () => {
  if (!canHover.value) showDetails.value = false
})
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
const isClimax = computed(() => originalCategory.value === Category.Climax)
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

  const effectivenessConfig = getSkillTypeEffectiveness(
    props.skill,
    opponentActivePet,
    gameDataStore.elementMultipliers,
  )
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
      return 'battle-skill__element--strong'
    } else if (effectiveness < 1) {
      // 效果不佳 - 灰色边框
      return 'battle-skill__element--weak'
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
    gameDataStore.effectMarkRelations,
  )

  const analysis = relationService.analyzeSkillMarkRelations(props.skill.baseId)
  // 只显示前3个最相关的印记，避免tooltip过长
  return analysis.relatedMarks.slice(0, 3)
})
</script>

<template>
  <div class="battle-skill-slot">
    <Tooltip
      :interactive="canHover"
      portal
      position="top"
      v-model:show="showDetails"
      :trigger="showDetails || !canHover ? 'click' : 'hover'"
    >
      <template #trigger>
        <div class="battle-skill__trigger">
          <button
            :class="['battle-skill', { 'battle-skill--climax': isClimax }, `z-[${Z_INDEX.SKILL_BUTTON}]`]"
            data-testid="skill-button"
            :data-skill-id="skill.id"
            :data-skill-base-id="skill.baseId"
            :disabled="disabled"
            :aria-label="`${name} · ${category} · 威力 ${skill.power} · 怒气 ${skill.rage} · 命中 ${skill.accuracy}`"
            @click="emit('click', skill.id)"
          >
            <BattleFrame variant="skill" />
            <img v-if="isClimax" :src="climaxEmblem" class="battle-skill__emblem" alt="" aria-hidden="true" />
            <div v-if="isClimax && !disabled" class="battle-skill__particles" aria-hidden="true">
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
                  <ModifiedValue
                    :value="skill.power"
                    :attribute-info="powerModifierInfo"
                    :class="{ 'battle-skill__value--base': !powerModifierInfo?.isModified }"
                    size="sm"
                    inline
                  />
                </div>
                <div class="battle-skill__stat battle-skill__stat--rage">
                  <span>{{ i18next.t('rage', { ns: 'battle' }) }}</span>
                  <ModifiedValue
                    :value="skill.rage"
                    :attribute-info="rageModifierInfo"
                    :class="{ 'battle-skill__value--base': !rageModifierInfo?.isModified }"
                    size="sm"
                    inline
                  />
                </div>
              </div>
            </div>
          </button>
          <button
            ref="infoButton"
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
        <ContentDescription namespace="skill" :content-id="skill.baseId" :fallback="description" :context="{ skill }" />

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
  right: 6px;
  bottom: 5px;
  width: 22px;
  height: 22px;
  color: #b6d8e4;
  border-radius: 50%;
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
.battle-skill__info svg circle {
  fill: #112633;
}
.battle-skill__info:hover,
.battle-skill__info[aria-expanded='true'] {
  color: #ebfcff;
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
  border-radius: 9px;
}
.battle-skill:disabled {
  filter: brightness(0.5);
  cursor: not-allowed;
}
@media (hover: hover) {
  .battle-skill:hover:not(:disabled, :active) :deep(.battle-frame--skill) {
    filter: invert(0.87) hue-rotate(160deg) saturate(1.4) brightness(1.2);
  }
}
.battle-skill:focus-visible {
  outline: 2px solid var(--battle-cyan);
  outline-offset: 4px;
}
/* Scale the old brief’s 156 × 83 anchors to the current card. */
.battle-skill__content {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: #fff25d;
  font:
    400 14px/19px 'SimSun',
    'Songti SC',
    'Noto Serif CJK SC',
    serif;
  text-shadow:
    0 0 2px #000,
    0 0 3px #000,
    0 1px 2px #000;
}
.battle-skill__element {
  position: absolute;
  left: 8.3%;
  top: 18%;
  width: 24%;
  aspect-ratio: 1;
  max-height: 46%;
  display: grid;
  place-items: center;
  border-radius: 50%;
  isolation: isolate;
}
/* Radar medallion behind the element icon, drawn at the icon's position so it follows the card layout. */
.battle-skill__element::before,
.battle-skill__element::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.battle-skill__element::before {
  inset: -9%;
  background:
    linear-gradient(#8fdcec38, #8fdcec38) center / 100% 1px no-repeat,
    linear-gradient(#8fdcec38, #8fdcec38) center / 1px 100% no-repeat,
    radial-gradient(#8deef930, #8deef908 70%);
  border: 1px solid #9af4ff48;
}
.battle-skill__element::after {
  inset: 9%;
  border: 1px dashed #8fdcec40;
}
.battle-skill__element :deep(.element-icon) {
  position: relative;
  z-index: 1;
}
.battle-skill__element--strong {
  box-shadow:
    inset 0 0 0 1px #b0f5ff,
    0 0 7px #5ad8ec;
}
.battle-skill__element--weak {
  box-shadow:
    inset 0 0 0 1px #8d9ba8,
    0 0 5px #08101c;
}
.battle-skill__element :deep(img) {
  width: 74% !important;
  height: 74% !important;
  min-height: 0 !important;
  object-fit: contain;
}
.battle-skill__category {
  position: absolute;
  left: 5.13%;
  top: 71.08%;
  width: 30%;
  text-align: center;
}
.battle-skill__name {
  position: absolute;
  left: 40.38%;
  top: 18.07%;
  right: 5%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.battle-skill__stat {
  position: absolute;
  left: 40.38%;
  right: 0;
  display: grid;
  grid-template-columns: minmax(max-content, 38.7%) minmax(0, 1fr);
  align-items: center;
}
.battle-skill__stat--power {
  top: 44.58%;
}
.battle-skill__stat--power > span {
  color: #d3c850;
}
.battle-skill__stat--rage {
  top: 71.08%;
}
.battle-skill__stat :deep(span) {
  font-size: inherit;
  line-height: inherit;
  font-weight: inherit;
}
.battle-skill__value--base :deep(span) {
  color: inherit;
}
.battle-skill--climax:not(:disabled) {
  box-shadow: 0 0 8px #62e7f464;
  animation: climax-cyan-glow 2.4s ease-in-out infinite;
}
.battle-skill__emblem {
  position: absolute;
  top: 3px;
  left: 5px;
  width: 19px;
  height: 19px;
  pointer-events: none;
  filter: drop-shadow(0 0 4px #62e7f4);
}
.battle-skill:disabled .battle-skill__emblem {
  filter: saturate(0.3);
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
    0 0 4px #63e9f6,
    0 0 7px #279eae;
  opacity: 0;
  animation: climax-cyan-particle 2.8s ease-out infinite;
  animation-delay: calc(var(--particle) * -0.35s);
}
@keyframes climax-cyan-glow {
  0%,
  100% {
    box-shadow: 0 0 8px #62e7f464;
  }
  50% {
    box-shadow: 0 0 13px #62e7f498;
  }
}
@keyframes climax-cyan-particle {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.6);
  }
  20% {
    opacity: 0.9;
  }
  100% {
    opacity: 0;
    transform: translate(6px, -66px) scale(0.2);
  }
}
:global(.battle-shell[data-motion='simple'] .battle-skill__particle),
:global(.battle-shell[data-motion='reduced'] .battle-skill__particle) {
  display: none;
}
:global(.battle-shell[data-motion='simple'] .battle-skill--climax:not(:disabled)),
:global(.battle-shell[data-motion='reduced'] .battle-skill--climax:not(:disabled)) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  .battle-skill__particle {
    display: none;
  }
  .battle-skill--climax:not(:disabled) {
    animation: none;
  }
}
</style>
