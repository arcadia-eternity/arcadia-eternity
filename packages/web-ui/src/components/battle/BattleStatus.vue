<script setup lang="ts">
import { computed } from 'vue'
import HealthRageBar from './HealthRageBar.vue'
import PetIcon from '../PetIcon.vue'
import Mark from './Mark.vue'
import Tooltip from './Tooltip.vue'
import type { PlayerMessage } from '@arcadia-eternity/const'
import ElementIcon from './ElementIcon.vue'
import { useGameDataStore } from '@/stores/gameData'
import { useBattleStore } from '@/stores/battle'

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

// 属性名称的中文映射
const statNameMap: Record<string, string> = {
  maxHp: '最大体力',
  atk: '攻击',
  def: '防御',
  spa: '特攻',
  spd: '特防',
  spe: '速度',
  accuracy: '命中',
  evasion: '闪避',
  critRate: '暴击率',
  ragePerTurn: '每回合怒气',
  weight: '体重',
  height: '身高',
}

// 格式化精灵属性信息
const petStatsTooltip = computed(() => {
  const pet = activePet.value
  if (!pet) return ''

  // 检查是否为己方精灵（有stats数据）
  if (!pet.stats) {
    return '属性未知'
  }

  const stats = pet.stats
  const statLines: string[] = []

  // 主要战斗属性
  const mainStats = ['atk', 'def', 'spa', 'spd', 'spe']
  mainStats.forEach(statKey => {
    const value = stats[statKey as keyof typeof stats]
    const name = statNameMap[statKey]
    if (typeof value === 'number' && name) {
      statLines.push(`${name}: ${Math.floor(value)}`)
    }
  })

  // 其他属性
  const otherStats = ['accuracy', 'evasion', 'critRate']
  otherStats.forEach(statKey => {
    const value = stats[statKey as keyof typeof stats]
    const name = statNameMap[statKey]
    if (typeof value === 'number' && name) {
      const displayValue =
        statKey === 'critRate'
          ? `${Math.floor(value)}%`
          : statKey === 'accuracy' || statKey === 'evasion'
            ? `${Math.floor(value)}%`
            : Math.floor(value).toString()
      statLines.push(`${name}: ${displayValue}`)
    }
  })

  return statLines.join('\n')
})
</script>

<template>
  <div :class="containerClass">
    <Tooltip position="bottom" :z-index="2147483647">
      <template #trigger>
        <PetIcon
          :id="gameDataStore.getSpecies(activePet!.speciesID)?.num ?? 0"
          class="w-32 h-32 bg-black flex-none rounded-xl"
          :reverse="side == 'right'"
        />
      </template>
      <div class="text-sm">
        <div class="font-semibold mb-2">{{ activePet!.name }} 属性</div>
        <div class="whitespace-pre-line">{{ petStatsTooltip }}</div>
      </div>
    </Tooltip>

    <div :class="statusBarClass">
      <div class="flex items-center gap-2 mb-1" :class="[side === 'right' ? 'flex-row-reverse' : '']">
        <span class="font-semibold text-base">{{ activePet!.name }}</span>
        <span class="text-sm opacity-80">Lv.{{ activePet!.level }}</span>
        <div class="flex-1"></div>
        <ElementIcon :element="activePet!.element" class="w-5 h-5"></ElementIcon>
      </div>

      <HealthRageBar
        :current="activePet!.currentHp"
        :max="activePet!.maxHp"
        :rage="player.rage"
        :maxRage="player.maxRage"
        type="health"
        :reverse="props.side === 'right'"
      />

      <div v-if="activePet!.marks?.length" :class="markContainerClass">
        <Mark v-for="mark in activePet!.marks" :key="mark.id" :mark="mark" />
      </div>
    </div>
  </div>
</template>
