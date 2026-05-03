<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { RichFieldContext } from '../types'
import type { EntityType } from '@/features/data-editor/composables/useEditorState'
import type { Element } from '@arcadia-eternity/const'
import { translateEntityName } from '@/features/data-editor/schemas/editorSchemas'
import { useGameConfig } from '../../../../game-config'
import { useEntityNavigation } from '@/features/data-editor/composables/useEntityNavigation'
import MarkIcon from '@/components/MarkIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'

const props = defineProps<{ context: RichFieldContext }>()

const config = useGameConfig()
const { navigateTo } = useEntityNavigation()

// ── Entity kind ──

const entityKind = computed<EntityType | null>(() => {
  return props.context.hints.entityKind ?? null
})

const entityLabel = computed(() => {
  const kind = entityKind.value
  if (!kind) return '项目'
  return config.entities[kind]?.label ?? '项目'
})

// ── Items ──

const items = computed<unknown[]>(() => {
  const v = props.context.value
  return Array.isArray(v) ? v : []
})

const idKey = computed(() => props.context.hints.idKey ?? 'skill_id')

const isComplexItems = computed(() => {
  if (items.value.length === 0) return false
  const first = items.value[0]
  return typeof first === 'object' && first !== null && idKey.value in (first as Record<string, unknown>)
})

// ── Name resolution ──

function translateName(id: string, kind: EntityType): string {
  const entityConfig = config.entities[kind]
  if (!entityConfig) return id
  return translateEntityName(id, entityConfig)
}

function resolveEntityId(item: unknown): string {
  if (isComplexItems.value && typeof item === 'object' && item !== null) {
    return String((item as Record<string, unknown>)[idKey.value] ?? '')
  }
  return String(item ?? '')
}

function resolveEntityLabel(item: unknown): string {
  const kind = entityKind.value
  const rawId = resolveEntityId(item)
  if (!rawId) return '(空)'
  if (kind) return translateName(rawId, kind)
  return rawId
}

function resolveElement(item: unknown): string | null {
  if (entityKind.value !== 'skills') return null
  const rawId = resolveEntityId(item)
  if (!rawId) return null
  const skills = props.context.metadata.gameData.skills
  const skill = skills?.[rawId] as Record<string, unknown> | undefined
  return (skill?.element as string) ?? null
}

function navigateToEntity(item: unknown) {
  const kind = entityKind.value
  const id = resolveEntityId(item)
  if (kind && id) navigateTo(kind, id)
}

// ── Mutations ──

function updateItemField(index: number, field: string, value: unknown) {
  const arr = [...items.value]
  const item = { ...(arr[index] as Record<string, unknown>), [field]: value }
  arr[index] = item
  props.context.onUpdate(arr)
}

function removeItem(index: number) {
  const arr = items.value.filter((_, i) => i !== index)
  props.context.onUpdate(arr)
}

function replaceItemEntity(index: number, newId: string) {
  const arr = [...items.value]
  const item = isComplexItems.value
    ? { ...(arr[index] as Record<string, unknown>), [idKey.value]: newId }
    : newId
  arr[index] = item
  props.context.onUpdate(arr)
}

// ── Add dropdown ──

const showDropdown = ref(false)
const searchQuery = ref('')

const availableEntities = computed<{ id: string; label: string }[]>(() => {
  const kind = entityKind.value
  if (!kind) return []
  const gameData = props.context.metadata.gameData
  const entities = gameData[kind]
  if (!entities || typeof entities !== 'object') return []
  return Object.keys(entities).map(id => ({ id, label: translateName(id, kind) }))
})

const existingIds = computed(() => new Set(items.value.map(item => resolveEntityId(item))))

const filteredForAdd = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const filtered = q
    ? availableEntities.value.filter(e => e.id.toLowerCase().includes(q) || e.label.toLowerCase().includes(q))
    : availableEntities.value
  return filtered.filter(e => !existingIds.value.has(e.id))
})

function addEntity(entity: { id: string }) {
  const newItem = isComplexItems.value
    ? { [idKey.value]: entity.id, level: 1, hidden: false }
    : entity.id
  const arr = [...items.value, newItem]
  props.context.onUpdate(arr)
  searchQuery.value = ''
  showDropdown.value = false
}

