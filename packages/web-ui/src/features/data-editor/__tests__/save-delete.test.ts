import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, reactive } from 'vue'
import type { EditorState } from '../composables/useEditorState'
import { useSaveHandlers } from '../composables/useSaveHandlers'

vi.mock('@/services/packWorkspace', () => ({
  readWorkspacePackManifest: vi.fn().mockResolvedValue({
    manifest: { paths: { dataDir: '.' } },
  }),
  writeWorkspacePackFile: vi.fn().mockResolvedValue(undefined),
  readWorkspacePackFile: vi.fn().mockResolvedValue({
    content:
      '- id: test_species\n  num: 0\n  element: Normal\n  baseStats:\n    hp: 100\n    atk: 100\n    spa: 100\n    def: 100\n    spd: 100\n    spe: 100\n  genderRatio: [50, 50]\n  heightRange: [10, 20]\n  weightRange: [10, 20]\n  learnable_skills: []\n  ability: []\n  emblem: []',
  }),
  listWorkspacePacks: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/utils/env', () => ({
  isDesktop: true,
  getDesktopApi: () => null,
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
}))

const mockReadBasePackFile = vi.fn()
const mockWriteBasePackFile = vi.fn().mockResolvedValue(undefined)
const mockReadAllBasePackData = vi.fn().mockResolvedValue({})

vi.stubGlobal('window', {
  ...globalThis.window,
  arcadiaDesktop: {
    readBasePackFile: mockReadBasePackFile,
    writeBasePackFile: mockWriteBasePackFile,
    readAllBasePackData: mockReadAllBasePackData,
  },
})

function createEditorState(overrides?: Partial<EditorState>): EditorState {
  return reactive({
    selectedEntityType: null,
    selectedRecordId: null,
    packFilters: { enabledPacks: [], activeOnly: false },
    openTabs: [],
    activeTabId: null,
    searchQuery: '',
    isDirty: false,
    ...overrides,
  }) as EditorState
}

function createGameDataStore() {
  return {
    species: { byId: {} as Record<string, unknown>, allIds: [] as string[] },
    skills: { byId: {} as Record<string, unknown>, allIds: [] as string[] },
    marks: { byId: {} as Record<string, unknown>, allIds: [] as string[] },
    effects: { byId: {} as Record<string, unknown>, allIds: [] as string[] },
  }
}

const EFFECT_YAML = '- id: test_effect\n  trigger: []\n  priority: 0\n  apply:\n    type: TODO\n  tags: []'

let writeWorkspacePackFile: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('@/services/packWorkspace')
  writeWorkspacePackFile = (mod as { writeWorkspacePackFile: ReturnType<typeof vi.fn> }).writeWorkspacePackFile

  mockReadBasePackFile.mockImplementation(({ relativePath }: { relativePath: string }) => {
    if (relativePath === 'pack.json') {
      return Promise.resolve({ content: '{"paths":{"dataDir":"."}}' })
    }
    return Promise.resolve({ content: EFFECT_YAML })
  })
  mockWriteBasePackFile.mockResolvedValue(undefined)
})

describe('useSaveHandlers', () => {
  it('doSave: skips when no entity type selected', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const draftRef = ref<Record<string, unknown>>({ id: 'some_id' })
    const editorState = createEditorState({ selectedEntityType: null, selectedRecordId: 'some_id' })
    const gameDataStore = createGameDataStore()
    const { doSave } = useSaveHandlers({ draftRef, editorState, gameDataStore })

    await doSave()

    expect(warnSpy).toHaveBeenCalledWith('[DataEditor] Save skipped: no entity type or record selected')
    warnSpy.mockRestore()
  })

  it('doSave: skips when draft is empty', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const draftRef = ref<Record<string, unknown>>({})
    const editorState = createEditorState({
      selectedEntityType: 'species',
      selectedRecordId: 'test_id',
    })
    const gameDataStore = createGameDataStore()
    const { doSave } = useSaveHandlers({ draftRef, editorState, gameDataStore })

    await doSave()

    expect(warnSpy).toHaveBeenCalledWith('[DataEditor] Save skipped: empty draft')
    warnSpy.mockRestore()
  })

  it('doSave: successfully saves to base pack (effects)', async () => {
    const draftRef = ref<Record<string, unknown>>({
      id: 'test_effect',
      trigger: [],
      priority: 0,
      apply: { type: 'TODO' },
      tags: [],
    })
    const editorState = createEditorState({
      selectedEntityType: 'effects',
      selectedRecordId: 'test_effect',
      packFilters: { enabledPacks: ['base'], activeOnly: false },
    })
    const gameDataStore = createGameDataStore()
    const { doSave } = useSaveHandlers({ draftRef, editorState, gameDataStore })

    await doSave()

    expect(mockWriteBasePackFile).toHaveBeenCalled()
    expect(mockReadBasePackFile).toHaveBeenCalledWith({
      folderName: 'base',
      relativePath: 'pack.json',
    })
  })

  it('doSave: successfully saves to workspace pack (species)', async () => {
    const draftRef = ref<Record<string, unknown>>({
      id: 'test_species',
      num: 0,
      element: 'Normal',
      baseStats: { hp: 100, atk: 100, spa: 100, def: 100, spd: 100, spe: 100 },
      genderRatio: [50, 50],
      heightRange: [10, 20],
      weightRange: [10, 20],
      learnable_skills: [],
      ability: [],
      emblem: [],
    })
    const editorState = createEditorState({
      selectedEntityType: 'species',
      selectedRecordId: 'test_species',
      packFilters: { enabledPacks: ['custom-pack'], activeOnly: false },
    })
    const gameDataStore = createGameDataStore()
    const { doSave } = useSaveHandlers({ draftRef, editorState, gameDataStore })

    await doSave()

    expect(writeWorkspacePackFile).toHaveBeenCalled()
    expect(mockWriteBasePackFile).not.toHaveBeenCalled()
  })

  it('doSave: handles save failure gracefully', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    writeWorkspacePackFile.mockRejectedValueOnce(new Error('disk full'))

    const draftRef = ref<Record<string, unknown>>({
      id: 'test_species',
      num: 0,
      element: 'Normal',
      baseStats: { hp: 100, atk: 100, spa: 100, def: 100, spd: 100, spe: 100 },
      genderRatio: [50, 50],
      heightRange: [10, 20],
      weightRange: [10, 20],
      learnable_skills: [],
      ability: [],
      emblem: [],
    })
    const editorState = createEditorState({
      selectedEntityType: 'species',
      selectedRecordId: 'test_species',
      packFilters: { enabledPacks: ['custom-pack'], activeOnly: false },
    })
    const gameDataStore = createGameDataStore()
    const { doSave } = useSaveHandlers({ draftRef, editorState, gameDataStore })

    await doSave()

    expect(errorSpy).toHaveBeenCalledWith('[DataEditor] File save failed:', expect.any(Error))
    errorSpy.mockRestore()
  })

  it('doDelete: successfully deletes from base pack', async () => {
    const draftRef = ref<Record<string, unknown>>({})
    const editorState = createEditorState({
      selectedEntityType: 'effects',
      selectedRecordId: 'test_effect',
      packFilters: { enabledPacks: ['base'], activeOnly: false },
    })
    const gameDataStore = createGameDataStore()
    const { doDelete } = useSaveHandlers({ draftRef, editorState, gameDataStore })

    await doDelete()

    expect(mockWriteBasePackFile).toHaveBeenCalled()
  })
})
