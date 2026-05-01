import { useEditorState, type EntityType } from './useEditorState'

export function useEntityNavigation() {
  const state = useEditorState()

  function navigateTo(type: EntityType, id: string) {
    state.selectedEntityType = type
    state.selectedRecordId = id
  }

  function navigateToSpecies(id: string) { navigateTo('species', id) }
  function navigateToSkill(id: string) { navigateTo('skills', id) }
  function navigateToMark(id: string) { navigateTo('marks', id) }
  function navigateToEffect(id: string) { navigateTo('effects', id) }

  return { navigateTo, navigateToSpecies, navigateToSkill, navigateToMark, navigateToEffect }
}
