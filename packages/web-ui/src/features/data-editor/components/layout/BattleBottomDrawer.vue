<script setup lang="ts">
/**
 * BattleBottomDrawer - Collapsible bottom drawer hosting the BattleWorkbenchController.
 *
 * Replaces the old right-side battle panel. Collapsed: thin 36px handle bar.
 * Expanded: slides up to 40vh showing the full battle controller.
 */
import { ref, computed } from 'vue'
import BattleWorkbenchController from './BattleWorkbenchController.vue'
import { useEditorState } from '@/features/data-editor/composables/useEditorState'

const editorState = useEditorState()

const isExpanded = ref(false)

/** Derive the first enabled pack folder from editor state as the selected pack context. */
const selectedPackFolder = computed(() => {
  return editorState.packFilters.enabledPacks[0] ?? ''
})
</script>

<template>
  <div class="battle-drawer shrink-0 select-none">
    <!-- Handle bar / toggle -->
    <div class="drawer-handle" @click="isExpanded = !isExpanded">
      <span class="drawer-title">⚔️ 战斗控制器</span>
      <span class="drawer-chevron" :class="{ expanded: isExpanded }">▲</span>
    </div>

    <!-- Collapsible content -->
    <div v-show="isExpanded" class="drawer-content">
      <BattleWorkbenchController
        :selected-pack-folder="selectedPackFolder"
        :selected-entry="null"
        :open-tabs="[]"
      />
    </div>
  </div>
</template>

<style scoped>
.battle-drawer {
  background: var(--ae-bg-surface);
  border-top: 1px solid var(--ae-border-subtle);
}

.drawer-handle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 var(--ae-space-4);
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;
}

.drawer-handle:hover {
  background: var(--ae-hover);
}

.drawer-title {
  font-size: var(--ae-font-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ae-text-muted);
}

.drawer-chevron {
  font-size: 12px;
  color: var(--ae-text-muted);
  transition: transform 0.3s ease;
  transform: rotate(0deg);
}

.drawer-chevron.expanded {
  transform: rotate(180deg);
}

.drawer-content {
  height: 40vh;
  overflow: auto;
  border-top: 1px solid var(--ae-border-subtle);
}
</style>