// ── Per-row swap dropdown ──

const swappingIndex = ref<number | null>(null)
const swapSearch = ref('')

const swapExcludeId = computed(() => {
  if (swappingIndex.value === null) return null
  return resolveEntityId(items.value[swappingIndex.value])
})

const swapFiltered = computed(() => {
  const kind = entityKind.value
  if (!kind) return []
  const q = swapSearch.value.trim().toLowerCase()
  const currentId = swapExcludeId.value
  // Exclude IDs already in use, but allow the current item's own ID (no-op swap)
  const exclude = new Set(existingIds.value)
  if (currentId) exclude.delete(currentId)
  return availableEntities.value
    .filter(e => !q || e.id.toLowerCase().includes(q) || e.label.toLowerCase().includes(q))
    .filter(e => !exclude.has(e.id))
})

function openSwap(index: number) {
  swappingIndex.value = index
  swapSearch.value = ''
  nextTick(() => {
    const input = document.querySelector('.swap-search-input') as HTMLInputElement | null
    input?.focus()
  })
}

function closeSwap() {
  swappingIndex.value = null
  swapSearch.value = ''
}

function doSwap(id: string) {
  if (swappingIndex.value !== null) {
    replaceItemEntity(swappingIndex.value, id)
  }
  closeSwap()
}

// ── Click-outside ──

function onClickOutside(e: MouseEvent) {
  const target = e.target as Node
  const addDropdown = document.querySelector('.entity-table-dropdown')
  const swapDropdown = document.querySelector('.swap-dropdown')
  if (addDropdown && !addDropdown.contains(target)) showDropdown.value = false
  if (swapDropdown && !swapDropdown.contains(target)) closeSwap()
}

function toggleDropdown() {
  showDropdown.value = !showDropdown.value
  if (showDropdown.value) searchQuery.value = ''
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
  <div class="entity-table-editor">
    <!-- Header bar -->
    <div class="entity-table-header">
      <span class="entity-table-title">
        {{ entityLabel }} ({{ items.length }})
      </span>
      <button class="entity-table-add-btn" type="button" @click="toggleDropdown">
        + 添加{{ entityLabel }}
      </button>
    </div>

    <!-- Divider -->
    <div class="entity-table-divider" />

    <!-- Rows -->
    <div
      v-for="(item, index) in items"
      :key="index"
      class="entity-table-row"
    >
      <!-- Icon -->
      <ElementIcon
        v-if="entityKind === 'skills' && resolveElement(item)"
        :element="(resolveElement(item) as Element)"
        :size="14"
        class="entity-table-icon"
      />
      <MarkIcon
        v-else-if="entityKind === 'marks'"
        :mark-id="resolveEntityId(item)"
        :size="14"
        class="entity-table-icon"
      />
      <span v-else class="entity-table-icon entity-table-icon--empty" />

      <!-- Clickable name → swap dropdown -->
      <span class="entity-table-name" @click.stop="openSwap(index)">
        {{ resolveEntityLabel(item) }}
      </span>

      <!-- Navigation ↗ -->
      <button
        class="entity-table-nav"
        type="button"
        title="跳转到{{ entityLabel }}编辑器"
        @click.stop="navigateToEntity(item)"
      >↗</button>

      <!-- Controls (always visible) -->
      <span class="entity-table-controls">
        <template v-if="isComplexItems">
          <span class="entity-table-lv">Lv</span>
          <input
            type="number"
            class="entity-table-level-input"
            :value="(item as Record<string,unknown>).level ?? 1"
            min="1"
            max="100"
            @input="updateItemField(index, 'level', Number(($event.target as HTMLInputElement).value))"
            @click.stop
          />
          <label class="entity-table-hidden-toggle">
            <input
              type="checkbox"
              :checked="(item as Record<string,unknown>).hidden === true"
              @change="updateItemField(index, 'hidden', ($event.target as HTMLInputElement).checked)"
            />
            <span class="entity-table-hidden-label">隐</span>
          </label>
        </template>
        <button
          class="entity-table-remove"
          type="button"
          @click.stop="removeItem(index)"
          title="移除"
        >
          ×
        </button>
      </span>

      <!-- Per-row swap dropdown -->
      <div v-if="swappingIndex === index" class="swap-dropdown" @click.stop>
        <input
          v-model="swapSearch"
          class="swap-search-input"
          placeholder="替换为..."
          @keyup.escape="closeSwap()"
        />
        <div class="swap-results">
          <div v-if="swapFiltered.length === 0" class="swap-results-empty">无匹配结果</div>
          <button
            v-for="entity in swapFiltered"
            :key="entity.id"
            class="swap-result-item"
            type="button"
            @click="doSwap(entity.id)"
          >
            <ElementIcon
              v-if="entityKind === 'skills'"
              :element="(props.context.metadata.gameData.skills?.[entity.id] as any)?.element"
              :size="14"
              class="swap-result-icon"
            />
            <MarkIcon
              v-else-if="entityKind === 'marks'"
              :mark-id="entity.id"
              :size="14"
              class="swap-result-icon"
            />
            <span class="swap-result-label">{{ entity.label }}</span>
            <span class="swap-result-id">{{ entity.id }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="items.length === 0" class="entity-table-empty">
      <button class="entity-table-add-btn entity-table-add-btn--empty" type="button" @click="toggleDropdown">
        + 添加{{ entityLabel }}
      </button>
    </div>

    <!-- Add dropdown -->
    <div v-if="showDropdown" class="entity-table-dropdown" @click.stop>
      <input
        v-model="searchQuery"
        class="entity-table-search"
        placeholder="搜索..."
        autofocus
        @keyup.escape="showDropdown = false"
      />
      <div class="entity-table-results">
        <div v-if="filteredForAdd.length === 0" class="entity-table-results-empty">无匹配结果</div>
        <button
          v-for="entity in filteredForAdd"
          :key="entity.id"
          class="entity-table-result-item"
          type="button"
          @click="addEntity(entity)"
        >
          <ElementIcon
            v-if="entityKind === 'skills'"
            :element="(props.context.metadata.gameData.skills?.[entity.id] as any)?.element"
            :size="14"
            class="entity-table-result-icon"
          />
          <MarkIcon
            v-else-if="entityKind === 'marks'"
            :mark-id="entity.id"
            :size="14"
            class="entity-table-result-icon"
          />
          <span class="entity-table-result-label">{{ entity.label }}</span>
          <span class="entity-table-result-id">{{ entity.id }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.entity-table-editor {
  position: relative;
}

/* ── Header ── */

.entity-table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ae-space-2);
  padding: 0 0 var(--ae-space-1);
}

.entity-table-title {
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-secondary);
  letter-spacing: 0.02em;
}

