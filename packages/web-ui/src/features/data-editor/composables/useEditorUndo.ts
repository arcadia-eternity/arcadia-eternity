import { type Ref } from 'vue'
import { useRefHistory } from '@vueuse/core'

export function useEditorUndo(source: Ref<Record<string, unknown>>) {
  const { undo, redo, canUndo, canRedo, clear, commit, history } = useRefHistory(source, {
    capacity: 50,
    deep: true,
  })

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    clear,
    commit,
    history,
  }
}
