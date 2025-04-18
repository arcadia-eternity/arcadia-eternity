<template>
  <el-card class="pet-card">
    <template #header>
      <div class="card-header">
        <span>{{ pet.name }}</span>
        <el-button type="danger" icon="Delete" circle size="small" @click.stop="$emit('remove')" v-if="showRemove" />
      </div>
    </template>
    <div class="pet-info">
      <el-tag type="info">Lv.{{ pet.level }}</el-tag>
      <el-tag type="success">{{ speciesName }}</el-tag>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import type { Pet } from '@arcadia-eternity/schema'
import { useGameDataStore } from '../stores/gameData'
import { computed } from 'vue'

const { pet, showRemove = true } = defineProps<{
  pet: Pet
  showRemove?: boolean
}>()

const gameData = useGameDataStore()
const speciesName = computed(() => gameData.getSpecies(pet.species)?.name || '未知')
</script>
