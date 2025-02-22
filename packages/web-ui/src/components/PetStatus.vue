<template>
  <div class="pet-status">
    <div class="pet-name">{{ pet.name }}</div>
    <div class="hp-bar">
      <el-progress
        :percentage="(pet.currentHp / pet.maxHp) * 100"
        :format="() => `${pet.currentHp}/${pet.maxHp}`"
        status="exception"
      />
    </div>
    <div class="element">
      <img :src="elementIcon" class="element-icon" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { type PetMessage } from '@test-battle/const'

const props = defineProps<{
  pet: PetMessage
  isOpponent?: boolean
}>()

const elementIcon = computed(() => `/elements/${props.pet.element}.png`)
</script>
