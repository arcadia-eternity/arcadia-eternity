<script setup lang="ts">
import { ElSelect, ElOption } from 'element-plus'
import type { TeamLibraryDelegate } from './library'
const props = defineProps<{ delegate: TeamLibraryDelegate; label: string; disabled?: boolean }>()
const delegate = props.delegate
</script>
<template>
  <label class="team-library-select"
    >{{ label }}
    <ElSelect filterable v-model="delegate.selected.value" :aria-label="label" :disabled="disabled">
      <ElOption
        v-for="entry in delegate.entries.value"
        :key="entry.id"
        :value="entry.id"
        :label="entry.name + ' · ' + entry.size + ' 只'"
      />
    </ElSelect>
  </label>
</template>
<style scoped>
.team-library-select {
  display: grid;
  gap: 4px;
  min-width: min(100%, 12rem);
}
</style>
