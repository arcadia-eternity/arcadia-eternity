<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import type { RichFieldContext } from '../types'
import type { EntityType } from '@/features/data-editor/composables/useEditorState'
import type { Element } from '@arcadia-eternity/const'
import { translateEntityName } from '@/features/data-editor/schemas/editorSchemas'
import { useGameConfig } from '../../../../game-config'
import { useEntityNavigation } from '@/features/data-editor/composables/useEntityNavigation'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import MarkIcon from '@/components/MarkIcon.vue'

const props = defineProps<{ context: RichFieldContext }>()

const config = useGameConfig()
const { navigateTo } = useEntityNavigation()

// ── Derive entity kind ──

const entityKind = computed<EntityType | null>(() => {
  return props.context.hints.entityKind ?? null
})

// ── Items (simple strings) ──

const idKey = computed(() => props.context.hints.idKey ?? 'skill_id')

const items = computed<string[]>(() => {
  const v = props.context.value
  if (!Array.isArray(v)) return []
  return v
    .map(item => {
      if (typeof item === 'object' && item !== null && idKey.value in (item as Record<string, unknown>)) {
        return String((item as Record<string, unknown>)[idKey.value] ?? '')
      }
      return String(item ?? '')
    })
    .filter(Boolean)
})

function removeItem(index: number) {
  const arr = items.value.filter((_, i) => i !== index)
  props.context.onUpdate(arr)
}

// ── Name translation ──

function translateName(id: string, kind: EntityType): string {
  const entityConfig = config.entities[kind]
  if (!entityConfig) return id
  return translateEntityName(id, entityConfig)
}

function resolveLabel(id: string): string {
  const kind = entityKind.value
  if (!id) return '(空)'
  if (kind) return translateName(id, kind)
  return id
}

// ── Navigation ──

function navigateToEntity(id: string) {
  const kind = entityKind.value
  if (kind && id) navigateTo(kind, id)
}

// ── Icon resolution ──

function resolveElement(id: string): Element | null {
  if (entityKind.value !== 'skills') return null
  const skill = props.context.metadata.gameData.skills?.[id] as Record<string, unknown> | undefined
  const el = skill?.element
  if (typeof el === 'string') return el as unknown as Element
  return null
}

// ── Add dropdown ──

const showDropdown = ref(false)
const searchQuery = ref('')

const availableEntities = computed<{ id: string; label: string }[]>(() => {
  const kind = entityKind.value
  if (!kind) return []
  const entities = props.context.metadata.gameData[kind]
  if (!entities || typeof entities !== 'object') return []
  return Object.keys(entities).map(id => ({ id, label: translateName(id, kind) }))
})

const existingIds = computed(() => new Set(items.value))

const filteredForAdd = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const filtered = q
    ? availableEntities.value.filter(e => e.id.toLowerCase().includes(q) || e.label.toLowerCase().includes(q))
    : availableEntities.value
  return filtered.filter(e => !existingIds.value.has(e.id))
})

function addEntity(entity: { id: string }) {
  const arr = [...items.value, entity.id]
  props.context.onUpdate(arr)
  searchQuery.value = ''
  showDropdown.value = false
}

// ── Click-outside ──

function onClickOutside(e: MouseEvent) {
  const el = document.querySelector('.entity-tags-chip__dropdown')
  if (el && !el.contains(e.target as Node)) {
    showDropdown.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
  <div class="entity-tags-chip">
    <div class="chips-wrap">
      <span v-for="(id, index) in items" :key="index" class="chip">
        <ElementIcon
          v-if="entityKind === 'skills' && resolveElement(id)"
          :element="resolveElement(id)!"
          :size="14"
          class="chip-icon"
        />
        <MarkIcon v-else-if="entityKind === 'marks'" :mark-id="id" :size="14" class="chip-icon" />
        <span class="chip-label" @click="navigateToEntity(id)">
          {{ resolveLabel(id) }}
        </span>
        <button class="chip-remove" type="button" @click.stop="removeItem(index)" title="移除">×</button>
      </span>

      <button class="add-btn" type="button" @click.stop="showDropdown = !showDropdown">+ 添加</button>
    </div>

    <div v-if="showDropdown" class="entity-tags-chip__dropdown" @click.stop>
      <input
        v-model="searchQuery"
        class="dropdown-search"
        placeholder="搜索..."
        autofocus
        @keyup.escape="showDropdown = false"
      />
      <div class="dropdown-results">
        <div v-if="filteredForAdd.length === 0" class="dropdown-empty">无匹配结果</div>
        <button
          v-for="entity in filteredForAdd"
          :key="entity.id"
          class="dropdown-item"
          type="button"
          @click="addEntity(entity)"
        >
          <ElementIcon
            v-if="entityKind === 'skills'"
            :element="(props.context.metadata.gameData.skills?.[entity.id] as any)?.element"
            :size="14"
            class="dropdown-item-icon"
          />
          <MarkIcon v-else-if="entityKind === 'marks'" :mark-id="entity.id" :size="14" class="dropdown-item-icon" />
          <span class="dropdown-item-label">{{ entity.label }}</span>
          <span class="dropdown-item-id">{{ entity.id }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.entity-tags-chip {
  position: relative;
}

/* ── Chips wrap ── */

.chips-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

/* ── Chip ── */

.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-secondary);
  background: var(--ae-bg-overlay);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  line-height: 1.5;
}

.chip-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  color: var(--ae-text-secondary);
  padding: 0 1px;
}

.chip-label:hover {
  color: var(--ae-accent-primary);
  text-decoration: underline;
}

.chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  margin-left: 1px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 1;
}

.chip-remove:hover {
  color: var(--ae-error);
  background: var(--ae-hover);
}

/* ── Add button ── */

.add-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: var(--ae-font-xs);
  color: var(--ae-accent-primary);
  background: transparent;
  border: 1px dashed var(--ae-border-default);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  line-height: 1.5;
  font-family: inherit;
}

.add-btn:hover {
  background: var(--ae-bg-overlay);
  border-color: var(--ae-accent-primary);
}

/* ── Dropdown ── */

.entity-tags-chip__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 200px;
  max-width: 300px;
  max-height: 240px;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-default);
  border-radius: var(--ae-radius-md);
  box-shadow: var(--ae-shadow-md);
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dropdown-search {
  width: 100%;
  padding: var(--ae-space-2) var(--ae-space-3);
  border: none;
  border-bottom: 1px solid var(--ae-border-subtle);
  background: transparent;
  color: var(--ae-text-primary);
  font-size: var(--ae-font-sm);
  outline: none;
  flex-shrink: 0;
  font-family: inherit;
  box-sizing: border-box;
}

.dropdown-search::placeholder {
  color: var(--ae-text-muted);
}

.dropdown-results {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.dropdown-empty {
  padding: var(--ae-space-3);
  text-align: center;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  width: 100%;
  padding: var(--ae-space-1) var(--ae-space-3);
  border: none;
  background: transparent;
  color: var(--ae-text-primary);
  font: inherit;
  font-size: var(--ae-font-xs);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.dropdown-item:hover {
  background: var(--ae-hover);
}

.dropdown-item-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.dropdown-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-item-id {
  margin-left: auto;
  font-size: 10px;
  color: var(--ae-text-muted);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80px;
  flex-shrink: 0;
}
</style>
