<script setup lang="ts">
/**
 * IdentityHeader - Compact one-row identity display for rich editor panels.
 * Species: PetIcon + ElementIcon + name + dex number
 * Skills: ElementIcon + category badge + name
 * Marks: MarkIcon + name
 */
import { computed } from 'vue'
import i18next from 'i18next'
import { ELEMENT_MAP, Category } from '@arcadia-eternity/const'
import type { RichFieldContext } from '../types'

const props = defineProps<{ context: RichFieldContext }>()

const entityType = computed(() => props.context.metadata.entityType)
const recordId = computed(() => props.context.metadata.recordId)
const record = computed(() => {
  const gd = props.context.metadata.gameData
  return gd[entityType.value]?.[recordId.value] as Record<string, unknown> | undefined
})

function translateName(id: string, ns: string | string[]): string {
  const t = i18next.t(`${id}.name`, { ns, defaultValue: id })
  return t !== id ? t : id
}

const displayName = computed(() => {
  if (!recordId.value) return ''
  switch (entityType.value) {
    case 'species': return translateName(recordId.value, 'species')
    case 'skills': return translateName(recordId.value, 'skill')
    case 'marks': return translateName(recordId.value, ['mark', 'mark_ability', 'mark_emblem', 'mark_global'])
    default: return recordId.value
  }
})

const speciesNum = computed(() => {
  if (entityType.value !== 'species') return null
  const n = record.value?.num
  return typeof n === 'number' ? n : null
})

const speciesElement = computed(() => {
  if (entityType.value !== 'species') return null
  const el = record.value?.element
  return typeof el === 'string' ? el : null
})

const CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
  [Category.Physical]: { label: '物攻', color: '#f87171', bg: 'rgba(248, 113, 113, 0.15)' },
  [Category.Special]: { label: '特攻', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' },
  [Category.Status]: { label: '属性', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)' },
  [Category.Climax]: { label: '终极', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' },
}

const skillCategory = computed(() => {
  if (entityType.value !== 'skills') return null
  const cat = record.value?.category
  return typeof cat === 'string' ? (CATEGORY_META[cat] ?? null) : null
})

const skillElement = computed(() => {
  if (entityType.value !== 'skills') return null
  const el = record.value?.element
  return typeof el === 'string' ? el : null
})
</script>

<template>
  <div class="identity-header">
    <template v-if="entityType === 'species'">
      <img
        v-if="typeof speciesNum === 'number'"
        :src="`/pet-icons/${speciesNum}.png`"
        :alt="String(speciesNum)"
        class="identity-icon"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <div v-else class="identity-icon identity-icon--placeholder" />
      <span v-if="speciesElement" class="identity-element">
        <span class="identity-element-dot" :style="{ backgroundColor: ELEMENT_MAP[speciesElement]?.emoji ?? '#888' }" />
      </span>
      <span class="identity-name">{{ displayName }}</span>
      <span v-if="speciesNum != null" class="identity-dex">#{{ speciesNum }}</span>
    </template>

    <template v-else-if="entityType === 'skills'">
      <span v-if="skillElement" class="identity-element">
        <span class="identity-element-dot" :style="{ backgroundColor: ELEMENT_MAP[skillElement]?.emoji ?? '#888' }" />
      </span>
      <span v-if="skillCategory" class="identity-badge" :style="{ color: skillCategory.color, backgroundColor: skillCategory.bg }">
        {{ skillCategory.label }}
      </span>
      <span class="identity-name">{{ displayName }}</span>
    </template>

    <template v-else-if="entityType === 'marks'">
      <span class="identity-mark-icon">🏷️</span>
      <span class="identity-name identity-name--mono">{{ displayName }}</span>
    </template>

    <template v-else>
      <span class="identity-name">{{ displayName }}</span>
    </template>
  </div>
</template>

<style scoped>
.identity-header {
  display: flex; align-items: center; gap: 8px;
  height: 40px; padding: 0 12px; flex-shrink: 0; min-width: 0;
  border-bottom: 1px solid var(--ae-border-subtle);
  background: var(--ae-bg-elevated);
}
.identity-icon { width: 28px; height: 28px; border-radius: var(--ae-radius-sm); object-fit: contain; flex-shrink: 0; }
.identity-icon--placeholder { background: var(--ae-bg-overlay); border: 1px solid var(--ae-border-subtle); }
.identity-element { display: inline-flex; align-items: center; flex-shrink: 0; }
.identity-element-dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.15); }
.identity-badge { display: inline-flex; align-items: center; padding: 1px 8px; font-size: 11px; font-weight: 600; border-radius: 999px; line-height: 1.6; flex-shrink: 0; }
.identity-name { font-size: 13px; font-weight: 600; color: var(--ae-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.identity-name--mono { font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace; }
.identity-dex { font-size: 11px; color: var(--ae-text-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.identity-mark-icon { font-size: 16px; flex-shrink: 0; line-height: 1; }
</style>
