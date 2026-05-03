<script setup lang="ts">
/**
 * IdentityHeader - Compact one-row identity display for rich editor panels.
 * Uses game-config for entity metadata, categories, and i18n.
 */
import { computed } from 'vue'
import i18next from 'i18next'
import { ELEMENT_MAP } from '@arcadia-eternity/const'
import type { RichFieldContext } from '../types'
import { useGameConfig } from '../../../../game-config'

const props = defineProps<{ context: RichFieldContext }>()

const config = useGameConfig()

const entityType = computed(() => props.context.metadata.entityType)
const entityConfig = computed(() => config.entities[entityType.value])
const recordId = computed(() => props.context.metadata.recordId)
const record = computed(() => {
  const gd = props.context.metadata.gameData
  return gd[entityType.value]?.[recordId.value] as Record<string, unknown> | undefined
})

function resolveI18nNs(): string | string[] | undefined {
  return entityConfig.value?.i18n?.namespaces
}

const displayName = computed(() => {
  if (!recordId.value) return ''
  const ns = resolveI18nNs()
  if (!ns) return recordId.value
  const t = i18next.t(`${recordId.value}.name`, { ns, defaultValue: recordId.value })
  return t !== recordId.value ? t : recordId.value
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

function findCategoryMeta(value: unknown): { label: string; color: string; bg: string } | null {
  if (!config.categories) return null
  return config.categories.find(c => String(c.value) === String(value)) ?? null
}

const skillCategory = computed(() => {
  if (entityType.value !== 'skills') return null
  const cat = record.value?.category
  return findCategoryMeta(cat)
})

const skillElement = computed(() => {
  if (entityType.value !== 'skills') return null
  const el = record.value?.element
  return typeof el === 'string' ? el : null
})

const entityIcon = computed(() => entityConfig.value?.icon)
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
      <span v-if="entityIcon" class="identity-mark-icon">{{ entityIcon }}</span>
      <span class="identity-name identity-name--mono">{{ displayName }}</span>
    </template>

    <template v-else>
      <span v-if="entityIcon" class="identity-mark-icon">{{ entityIcon }}</span>
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
