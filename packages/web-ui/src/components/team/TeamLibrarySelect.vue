<script setup lang="ts">
import type { TeamLibraryDelegate } from './library'
const props = defineProps<{ delegate: TeamLibraryDelegate; label: string }>()
const delegate = props.delegate
</script>
<template>
  <label class="team-library-select"
    >{{ label }}
    <select v-model="delegate.selected.value" :aria-label="label">
      <option v-for="entry in delegate.entries.value" :key="entry.id" :value="entry.id">
        {{ entry.name }} · {{ entry.size }} 只
      </option>
    </select>
  </label>
</template>
<style scoped>
.team-library-select {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
select {
  border: 1px solid #cbd5e1;
  padding: 8px;
  border-radius: 6px;
  background: white;
  color: #243042;
}
</style>
