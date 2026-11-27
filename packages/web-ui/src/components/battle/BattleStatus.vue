<script setup lang="ts">
import { getNumericAttributeModifier } from '@/utils/modifierStyles'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import statusChrome from '@/assets/battle/status-chrome.svg'
import HealthRageBar from './HealthRageBar.vue'
import PetIcon from '../PetIcon.vue'
import Mark from './Mark.vue'
import Tooltip from './Tooltip.vue'
import ModifiedValue from './ModifiedValue.vue'
import type { PlayerMessage, SkillMessage, AttributeModifierInfo } from '@arcadia-eternity/const'
import ElementIcon from './ElementIcon.vue'
import { useGameDataStore } from '@/stores/gameData'
import { useBattleStore } from '@/stores/battle'
import i18next from 'i18next'
import { getCurrentSkillEffectiveness } from '@/utils/typeEffectiveness'

const gameDataStore = useGameDataStore()
const battleStore = useBattleStore()

const props = defineProps<{
  player: PlayerMessage
  side: 'left' | 'right'
}>()

const activePet = computed(() => {
  return battleStore.getPetById(props.player.activePet)
})

const statsOpen = ref(false)
const statsHovered = ref(false)
const portraitButton = useTemplateRef('portraitButton')
const showStats = computed(() => statsOpen.value || statsHovered.value)
function closeStats() {
  statsOpen.value = false
  statsHovered.value = false
}
onClickOutside(portraitButton, closeStats)
watch(() => props.player.activePet, closeStats)

function updatePortraitHover(event: PointerEvent, hovered: boolean) {
  if (event.pointerType === 'mouse' || event.pointerType === 'pen') statsHovered.value = hovered
}

function toggleStats() {
  statsOpen.value = !statsOpen.value
  if (!statsOpen.value) statsHovered.value = false
}

const markCapacity = 12
const visibleMarkCount = computed(() => {
  const count = activePet.value?.marks?.length ?? 0
  return count > markCapacity ? markCapacity - 1 : count
})
const visibleMarks = computed(() => activePet.value?.marks?.slice(0, visibleMarkCount.value) ?? [])
const overflowMarks = computed(() => activePet.value?.marks?.slice(visibleMarkCount.value) ?? [])

// 获取等级的 modifier 信息
const levelModifierInfo = computed(() => {
  const pet = activePet.value
  if (!pet?.modifierState) return undefined

  return getNumericAttributeModifier(pet.modifierState, 'level')
})

// 获取 HP 相关的 modifier 信息
const hpModifierInfo = computed(() => {
  const pet = activePet.value
  if (!pet?.modifierState) return undefined

  return {
    currentHp: getNumericAttributeModifier(pet.modifierState, 'currentHp'),
    maxHp: getNumericAttributeModifier(pet.modifierState, 'maxHp'),
  }
})

// 获取玩家怒气的 modifier 信息
const rageModifierInfo = computed(() => {
  if (!props.player.modifierState) return undefined

  return {
    rage: getNumericAttributeModifier(props.player.modifierState, 'rage'),
    maxRage: getNumericAttributeModifier(props.player.modifierState, 'maxRage'),
  }
})

const formatPercentage = (value: number) => `${value}%`

// 获取属性名称的i18n翻译
const getStatName = (statKey: string): string => {
  return i18next.t(`stats.${statKey}`, { ns: 'webui' }) || statKey
}

// 获取属性的 modifier 信息
const getStatModifierInfo = (statKey: string) => {
  const pet = activePet.value
  if (!pet?.modifierState) return undefined

  return getNumericAttributeModifier(pet.modifierState, statKey)
}

// 计算属性相性效果（用于精灵图标背景色）
const typeEffectivenessConfig = computed(() => {
  const pet = activePet.value
  if (!pet) {
    return { bgColor: '' }
  }

  // 根据当前显示的精灵类型计算属性相性
  if (props.side === 'left') {
    // 己方精灵：显示己方精灵属性对敌方精灵的效果
    const opponent = battleStore.opponent
    if (!opponent) return { bgColor: '' }

    const opponentActivePet = battleStore.getPetById(opponent.activePet)
    if (!opponentActivePet) return { bgColor: '' }

    // 创建虚拟技能，使用己方精灵的属性
    const virtualSkill = {
      element: pet.element,
    } as SkillMessage

    return getCurrentSkillEffectiveness(virtualSkill, opponentActivePet, gameDataStore.elementMultipliers)
  } else {
    // 敌方精灵：显示敌方精灵属性对己方精灵的效果
    const currentPlayer = battleStore.currentPlayer
    if (!currentPlayer) return { bgColor: '' }

    const currentActivePet = battleStore.getPetById(currentPlayer.activePet)
    if (!currentActivePet) return { bgColor: '' }

    // 创建虚拟技能，使用敌方精灵的属性
    const virtualSkill = {
      element: pet.element,
    } as SkillMessage

    return getCurrentSkillEffectiveness(virtualSkill, currentActivePet, gameDataStore.elementMultipliers)
  }
})

