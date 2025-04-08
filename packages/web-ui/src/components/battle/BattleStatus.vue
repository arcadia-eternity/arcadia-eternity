<script setup lang="ts">
import { computed } from 'vue'
import HealthRageBar from './HealthRageBar.vue'
import PetIcon from '../PetIcon.vue'
import Mark from './Mark.vue'
import type { Element, PlayerMessage } from '@test-battle/const'
import ElementIcon from './ElementIcon.vue'
import { useGameDataStore } from '@/stores/gameData'

const gameDataStore = useGameDataStore()

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
</script>

<template>
  <div :class="containerClass">
    <PetIcon
      :id="gameDataStore.getSpecies(player.activePet.speciesID)?.num ?? 0"
      class="w-32 h-32 bg-black flex-none rounded-xl"
      :reverse="side == 'right'"
    />

    <div :class="statusBarClass">
      <div class="flex items-center gap-2 mb-1" :class="[side === 'right' ? 'flex-row-reverse' : '']">
        <span class="font-semibold text-base">{{ player.activePet.name }}</span>
        <span class="text-sm opacity-80">Lv.{{ player.activePet.level }}</span>
        <ElementIcon
          :element="player.activePet.element"
          class="w-5 h-5 ml-auto"
          :class="[side === 'right' ? 'ml-0 mr-auto' : '']"
        ></ElementIcon>
      </div>

      <HealthRageBar
        :current="player.activePet.currentHp"
        :max="player.activePet.maxHp"
        :rage="player.rage"
        type="health"
        :reverse="props.side === 'right'"
      />

      <div v-if="player.activePet.marks?.length" :class="markContainerClass">
        <Mark v-for="mark in player.activePet.marks" :key="mark.id" :mark="mark" />
      </div>
    </div>
  </div>
</template>
