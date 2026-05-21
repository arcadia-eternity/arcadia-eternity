import { type Ref } from 'vue'
import { useRefHistory, debounceFilter } from '@vueuse/core'

/**
 * Debounce interval for history commits (ms).
 * Rapid successive changes within this window are batched into a single undo step.
 */
const HISTORY_DEBOUNCE_MS = 300

export function useEditorUndo(source: Ref<Record<string, unknown>>) {
  const { undo, redo, canUndo, canRedo, clear, commit, history } = useRefHistory(source, {
    capacity: 50,
    deep: false,
    eventFilter: debounceFilter(HISTORY_DEBOUNCE_MS),
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