.entity-table-add-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--ae-space-2);
  font-size: var(--ae-font-xs);
  font-weight: 500;
  color: var(--ae-accent-primary);
  background: transparent;
  border: 1px dashed var(--ae-border-default);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  line-height: 1.5;
  transition: background 0.12s ease, border-color 0.12s ease;
  user-select: none;
  white-space: nowrap;
}

.entity-table-add-btn:hover {
  background: var(--ae-accent-primary-subtle);
  border-color: var(--ae-accent-primary);
}

.entity-table-add-btn--empty {
  font-size: var(--ae-font-sm);
  padding: var(--ae-space-2) var(--ae-space-4);
}

/* ── Divider ── */

.entity-table-divider {
  height: 1px;
  background: var(--ae-border-subtle);
  margin-bottom: 2px;
}

/* ── Row ── */

.entity-table-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px var(--ae-space-1);
  border-radius: var(--ae-radius-sm);
  transition: background 0.1s ease;
  position: relative;
}

.entity-table-row:hover {
  background: var(--ae-hover);
}

/* ── Icon ── */

.entity-table-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.entity-table-icon--empty {
  width: 14px;
  height: 14px;
}

/* ── Name (click → swap) ── */

.entity-table-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ae-font-xs);
  font-weight: 500;
  color: var(--ae-text-primary);
  cursor: pointer;
  padding: 0 2px;
  line-height: 1.6;
  transition: color 0.12s ease;
}

.entity-table-name:hover {
  color: var(--ae-accent-primary);
}

/* ── Nav button (↗) ── */

.entity-table-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.1s ease, color 0.1s ease, background 0.1s ease;
}

.entity-table-row:hover .entity-table-nav {
  opacity: 1;
}

