<script setup lang="ts">
/**
 * PackSelector - Dropdown showing workspace packs with enable/disable toggles.
 *
 * Fetches packs from the workspace service and renders them as a selectable
 * dropdown list. Each pack can be toggled on/off to control which data is
 * visible in the editor.
 */
import { ref, onMounted, computed } from 'vue'
import { Check, FolderOpened } from '@element-plus/icons-vue'
import { listWorkspacePacks } from '@/services/packWorkspace'
import type { WorkspacePackSummary } from '@/services/packWorkspace'

const packs = ref<WorkspacePackSummary[]>([])
const loading = ref(false)
const isOpen = ref(false)

const enabledPackIds = ref<Set<string>>(new Set())

const emit = defineEmits<{
  'update:enabledPacks': [packIds: string[]]
}>()

const props = defineProps<{
  enabledPacks?: string[]
}>()

const enabledCount = computed(() => enabledPackIds.value.size)
const totalCount = computed(() => packs.value.length)

async function fetchPacks() {
  loading.value = true
  try {
    const result = await listWorkspacePacks()
    packs.value = result
    // Initialize enabled packs from props or all packs
    if (props.enabledPacks && props.enabledPacks.length > 0) {
      enabledPackIds.value = new Set(props.enabledPacks)
    } else {
      enabledPackIds.value = new Set(result.filter(p => p.enabled).map(p => p.id || p.folderName))
    }
  } catch {
    packs.value = []
  } finally {
    loading.value = false
  }
}

function togglePack(pack: WorkspacePackSummary) {
  const key = pack.id || pack.folderName
  if (!pack.canDisable) return

  if (enabledPackIds.value.has(key)) {
    enabledPackIds.value.delete(key)
  } else {
    enabledPackIds.value.add(key)
  }
  // Force reactivity
  enabledPackIds.value = new Set(enabledPackIds.value)
  emit('update:enabledPacks', [...enabledPackIds.value])
}

onMounted(fetchPacks)
</script>

<template>
  <el-dropdown
    trigger="click"
    placement="bottom-start"
    :hide-on-click="false"
    class="pack-selector"
    @visible-change="isOpen = $event"
  >
    <button
      type="button"
      class="pack-selector-trigger"
      :class="{ 'is-open': isOpen }"
    >
      <el-icon :size="14" class="pack-selector-icon">
        <FolderOpened />
      </el-icon>
      <span class="pack-selector-label">数据包</span>
      <span class="pack-selector-count" v-if="totalCount > 0">
        {{ enabledCount }}/{{ totalCount }}
      </span>
      <span class="pack-selector-chevron" :class="{ 'is-open': isOpen }">&#9662;</span>
    </button>

    <template #dropdown>
      <div class="pack-selector-dropdown">
        <div class="pack-selector-header">
          <span class="pack-selector-title">工作区数据包</span>
          <button
            type="button"
            class="pack-selector-refresh"
            title="刷新列表"
            :disabled="loading"
            @click.stop="fetchPacks"
          >
            &#x21bb;
          </button>
        </div>

        <div v-if="loading" class="pack-selector-empty">
          加载中...
        </div>

        <div v-else-if="packs.length === 0" class="pack-selector-empty">
          没有找到数据包
        </div>

        <div v-else class="pack-selector-list">
          <button
            v-for="pack in packs"
            :key="pack.id || pack.folderName"
            type="button"
            class="pack-selector-item"
            :class="{
              'is-disabled': !pack.canDisable,
              'is-active': enabledPackIds.has(pack.id || pack.folderName),
            }"
            @click="togglePack(pack)"
          >
            <span class="pack-check" :class="{ 'is-checked': enabledPackIds.has(pack.id || pack.folderName) }">
              <el-icon v-if="enabledPackIds.has(pack.id || pack.folderName)" :size="12">
                <Check />
              </el-icon>
            </span>
            <span class="pack-info">
              <span class="pack-name">{{ pack.id || pack.folderName }}</span>
              <span v-if="pack.version" class="pack-version">v{{ pack.version }}</span>
            </span>
            <span v-if="!pack.canDisable" class="pack-badge">核心</span>
          </button>
        </div>
      </div>
    </template>
  </el-dropdown>
</template>

<style scoped>
.pack-selector-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding: var(--ae-space-1) var(--ae-space-2);
  font-size: var(--ae-font-sm);
  font-weight: 500;
  color: var(--ae-text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  height: 28px;
}

.pack-selector-trigger:hover {
  color: var(--ae-text-primary);
  background: var(--ae-hover);
}

.pack-selector-trigger.is-open {
  color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
  border-color: var(--ae-accent-primary);
}

.pack-selector-icon {
  flex-shrink: 0;
}

.pack-selector-label {
  letter-spacing: 0.02em;
}

.pack-selector-count {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  padding: 0 var(--ae-space-1);
  background: var(--ae-bg-overlay);
  border-radius: 999px;
  line-height: 1.4;
}

.pack-selector-chevron {
  font-size: 10px;
  transition: transform 0.2s ease;
  transform: rotate(0deg);
}

.pack-selector-chevron.is-open {
  transform: rotate(180deg);
}

/* Dropdown panel */
.pack-selector-dropdown {
  min-width: 240px;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-default);
  border-radius: var(--ae-radius-md);
  box-shadow: var(--ae-shadow-lg);
  overflow: hidden;
}

.pack-selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ae-space-2) var(--ae-space-3);
  border-bottom: 1px solid var(--ae-border-subtle);
}

.pack-selector-title {
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pack-selector-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 13px;
  color: var(--ae-text-muted);
  background: transparent;
  border: none;
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}

.pack-selector-refresh:hover:not(:disabled) {
  color: var(--ae-text-primary);
  background: var(--ae-hover);
}

.pack-selector-refresh:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pack-selector-empty {
  padding: var(--ae-space-4);
  text-align: center;
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
}

.pack-selector-list {
  max-height: 200px;
  overflow-y: auto;
}

.pack-selector-item {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  width: 100%;
  padding: var(--ae-space-2) var(--ae-space-3);
  font-size: var(--ae-font-sm);
  color: var(--ae-text-primary);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--ae-border-subtle);
  cursor: pointer;
  transition: background 0.1s ease;
  text-align: left;
}

.pack-selector-item:last-child {
  border-bottom: none;
}

.pack-selector-item:hover {
  background: var(--ae-hover);
}

.pack-selector-item.is-disabled {
  cursor: default;
}

.pack-selector-item.is-disabled:hover {
  background: transparent;
}

/* Checkbox */
.pack-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1px solid var(--ae-border-strong);
  border-radius: 3px;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.pack-check.is-checked {
  background: var(--ae-accent-primary);
  border-color: var(--ae-accent-primary);
  color: #fff;
}

/* Pack info */
.pack-info {
  display: flex;
  align-items: baseline;
  gap: var(--ae-space-2);
  flex: 1;
  min-width: 0;
}

.pack-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pack-version {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  flex-shrink: 0;
}

.pack-badge {
  font-size: var(--ae-font-xs);
  padding: 0 var(--ae-space-1);
  color: var(--ae-info);
  background: var(--ae-info-subtle);
  border-radius: 999px;
  line-height: 1.4;
  flex-shrink: 0;
}
</style>
