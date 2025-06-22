<script setup lang="ts">
import { computed } from 'vue'
import HealthRageBar from './HealthRageBar.vue'
import PetIcon from '../PetIcon.vue'
import Mark from './Mark.vue'
import Tooltip from './Tooltip.vue'
import ModifiedValue from './ModifiedValue.vue'
import type { PlayerMessage, SkillMessage } from '@arcadia-eternity/const'
import ElementIcon from './ElementIcon.vue'
import { useGameDataStore } from '@/stores/gameData'
import { useBattleStore } from '@/stores/battle'
import { Z_INDEX } from '@/constants/zIndex'
import i18next from 'i18next'
import { getCurrentSkillEffectiveness } from '@/utils/typeEffectiveness'

const gameDataStore = useGameDataStore()
const battleStore = useBattleStore()

const props = defineProps<{
  player: PlayerMessage
  side: 'left' | 'right'
}>()

const containerClass = computed(() => [
  'absolute top-5 flex gap-3',
  props.side === 'left' ? 'left-5' : 'right-5',
  props.side === 'left' ? 'flex-row' : 'flex-row-reverse',
])

const statusBarClass = computed(() => ['flex flex-col gap-2 min-w-[200px] flex-1'])

const markContainerClass = computed(() => [
  'flex flex-wrap gap-1 w-full mt-1',
  props.side === 'right' ? 'flex-row-reverse' : '',
])

const activePet = computed(() => {
  return battleStore.getPetById(props.player.activePet)
})

// 获取等级的 modifier 信息
const levelModifierInfo = computed(() => {
  const pet = activePet.value
  if (!pet?.modifierState) return undefined

  return pet.modifierState.attributes.find(attr => attr.attributeName === 'level')
})

// 获取 HP 相关的 modifier 信息
const hpModifierInfo = computed(() => {
  const pet = activePet.value
  if (!pet?.modifierState) return undefined

  return {
    currentHp: pet.modifierState.attributes.find(attr => attr.attributeName === 'currentHp'),
    maxHp: pet.modifierState.attributes.find(attr => attr.attributeName === 'maxHp'),
  }
})

// 获取玩家怒气的 modifier 信息
const rageModifierInfo = computed(() => {
  if (!props.player.modifierState) return undefined

  return {
    rage: props.player.modifierState.attributes.find(attr => attr.attributeName === 'rage'),
    maxRage: props.player.modifierState.attributes.find(attr => attr.attributeName === 'maxRage'),
  }
})

// 获取属性名称的i18n翻译
const getStatName = (statKey: string): string => {
  return i18next.t(`stats.${statKey}`, { ns: 'webui' }) || statKey
}

// 获取属性的 modifier 信息
const getStatModifierInfo = (statKey: string) => {
  const pet = activePet.value
  if (!pet?.modifierState) return undefined

  return pet.modifierState.attributes.find(attr => attr.attributeName === statKey)
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

    return getCurrentSkillEffectiveness(virtualSkill, opponentActivePet)
  } else {
    // 敌方精灵：显示己方精灵属性对敌方精灵的效果
    const currentPlayer = battleStore.currentPlayer
    if (!currentPlayer) return { bgColor: '' }

    const currentActivePet = battleStore.getPetById(currentPlayer.activePet)
    if (!currentActivePet) return { bgColor: '' }

    // 创建虚拟技能，使用己方精灵的属性
    const virtualSkill = {
      element: currentActivePet.element,
    } as SkillMessage

    return getCurrentSkillEffectiveness(virtualSkill, pet)
  }
})

// 精灵图标的样式类（包含属性相性背景色）
const petIconClasses = computed(() => {
  const baseClasses = ['relative w-32 h-32 bg-black flex-none rounded-xl']
  const zIndexClass = `z-[${Z_INDEX.BATTLE_STATUS_ICON}]`

  // 添加属性相性背景色
  if (typeEffectivenessConfig.value.bgColor) {
    baseClasses.push(typeEffectivenessConfig.value.bgColor)
  }

  return [...baseClasses, zIndexClass]
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
  const statEntries: Array<{ key: string; name: string; value: number; modifierInfo?: any }> = []

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
  <div :class="containerClass">
    <Tooltip position="bottom">
      <template #trigger>
        <PetIcon
          :id="gameDataStore.getSpecies(activePet!.speciesID)?.num ?? 0"
          :class="petIconClasses"
          :reverse="side == 'right'"
        />
      </template>
      <div class="text-sm">
        <div class="font-semibold mb-2">{{ activePet!.name }} {{ i18next.t('stats.title', { ns: 'webui' }) }}</div>
        <div v-if="petStatsInfo?.hasStats" class="space-y-1">
          <div v-for="stat in petStatsInfo.statEntries" :key="stat.key" class="flex justify-between items-center">
            <span>{{ stat.name }}:</span>
            <ModifiedValue
              :value="
                stat.key === 'critRate' || stat.key === 'accuracy' || stat.key === 'evasion'
                  ? `${stat.value}%`
                  : stat.value
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

    <div :class="statusBarClass">
      <div class="flex items-center gap-2 mb-1" :class="[side === 'right' ? 'flex-row-reverse' : '']">
        <span class="font-semibold text-base">{{ activePet!.name }}</span>
        <span class="text-sm opacity-80">
          Lv.<ModifiedValue :value="activePet!.level" :attribute-info="levelModifierInfo" size="sm" inline />
        </span>
        <div class="flex-1"></div>
        <ElementIcon :element="activePet!.element" class="w-5 h-5"></ElementIcon>
      </div>

      <HealthRageBar
        :current="activePet!.currentHp"
        :max="activePet!.maxHp"
        :rage="player.rage"
        :maxRage="player.maxRage"
        :reverse="props.side === 'right'"
        :current-hp-modifier-info="hpModifierInfo?.currentHp"
        :max-hp-modifier-info="hpModifierInfo?.maxHp"
        :rage-modifier-info="rageModifierInfo?.rage"
        :max-rage-modifier-info="rageModifierInfo?.maxRage"
      />

      <div v-if="activePet!.marks?.length" :class="markContainerClass">
        <Mark v-for="mark in activePet!.marks" :key="mark.id" :mark="mark" />
      </div>
    </div>
  </div>
</template>
