<script setup lang="ts">
/**
 * PackManagerTab - Pack management panel for the data editor sidebar.
 *
 * Shows workspace packs with enable/disable toggles, search filter,
 * and a layering visualization. Uses packWorkspace service directly
 * (no Pinia stores for pack state).
 */
import { ref, computed, onMounted } from 'vue'
import { listWorkspacePacks, setWorkspacePackEnabled, type WorkspacePackSummary } from '@/services/packWorkspace'
import { useEditorState } from '../../composables/useEditorState'
import PackLayeringView from './PackLayeringView.vue'

const editorState = useEditorState()

const packs = ref<WorkspacePackSummary[]>([])
const loading = ref(false)
const search = ref('')
const error = ref<string | null>(null)
const basePackDir = ref<string | null>(null)

const filteredPacks = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return packs.value
  return packs.value.filter(p => p.folderName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
})

const enabledCount = computed(() => packs.value.filter(p => p.enabled).length)
const totalCount = computed(() => packs.value.length)

async function refresh() {
  loading.value = true
  error.value = null
  try {
    const result = await listWorkspacePacks()
    packs.value = result

    // Sync enabled packs into editor state
    editorState.packFilters.enabledPacks = result.filter(p => p.enabled).map(p => p.id || p.folderName)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载数据包失败'
    packs.value = []
  } finally {
    loading.value = false
  }
}

async function togglePack(pack: WorkspacePackSummary) {
  if (!pack.canDisable) return

  const newEnabled = !pack.enabled
  try {
    await setWorkspacePackEnabled({
      folderName: pack.folderName,
      enabled: newEnabled,
    })
    pack.enabled = newEnabled

    // Update editor state
    editorState.packFilters.enabledPacks = packs.value.filter(p => p.enabled).map(p => p.id || p.folderName)
  } catch (e) {
    // Revert on failure
    pack.enabled = !newEnabled
    error.value = e instanceof Error ? e.message : '修改数据包状态失败'
  }
}

async function openBasePackDir() {
  if (basePackDir.value && window.arcadiaDesktop?.showItemInFolder) {
    await window.arcadiaDesktop.showItemInFolder(basePackDir.value)
  }
}

onMounted(() => {
  refresh()
  if (window.arcadiaDesktop?.getBasePackDir) {
    window.arcadiaDesktop
      .getBasePackDir()
      .then(dir => {
        basePackDir.value = dir
      })
      .catch(() => {})
  }
})
</script>

<template>
  <div class="pack-manager">
    <!-- Toolbar -->
    <div class="pack-toolbar">
      <el-input v-model="search" placeholder="搜索包..." size="small" clearable class="pack-search" />
      <el-button size="small" :loading="loading" @click="refresh" title="刷新">
        <span v-if="!loading" style="font-size: 13px">&#x21bb;</span>
      </el-button>
    </div>

    <!-- Stats bar -->
    <div class="pack-stats">
      <span class="pack-stats-text"> {{ enabledCount }}/{{ totalCount }} 已启用 </span>
    </div>

    <!-- Error -->
    <div v-if="error" class="pack-error">
      {{ error }}
    </div>

    <!-- Pack list -->
    <div class="pack-list">
      <div v-if="loading && packs.length === 0" class="pack-loading">加载中...</div>

      <div v-else-if="filteredPacks.length === 0 && !loading" class="pack-empty">
        {{ search ? '没有匹配的数据包' : '没有找到数据包' }}
      </div>

      <div
        v-for="pack in filteredPacks"
        :key="pack.folderName"
        class="pack-item"
        :class="{ 'pack-item--disabled': !pack.enabled }"
      >
        <div class="pack-item-main">
          <div class="pack-item-info">
            <div class="pack-item-name">{{ pack.folderName }}</div>
            <div class="pack-item-meta">
              <span class="pack-item-id">{{ pack.id }}</span>
              <span v-if="pack.version" class="pack-item-version">@{{ pack.version }}</span>
              <span v-if="!pack.canDisable" class="ae-badge ae-badge--info">核心</span>
            </div>
          </div>
          <el-switch :model-value="pack.enabled" :disabled="!pack.canDisable" size="small" @change="togglePack(pack)" />
        </div>
      </div>
    </div>

    <!-- Layering visualization -->
    <PackLayeringView :packs="filteredPacks" />

    <!-- Base pack info -->
    <div v-if="basePackDir" class="base-pack-info">
      <div class="base-pack-path" :title="basePackDir">{{ basePackDir }}</div>
      <button type="button" class="base-pack-open" @click="openBasePackDir">在访达中打开</button>
    </div>
  </div>
</template>

<style scoped>
.pack-manager {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: var(--ae-space-2);
  min-height: 0;
  overflow-y: auto;
  font-family:
    var(--ae-font-base),
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
}

/* ── Toolbar ── */
.pack-toolbar {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  margin-bottom: var(--ae-space-2);
}

.pack-search {
  flex: 1;
  min-width: 0;
}

/* ── Stats ── */
.pack-stats {
  display: flex;
  align-items: center;
  padding: var(--ae-space-1) 0;
  margin-bottom: var(--ae-space-1);
  border-bottom: 1px solid var(--ae-border-subtle);
}

.pack-stats-text {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Error ── */
.pack-error {
  padding: var(--ae-space-2);
  margin-bottom: var(--ae-space-2);
  font-size: var(--ae-font-sm);
  color: var(--ae-error);
  background: var(--ae-error-subtle);
  border-radius: var(--ae-radius-sm);
  line-height: 1.4;
}

/* ── Pack list ── */
.pack-list {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-1);
}

.pack-loading,
.pack-empty {
  text-align: center;
  padding: var(--ae-space-4);
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
}

/* ── Pack item ── */
.pack-item {
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  background: var(--ae-bg-elevated);
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    opacity 0.15s ease;
}

.pack-item:hover {
  border-color: var(--ae-border-default);
}

.pack-item--disabled {
  opacity: 0.55;
}

.pack-item--disabled:hover {
  opacity: 0.7;
}

.pack-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ae-space-2);
  padding: var(--ae-space-2);
}

/* ── Pack info ── */
.pack-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.pack-item-name {
  font-size: var(--ae-font-sm);
  font-weight: 500;
  color: var(--ae-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pack-item-meta {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  flex-wrap: wrap;
}

.pack-item-id {
  font-size: 10px;
  color: var(--ae-text-muted);
  font-family: monospace;
}

.pack-item-version {
  font-size: 10px;
  color: var(--ae-text-disabled);
}

/* Base pack info */
.base-pack-info {
  border-top: 1px solid var(--ae-border-subtle);
  padding: var(--ae-space-2) var(--ae-space-3);
  margin-top: var(--ae-space-2);
}

.base-pack-path {
  font-size: 10px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--ae-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: var(--ae-space-1);
}

.base-pack-open {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--ae-space-2);
  font-size: var(--ae-font-xs);
  color: var(--ae-accent-primary);
  background: transparent;
  border: 1px dashed var(--ae-border-default);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  transition: all 0.12s ease;
}

.base-pack-open:hover {
  background: var(--ae-accent-primary-subtle);
  border-color: var(--ae-accent-primary);
}
</style>
