<script setup lang="ts">
import { computed } from 'vue'
import HealthRageBar from './HealthRageBar.vue'
import PetIcon from './PetIcon.vue'
import Mark from './Mark.vue'
import type { Element } from '@test-battle/const'
import ElementIcon from './ElementIcon.vue'

const props = defineProps<{
  player: {
    name: string
    rage: number
    currentPet: {
      level: number
      name: string
      speciesNum: number
      currentHp: number
      maxHp: number
      element: Element
      marks?: Array<{
        id: string
        name: string
        stack?: number
        duration?: number
        description?: string
        image?: string
      }>
    }
  }
  side: 'left' | 'right'
}>()

const containerClass = computed(() => [
  'absolute top-5 flex gap-3',
  props.side === 'left' ? 'left-5' : 'right-5',
  props.side === 'left' ? 'flex-row' : 'flex-row-reverse',
])

const statusBarClass = computed(() => ['flex flex-col gap-2 min-w-[200px]'])

const markContainerClass = computed(() => [
  'flex flex-wrap gap-1 w-full mt-1',
  props.side === 'right' ? 'justify-end' : 'justify-start',
])
</script>

<template>
  <div :class="containerClass">
    <PetIcon :id="player.currentPet.speciesNum" class="w-32 h-32 bg-black rounded-xl" :reverse="side == 'right'" />

    <div :class="statusBarClass">
      <div class="flex items-center gap-2 mb-1" :class="[side === 'right' ? 'flex-row-reverse' : '']">
        <span class="font-semibold text-base">{{ player.currentPet.name }}</span>
        <span class="text-sm opacity-80">Lv.{{ player.currentPet.level }}</span>
        <ElementIcon
          :element="player.currentPet.element"
          class="w-5 h-5 ml-auto"
          :class="[side === 'right' ? 'ml-0 mr-auto' : '']"
        ></ElementIcon>
      </div>

      <HealthRageBar
        :current="player.currentPet.currentHp"
        :max="player.currentPet.maxHp"
        :rage="player.rage"
        type="health"
        class="min-w-[25vw] w-1/4"
        :reverse="props.side === 'right'"
      />

      <div v-if="player.currentPet.marks?.length" :class="markContainerClass">
        <Mark
          v-for="mark in player.currentPet.marks"
          :key="mark.id"
          :name="mark.name"
          :stack="mark.stack || 1"
          :duration="mark.duration || 3"
          :description="mark.description || ''"
          :image="mark.image || '/images/default-mark.png'"
        />
      </div>
    </div>
  </div>
</template>
