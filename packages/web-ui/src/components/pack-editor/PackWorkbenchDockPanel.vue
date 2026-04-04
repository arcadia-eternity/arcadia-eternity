<template>
  <div class="h-full overflow-auto bg-[#f7f8fa] p-4">
    <el-empty v-if="!resolvedEditor" description="无法识别该文件的编辑器" :image-size="88" />
    <component
      v-else
      :is="resolvedEditor.component"
      :key="panelKey"
      v-bind="resolvedEditor.props"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  resolvePackWorkbenchEditor,
  type PackWorkbenchFileEntry,
  type PackWorkbenchResolvedEditor,
} from '@/components/pack-editor/workbenchEditorRegistry'

type EditorPanelPayload = {
  packFolder: string
  entry: PackWorkbenchFileEntry
  onSaved?: (payload: { packFolder: string; entry: PackWorkbenchFileEntry }) => void | Promise<void>
}

const props = defineProps<{
  panelContext?: {
    params?: EditorPanelPayload
  } | null
  params?: {
    params?: EditorPanelPayload
  } | null
}>()

const emit = defineEmits<{
  saved: [payload: EditorPanelPayload]
}>()

const payload = computed<EditorPanelPayload | null>(() => {
  const value = props.panelContext?.params ?? props.params?.params
  if (!value) return null
  if (!value.packFolder || !value.entry?.key) return null
  return value
})

const resolvedEditor = computed<PackWorkbenchResolvedEditor | null>(() => {
  if (!payload.value) return null
  return resolvePackWorkbenchEditor({
    packFolder: payload.value.packFolder,
    entry: payload.value.entry,
  })
})

const panelKey = computed(() => {
  if (!payload.value || !resolvedEditor.value) return 'pack-editor-panel'
  return `${resolvedEditor.value.id}:${payload.value.entry.key}`
})

function handleSaved(): void {
  if (!payload.value) return
  if (typeof payload.value.onSaved === 'function') {
    void payload.value.onSaved({
      packFolder: payload.value.packFolder,
      entry: payload.value.entry,
    })
  }
  emit('saved', payload.value)
}
</script>