// 格式化精灵属性信息（用于显示是否有 modifier）
const petStatsInfo = computed(() => {
  const pet = activePet.value
  if (!pet) return null

  // 检查是否为己方精灵（有stats数据）
  if (!pet.stats) {
    return { hasStats: false, message: i18next.t('stats.unknown', { ns: 'webui' }) || '属性未知' }
  }

  const stats = pet.stats
  const statEntries: Array<{ key: string; name: string; value: number; modifierInfo?: AttributeModifierInfo<number> }> =
    []

  // 主要战斗属性
  const mainStats = ['atk', 'def', 'spa', 'spd', 'spe']
  mainStats.forEach(statKey => {
    const value = stats[statKey as keyof typeof stats]
    const name = getStatName(statKey)
    if (typeof value === 'number' && name) {
      statEntries.push({
        key: statKey,
        name,
        value: Math.floor(value),
        modifierInfo: getStatModifierInfo(statKey),
      })
    }
  })

  // 其他属性
  const otherStats = ['accuracy', 'evasion', 'critRate']
  otherStats.forEach(statKey => {
    const value = stats[statKey as keyof typeof stats]
    const name = getStatName(statKey)
    if (typeof value === 'number' && name) {
      const displayValue =
        statKey === 'critRate' || statKey === 'accuracy' || statKey === 'evasion'
          ? Math.floor(value)
          : Math.floor(value)

      statEntries.push({
        key: statKey,
        name,
        value: displayValue,
        modifierInfo: getStatModifierInfo(statKey),
      })
    }
  })

  return { hasStats: true, statEntries }
})
</script>

