<script setup lang="ts">
/**
 * GlobalSearch - Global search overlay across all entity types.
 *
 * Searches species, skills, marks, and effects simultaneously by ID
 * (case-insensitive contains). Displays grouped results with type icons
 * and navigates to the selected entity on click.
 */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { translateEntityName, getTypeBoxSchemaSpec } from '@/features/data-editor/schemas/editorSchemas'
import { Search } from '@element-plus/icons-vue'
import { ElInput } from 'element-plus'
import { useGameDataStore } from '@/stores/gameData'
import { useEntityNavigation } from '../../composables/useEntityNavigation'
import type { EntityType } from '../../composables/useEditorState'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const gameDataStore = useGameDataStore()
const { navigateTo } = useEntityNavigation()

const isOpen = ref(false)
const inputRef = ref<InstanceType<typeof ElInput> | null>(null)

interface SearchResult {
  id: string
}

interface ResultGroup {
  type: EntityType
  label: string
  icon: string
  items: SearchResult[]
}

const MAX_PER_TYPE = 5

const groupedResults = computed<ResultGroup[]>(() => {
  const query = props.modelValue.trim().toLowerCase()
  if (!query) return []

  const groups: ResultGroup[] = []

  const searchIn = (
    type: EntityType,
    label: string,
    icon: string,
    byId: Record<string, unknown>,
    allIds: string[],
  ): ResultGroup | null => {
    const matched: SearchResult[] = []
    for (const id of allIds) {
      const spec = (type === 'species' || type === 'skills' || type === 'marks')
        ? getTypeBoxSchemaSpec(type)
        : undefined
      const i18nName = spec ? translateEntityName(id, spec).toLowerCase() : id.toLowerCase()
      if (id.toLowerCase().includes(query) || i18nName.includes(query)) {
        matched.push({ id })
        if (matched.length >= MAX_PER_TYPE) break
      }
    }
    return matched.length > 0 ? { type, label, icon, items: matched } : null
  }

  const speciesGroup = searchIn(
    'species', '物种', '🧬',
    gameDataStore.species.byId,
    gameDataStore.species.allIds,
  )
  if (speciesGroup) groups.push(speciesGroup)

  const skillsGroup = searchIn(
    'skills', '技能', '⚔️',
    gameDataStore.skills.byId,
    gameDataStore.skills.allIds,
  )
  if (skillsGroup) groups.push(skillsGroup)

  const marksGroup = searchIn(
    'marks', '标记', '🏷️',
    gameDataStore.marks.byId,
    gameDataStore.marks.allIds,
  )
  if (marksGroup) groups.push(marksGroup)

  const effectsGroup = searchIn(
    'effects', '效果', '✨',
    gameDataStore.effects.byId,
    gameDataStore.effects.allIds,
  )
  if (effectsGroup) groups.push(effectsGroup)

  return groups
})

const totalResults = computed(() =>
  groupedResults.value.reduce((sum, g) => sum + g.items.length, 0),
)

function selectResult(type: EntityType, id: string) {
  navigateTo(type, id)
  emit('update:modelValue', '')
  isOpen.value = false
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.global-search')) {
    isOpen.value = false
  }
}

watch(
  () => props.modelValue,
  (val) => {
    isOpen.value = val.trim().length > 0
  },
)

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})
</script>

<template>
  <div class="global-search">
    <ElInput
      ref="inputRef"
      :model-value="modelValue"
      placeholder="搜索物种/技能/标记/效果..."
      :prefix-icon="Search"
      clearable
      size="small"
      class="global-search__input"
      @update:model-value="emit('update:modelValue', $event)"
      @focus="modelValue.trim().length > 0 && (isOpen = true)"
    />

    <Transition name="gs-dropdown">
      <div
        v-if="isOpen && groupedResults.length > 0"
        class="global-search__dropdown"
      >
        <div class="dropdown-header">
          <span class="dropdown-header__count">{{ totalResults }} 条结果</span>
        </div>

        <div
          v-for="group in groupedResults"
          :key="group.type"
          class="result-group"
        >
          <div class="group-header">
            <span class="group-header__icon">{{ group.icon }}</span>
            <span class="group-header__label">{{ group.label }}</span>
            <span class="group-header__count">{{ group.items.length }}</span>
          </div>

          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="result-item"
            @click="selectResult(group.type, item.id)"
          >
            <span class="result-item__connector">└</span>
            <span class="result-item__id">{{ item.id }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.global-search {
  position: relative;
  width: 100%;
}

/* ── Input override ── */
.global-search__input :deep(.el-input__wrapper) {
  background: var(--ae-bg-elevated) !important;
  box-shadow: 0 0 0 1px var(--ae-border-subtle) inset !important;
  border-radius: var(--ae-radius-sm) !important;
  height: 28px !important;
  font-size: var(--ae-font-sm);
  transition: box-shadow 0.15s ease;
}

.global-search__input :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--ae-border-default) inset !important;
}

.global-search__input :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--ae-accent-primary) inset !important;
}

.global-search__input :deep(.el-input__prefix) {
  color: var(--ae-text-muted);
}

.global-search__input :deep(.el-input__inner) {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-primary);
}

.global-search__input :deep(.el-input__inner::placeholder) {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-sm);
}

/* ── Dropdown ── */
.global-search__dropdown {
  position: absolute;
  top: calc(100% + var(--ae-space-1));
  left: 0;
  right: 0;
  min-width: 280px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--ae-bg-overlay);
  border: 1px solid var(--ae-border-default);
  border-radius: var(--ae-radius-md);
  box-shadow: var(--ae-shadow-lg);
  z-index: 100;
  padding: var(--ae-space-1) 0;
  font-family: var(--ae-font-base), -apple-system, BlinkMacSystemFont, sans-serif;
}

/* ── Transition ── */
.gs-dropdown-enter-active,
.gs-dropdown-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.gs-dropdown-enter-from,
.gs-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── Dropdown header ── */
.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ae-space-1) var(--ae-space-3);
  border-bottom: 1px solid var(--ae-border-subtle);
  margin-bottom: var(--ae-space-1);
}

.dropdown-header__count {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
}

/* ── Result group ── */
.result-group {
  padding: var(--ae-space-1) 0;
}

.result-group + .result-group {
  border-top: 1px solid var(--ae-border-subtle);
}

.group-header {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding: var(--ae-space-1) var(--ae-space-3);
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  user-select: none;
}

.group-header__icon {
  font-size: 12px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.group-header__label {
  flex: 1;
}

.group-header__count {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

/* ── Result item ── */
.result-item {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  width: 100%;
  height: 32px;
  padding: 0 var(--ae-space-3) 0 calc(var(--ae-space-3) + 18px);
  font-size: var(--ae-font-sm);
  color: var(--ae-text-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background-color 0.1s ease;
  text-align: left;
  font-family: var(--ae-font-base), -apple-system, BlinkMacSystemFont, monospace;
}

.result-item:hover {
  background: var(--ae-hover);
}

.result-item__connector {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-xs);
  margin-right: var(--ae-space-1);
  flex-shrink: 0;
  user-select: none;
}

.result-item__id {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
