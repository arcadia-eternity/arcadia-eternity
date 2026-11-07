<script setup lang="ts">
import ElementIcon from '@/components/battle/ElementIcon.vue'
import { isElement, elementName, skillCategories } from './traits'
import type { Category } from '@arcadia-eternity/const'
import type { ContentRow } from './types'
defineProps<{ kind: string; record: ContentRow }>()
</script>
<template>
  <span v-if="kind === 'species' || kind === 'skills'" class="content-traits">
    <span v-if="isElement(record.element)" class="element-trait" :title="elementName(record.element)">
      <ElementIcon :element="record.element" :size="20" aria-hidden="true" />
      <span>{{ elementName(record.element) }}</span>
    </span>
    <span v-if="kind === 'skills' && record.category" class="category-trait" :data-category="String(record.category)">
      {{ skillCategories[record.category as Category] || record.category }}
    </span>
  </span>
</template>
<style scoped>
.content-traits,
.element-trait {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.content-traits {
  flex-wrap: wrap;
  gap: 10px;
  font-size: 13px;
}
.category-trait {
  padding: 2px 7px;
  border: 1px solid var(--author-border);
  border-radius: 6px;
}
</style>