.entity-table-nav:hover {
  color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
}

/* ── Controls ── */

.entity-table-controls {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  margin-left: auto;
}

.entity-table-lv {
  font-size: 10px;
  font-weight: 700;
  color: var(--ae-text-muted);
  margin-right: 1px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.entity-table-level-input {
  width: 36px;
  padding: 0 2px;
  border: 1px solid var(--ae-border-subtle);
  border-radius: 3px;
  background: var(--ae-bg-base);
  color: var(--ae-text-primary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  outline: none;
  transition: border-color 0.12s ease;
}

.entity-table-level-input:focus {
  border-color: var(--ae-accent-primary);
}

.entity-table-hidden-toggle {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  cursor: pointer;
  padding: 1px 2px;
  border-radius: 3px;
  transition: background 0.1s ease;
}

.entity-table-hidden-toggle:hover {
  background: var(--ae-hover);
}

.entity-table-hidden-toggle input {
  width: 11px;
  height: 11px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--ae-warning);
}

.entity-table-hidden-label {
  font-size: 10px;
  color: var(--ae-text-muted);
  user-select: none;
}

/* ── Remove button ── */

.entity-table-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  margin-left: 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.1s ease, background 0.1s ease;
}

.entity-table-remove:hover {
  color: var(--ae-error);
  background: var(--ae-error-subtle);
}

/* ── Empty state ── */

.entity-table-empty {
  display: flex;
  justify-content: center;
  padding: var(--ae-space-2) 0;
}

/* ── Add dropdown ── */

.entity-table-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-width: 340px;
  max-height: 260px;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-default);
  border-radius: var(--ae-radius-md);
  box-shadow: var(--ae-shadow-md);
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.entity-table-search {
  width: 100%;
  padding: var(--ae-space-2) var(--ae-space-3);
  border: none;
  border-bottom: 1px solid var(--ae-border-subtle);
  background: transparent;
  color: var(--ae-text-primary);
  font-size: var(--ae-font-sm);
  outline: none;
  flex-shrink: 0;
}

.entity-table-search::placeholder {
  color: var(--ae-text-muted);
}

.entity-table-results {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.entity-table-results-empty {
  padding: var(--ae-space-3);
  text-align: center;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
}

.entity-table-result-item {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  width: 100%;
  padding: var(--ae-space-1) var(--ae-space-3);
  border: none;
  background: transparent;
  color: var(--ae-text-primary);
  font: inherit;
  cursor: pointer;
  transition: background 0.1s ease;
}

.entity-table-result-item:hover {
  background: var(--ae-hover);
}

.entity-table-result-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.entity-table-result-label {
  font-size: var(--ae-font-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.entity-table-result-id {
  margin-left: auto;
  font-size: 10px;
  color: var(--ae-text-muted);
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80px;
  flex-shrink: 0;
}

/* ── Swap dropdown (per-row) ── */

.swap-dropdown {
  position: absolute;
  top: 100%;
  left: 20px;
  right: 40px;
  max-height: 220px;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-default);
  border-radius: var(--ae-radius-md);
  box-shadow: var(--ae-shadow-md);
  z-index: 60;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.swap-search-input {
  width: 100%;
  padding: var(--ae-space-1) var(--ae-space-2);
  border: none;
  border-bottom: 1px solid var(--ae-border-subtle);
  background: transparent;
  color: var(--ae-text-primary);
  font-size: var(--ae-font-xs);
  outline: none;
  flex-shrink: 0;
}

.swap-search-input::placeholder {
  color: var(--ae-text-muted);
}

.swap-results {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.swap-results-empty {
  padding: var(--ae-space-2);
  text-align: center;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
}

.swap-result-item {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  width: 100%;
  padding: var(--ae-space-1) var(--ae-space-2);
  border: none;
  background: transparent;
  color: var(--ae-text-primary);
  font: inherit;
  font-size: var(--ae-font-xs);
  cursor: pointer;
  transition: background 0.1s ease;
}

.swap-result-item:hover {
  background: var(--ae-hover);
}

.swap-result-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.swap-result-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.swap-result-id {
  margin-left: auto;
  font-size: 10px;
  color: var(--ae-text-muted);
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 80px;
  flex-shrink: 0;
}
</style>
