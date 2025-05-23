<script setup lang="ts">
import { computed } from 'vue'
import HealthRageBar from './HealthRageBar.vue'
import PetIcon from '../PetIcon.vue'
import Mark from './Mark.vue'
import type { Element, PlayerMessage } from '@arcadia-eternity/const'
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
  props.side === 'right' ? 'justify-end' : 'justify-start',
])

const activePet = computed(() => {
  return battleStore.getPetById(props.player.activePet)
})
</script>

<template>
  <div :class="containerClass">
    <PetIcon
      :id="gameDataStore.getSpecies(activePet!.speciesID)?.num ?? 0"
      class="w-32 h-32 bg-black flex-none rounded-xl"
      :reverse="side == 'right'"
    />

    <div :class="statusBarClass">
      <div class="flex items-center gap-2 mb-1" :class="[side === 'right' ? 'flex-row-reverse' : '']">
        <span class="font-semibold text-base">{{ activePet!.name }}</span>
        <span class="text-sm opacity-80">Lv.{{ activePet!.level }}</span>
        <ElementIcon
          :element="activePet!.element"
          class="w-5 h-5 ml-auto"
          :class="[side === 'right' ? 'ml-0 mr-auto' : '']"
        ></ElementIcon>
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