<template>
  <div v-if="activePet" class="battle-status" :class="`battle-status--${side}`" :data-battle-status="side">
    <div class="battle-status__panel">
      <img :src="statusChrome" class="battle-status__chrome" alt="" />
      <Tooltip
        :show="showStats"
        @update:show="
          visible => {
            if (!visible) closeStats()
          }
        "
        portal
        :position="side === 'right' ? 'left' : 'right'"
        trigger="click"
        class="battle-status__portrait-anchor"
      >
        <template #trigger>
          <button
            ref="portraitButton"
            type="button"
            class="battle-status__portrait"
            :aria-label="`${activePet.name} ${i18next.t('stats.title', { ns: 'webui' })}`"
            :aria-expanded="showStats"
            @pointerenter="updatePortraitHover($event, true)"
            @pointerleave="updatePortraitHover($event, false)"
            @click="toggleStats"
          >
            <span class="battle-status__tint" :class="typeEffectivenessConfig.bgColor"></span>
            <PetIcon
              :id="gameDataStore.getSpecies(activePet.speciesID)?.num"
              :species="gameDataStore.getSpecies(activePet.speciesID)"
              class="battle-status__pet"
              :reverse="side === 'right'"
            />
          </button>
        </template>
        <div class="text-sm">
          <div class="font-semibold mb-2">{{ activePet!.name }} {{ i18next.t('stats.title', { ns: 'webui' }) }}</div>
          <div v-if="petStatsInfo?.hasStats" class="space-y-1">
            <div v-for="stat in petStatsInfo.statEntries" :key="stat.key" class="flex justify-between items-center">
              <span>{{ stat.name }}:</span>
              <ModifiedValue
                :value="stat.value"
                :format="
                  stat.key === 'critRate' || stat.key === 'accuracy' || stat.key === 'evasion'
                    ? formatPercentage
                    : undefined
                "
                :attribute-info="stat.modifierInfo"
                size="sm"
                inline
              />
            </div>
          </div>
          <div v-else class="text-gray-400">
            {{ petStatsInfo?.message }}
          </div>
        </div>
      </Tooltip>

      <div class="battle-status__name">{{ activePet.name }}</div>
      <div class="battle-status__level">
        <span>LV:</span>
        <ModifiedValue :value="activePet.level" :attribute-info="levelModifierInfo" size="sm" inline />
      </div>
      <ElementIcon :element="activePet.element" :size="17" class="battle-status__element" />

      <HealthRageBar
        :key="activePet.id"
        :current="activePet.currentHp"
        :max="activePet.maxHp"
        :rage="player.rage"
        :maxRage="player.maxRage"
        :reverse="props.side === 'right'"
        :current-hp-modifier-info="hpModifierInfo?.currentHp"
        :max-hp-modifier-info="hpModifierInfo?.maxHp"
        :rage-modifier-info="rageModifierInfo?.rage"
        :max-rage-modifier-info="rageModifierInfo?.maxRage"
      />

      <div v-if="visibleMarks.length" class="battle-status__marks">
        <Mark v-for="mark in visibleMarks" :key="mark.id" :mark="mark" />
        <details v-if="overflowMarks.length" class="battle-status__more">
          <summary :aria-label="`展开其余 ${overflowMarks.length} 个印记`">+{{ overflowMarks.length }}</summary>
          <div><Mark v-for="mark in overflowMarks" :key="mark.id" :mark="mark" /></div>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.battle-status {
  position: relative;
  grid-column: 1;
  width: 508px;
  height: 151px;
}
.battle-status--right {
  grid-column: 3;
}
.battle-status__panel {
  position: relative;
  width: 381px;
  height: 110px;
  scale: calc(4 / 3);
  transform-origin: top left;
}
.battle-status__chrome {
  position: absolute;
  inset: 0;
  width: 100%;
}
.battle-status--right .battle-status__chrome,
.battle-status--right .battle-status__element {
  scale: -1 1;
}
.battle-status :deep(.battle-status__portrait-anchor) {
  position: absolute;
  top: 7px;
  left: 6px;
  pointer-events: auto;
}
.battle-status--right :deep(.battle-status__portrait-anchor) {
  left: auto;
  right: 6px;
}
.battle-status__portrait {
  position: relative;
  display: block;
  width: 72px;
  height: 72px;
  cursor: pointer;
}
.battle-status__tint,
.battle-status__pet {
  position: absolute;
  inset: 0;
}
.battle-status__tint {
  clip-path: polygon(0 14%, 14% 0, 83% 0, 100% 14%, 100% 88%, 86% 100%, 14% 100%, 0 88%);
}
.battle-status__name {
  position: absolute;
  top: 86px;
  left: 4px;
  width: 74px;
  padding-inline: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #52e5f9;
  text-align: center;
  font:
    12px/19.6px system-ui,
    sans-serif;
}
.battle-status--right .battle-status__name {
  left: auto;
  right: 4px;
}
.battle-status__level {
  position: absolute;
  top: 53px;
  left: 88px;
  display: flex;
  gap: 3px;
  align-items: center;
  height: 15px;
  color: #9de8f9;
  font:
    italic 800 11px/1 system-ui,
    sans-serif;
  text-shadow:
    0 1px 2px #10182c,
    0 0 4px #10182c;
}
.battle-status--right .battle-status__level {
  left: auto;
  right: 88px;
}
.battle-status__element {
  position: absolute;
  top: 51.5px;
  left: 139px;
}
.battle-status--right .battle-status__element {
  left: auto;
  right: 139px;
}
/* Marks hang below the panel in rows of six, mirrored on the right. */
.battle-status__marks {
  position: absolute;
  top: 86px;
  left: 86px;
  display: grid;
  grid-template-columns: repeat(6, 27px);
  grid-auto-rows: 27px;
  gap: 7px 5px;
  pointer-events: auto;
}
.battle-status--right .battle-status__marks {
  left: auto;
  right: 86px;
  direction: rtl;
}
.battle-status__marks > * {
  direction: ltr;
}
.battle-status__marks :deep(.battle-mark__trigger) {
  width: 27px;
  height: 27px;
}
.battle-status__marks :deep(.battle-mark__stack) {
  font-size: 10px;
  line-height: 11px;
  min-width: 12px;
}
.battle-status__more {
  position: relative;
}
.battle-status__more summary {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  background: var(--battle-panel-soft);
  color: var(--battle-cyan);
  cursor: pointer;
  font-size: 12px;
  list-style: none;
}
.battle-status--left .battle-status__more > div {
  left: 0;
  right: auto;
}
.battle-status__more > div {
  position: absolute;
  top: 32px;
  right: 0;
  width: 190px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  background: var(--battle-panel);
  border: 1px solid var(--battle-line);
  z-index: 100;
}
</style>
