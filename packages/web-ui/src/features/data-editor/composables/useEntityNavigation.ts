import { useEditorState } from './useEditorState'

export function useEntityNavigation() {
  const state = useEditorState()

  function navigateTo(type: string, id: string) {
    state.selectedEntityType = type
    state.selectedRecordId = id
  }

  return { navigateTo }
}
