<script setup lang="ts">
/**
 * PackLayeringView - Visual stack showing pack layering priority.
 *
 * Renders packs as stacked cards (top = highest priority).
 * Uses workspaceRuntime from gameData store to show actual layer info.
 * Disabled packs are visually dimmed.
 */
import { computed } from 'vue'
import { useGameDataStore } from '@/stores/gameData'
import type { WorkspacePackSummary } from '@/services/packWorkspace'

const props = defineProps<{
  packs: WorkspacePackSummary[]
}>()

const gameData = useGameDataStore()

const layerOrder = computed(() => gameData.workspaceRuntime.order)

const layeredPacks = computed(() => {
  const layerSet = new Set(layerOrder.value)
  const runtimeLayers = gameData.workspaceRuntime.layers

  // Packs with runtime layers, sorted by layer order (index 0 = bottom)
  const withLayers: {
    folderName: string
    id: string
    version: string
    enabled: boolean
    isBase: boolean
    recordCount: number
    layerIndex: number
  }[] = []

  for (let i = 0; i < layerOrder.value.length; i++) {
    const folderName = layerOrder.value[i]
    const layer = runtimeLayers[folderName]
    const pack = props.packs.find(p => p.folderName === folderName)
    const recordCount = layer
      ? (Object.keys(layer.species ?? {}).length + Object.keys(layer.skills ?? {}).length + Object.keys(layer.marks ?? {}).length + Object.keys(layer.effects ?? {}).length)
      : 0

    withLayers.push({
      folderName,
      id: pack?.id ?? folderName,
      version: pack?.version ?? '',
      enabled: pack?.enabled ?? true,
      isBase: pack?.canDisable === false,
      recordCount,
      layerIndex: i,
    })
  }

  // Packs not yet loaded into runtime but present in pack list
  for (const pack of props.packs) {
    if (!layerSet.has(pack.folderName)) {
      withLayers.push({
        folderName: pack.folderName,
        id: pack.id,
        version: pack.version,
        enabled: pack.enabled,
        isBase: pack.canDisable === false,
        recordCount: 0,
        layerIndex: -1,
      })
    }
  }

  // Render top→bottom: highest index first
  return [...withLayers].sort((a, b) => b.layerIndex - a.layerIndex)
})

const activeLayerCount = computed(() => layerOrder.value.length)
</script>

<template>
  <div class="pack-layering">
    <div class="layering-header">
      <span class="layering-title">图层顺序</span>
      <span class="layering-count">{{ activeLayerCount }} 层</span>
    </div>

    <div v-if="layeredPacks.length === 0" class="layering-empty">
      暂无数据包
    </div>

    <div v-else class="layering-stack">
      <div class="layering-label-row">
        <span class="layering-label-hint">↑ 最高优先级</span>
      </div>

      <div
        v-for="(pack, idx) in layeredPacks"
        :key="pack.folderName"
        class="layer-card"
        :class="{
          'layer-card--disabled': !pack.enabled,
          'layer-card--base': pack.isBase,
          'layer-card--top': idx === 0 && layeredPacks.length > 1,
          'layer-card--bottom': idx === layeredPacks.length - 1 && layeredPacks.length > 1,
        }"
      >
        <div class="layer-card-inner">
          <div class="layer-index">{{ pack.layerIndex >= 0 ? pack.layerIndex : '—' }}</div>
          <div class="layer-info">
            <span class="layer-name">{{ pack.id }}</span>
            <span v-if="pack.version" class="layer-version">v{{ pack.version }}</span>
          </div>
          <span
            v-if="pack.isBase"
            class="ae-badge ae-badge--info"
          >核心</span>
          <span
            v-else-if="!pack.enabled"
            class="ae-badge ae-badge--muted"
          >已禁用</span>
          <span
            v-else
            class="ae-badge ae-badge--success"
          >启用</span>
          <span v-if="pack.recordCount > 0" class="layer-records">{{ pack.recordCount }} 条</span>
        </div>

        <!-- Connector line between layers -->
        <div
          v-if="idx < layeredPacks.length - 1"
          class="layer-connector"
        />
      </div>

      <div class="layering-label-row">
        <span class="layering-label-hint">↓ 最低优先级</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pack-layering {
  margin-top: var(--ae-space-3);
}

.layering-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ae-space-1) 0;
  margin-bottom: var(--ae-space-2);
}

.layering-title {
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.layering-count {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-variant-numeric: tabular-nums;
}

.layering-empty {
  text-align: center;
  padding: var(--ae-space-4);
  font-size: var(--ae-font-sm);
  color: var(--ae-text-disabled);
}

.layering-label-row {
  display: flex;
  justify-content: center;
  padding: var(--ae-space-1) 0;
}

.layering-label-hint {
  font-size: 10px;
  color: var(--ae-text-disabled);
  letter-spacing: 0.03em;
}

/* ── Layer stack ── */
.layering-stack {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Individual layer card ── */
.layer-card {
  position: relative;
}

.layer-card-inner {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding: var(--ae-space-2) var(--ae-space-2);
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-default);
  border-radius: var(--ae-radius-sm);
  transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}

.layer-card--top .layer-card-inner {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.layer-card--bottom .layer-card-inner {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.layer-card:not(.layer-card--top):not(.layer-card--bottom) .layer-card-inner {
  border-radius: 0;
}

.layer-card:not(.layer-card--top) .layer-card-inner {
  border-top-color: transparent;
}

/* ── Disabled state ── */
.layer-card--disabled .layer-card-inner {
  opacity: 0.45;
  border-style: dashed;
}

/* ── Base pack ── */
.layer-card--base .layer-card-inner {
  background: var(--ae-bg-overlay);
  border-color: var(--ae-border-strong);
}

/* ── Layer index ── */
.layer-index {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 10px;
  font-weight: 600;
  color: var(--ae-text-muted);
  background: var(--ae-bg-surface);
  border-radius: var(--ae-radius-sm);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* ── Layer info ── */
.layer-info {
  display: flex;
  align-items: baseline;
  gap: var(--ae-space-1);
  flex: 1;
  min-width: 0;
}

.layer-name {
  font-size: var(--ae-font-sm);
  font-weight: 500;
  color: var(--ae-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-version {
  font-size: 10px;
  color: var(--ae-text-disabled);
  flex-shrink: 0;
}

/* ── Record count ── */
.layer-records {
  font-size: 10px;
  color: var(--ae-text-disabled);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ── Connector between cards ── */
.layer-connector {
  position: absolute;
  left: 16px;
  bottom: -1px;
  width: 1px;
  height: 1px;
  background: transparent;
}
</style>
