import { provide, inject, reactive, type InjectionKey } from 'vue'

export type EntityType = string

export interface EditorTab {
  id: string
  entityType: EntityType
  recordId: string
  label: string
}

export interface PackFilterState {
  enabledPacks: string[]
  activeOnly: boolean
}

export interface EditorState {
  selectedEntityType: EntityType | null
  selectedRecordId: string | null
  packFilters: PackFilterState
  openTabs: EditorTab[]
  activeTabId: string | null
  searchQuery: string
  isDirty: boolean
  // File management
  availableDataFiles: string[]
  selectedDataFile: string | null
  createTargetFile: string | null // null = use default (first file)
  recordSourceFiles: Record<string, string> // recordId → sourceFile
}

const EDITOR_STATE_KEY = Symbol('editor-state') as InjectionKey<EditorState>

export function provideEditorState(): EditorState {
  const state = reactive<EditorState>({
    selectedEntityType: null,
    selectedRecordId: null,
    packFilters: {
      enabledPacks: [],
      activeOnly: false,
    },
    openTabs: [],
    activeTabId: null,
    searchQuery: '',
    isDirty: false,
    availableDataFiles: [],
    selectedDataFile: null,
    createTargetFile: null,
    recordSourceFiles: {},
  })

  provide(EDITOR_STATE_KEY, state)
  return state
}

export function useEditorState(): EditorState {
  const state = inject(EDITOR_STATE_KEY)
  if (!state) {
    throw new Error(
      'useEditorState() called without a parent provideEditorState(). ' +
        'Make sure the component is mounted within a DataEditorPage that calls provideEditorState().',
    )
  }
  return state
}
