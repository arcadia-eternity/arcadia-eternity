<script setup lang="ts">
import type { PetOrigin } from '@arcadia-eternity/local-profile'

defineProps<{ species: string; origin?: PetOrigin; unavailable?: boolean }>()
</script>

<template>
  <span class="block text-xs break-all">
    <span>{{ unavailable ? '物种' : '缺失物种' }} · {{ species }}</span>
    <span v-if="origin" class="block" :title="origin.version">来源 · {{ origin.name }}</span>
  </span>
</template>
