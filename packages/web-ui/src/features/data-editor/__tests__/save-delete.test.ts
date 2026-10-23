import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, reactive } from 'vue'
import { parse } from 'yaml'
import { ElMessage } from 'element-plus'
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
    availableDataFiles: [],
    selectedDataFile: null,
    createTargetFile: null,
    recordSourceFiles: {},
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
      return Promise.resolve({
        content: '{"paths":{"dataDir":"."},"data":{"effects":["effect_skill.yaml"],"species":["species.yaml"]}}',
      })
    }
    return Promise.resolve({ content: EFFECT_YAML })
  })
  mockWriteBasePackFile.mockResolvedValue(undefined)
  mockReadAllBasePackData.mockResolvedValue({})
})

function serveGroupedSpecies() {
  const fileRefs = ['groups/dilan/species.yaml', 'groups/yilu/species.yaml']
  const contents: Record<string, string> = {
    'pack.json': JSON.stringify({ paths: { dataDir: 'data' }, data: { species: fileRefs } }),
    'data/groups/dilan/species.yaml': '- id: pet_dilan\n- id: pet_didilan\n',
    'data/groups/yilu/species.yaml': '- id: pet_yilu\n- id: pet_yiluxin\n',
  }
  mockReadBasePackFile.mockImplementation(async ({ relativePath }: { relativePath: string }) => {
    if (!(relativePath in contents)) throw new Error(`Missing file: ${relativePath}`)
    return { content: contents[relativePath] }
  })
  mockWriteBasePackFile.mockImplementation(
    async ({ relativePath, content }: { relativePath: string; content: string }) => {
      contents[relativePath] = content
    },
  )
  return { contents, fileRefs }
}

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

  it('doCreate: uses the selected nested file and remembers its actual source', async () => {
    const { contents, fileRefs } = serveGroupedSpecies()
    const editorState = createEditorState({
      selectedEntityType: 'species',
      selectedDataFile: fileRefs[1],
      createTargetFile: fileRefs[0],
      availableDataFiles: fileRefs,
      packFilters: { enabledPacks: ['base'], activeOnly: false },
    })
    const draftRef = ref<Record<string, unknown>>({})
    const gameDataStore = createGameDataStore()
    const { doCreate } = useSaveHandlers({ draftRef, editorState, gameDataStore })

    await doCreate()

    const id = editorState.selectedRecordId!
    expect(mockWriteBasePackFile).toHaveBeenCalledExactlyOnceWith({
      folderName: 'base',
      relativePath: 'data/groups/yilu/species.yaml',
      content: expect.any(String),
    })
    expect(editorState.recordSourceFiles[id]).toBe('data/groups/yilu/species.yaml')
    expect(parse(contents['data/groups/yilu/species.yaml']).map((record: { id: string }) => record.id)).toContain(id)
    expect(contents['data/groups/dilan/species.yaml']).toBe('- id: pet_dilan\n- id: pet_didilan\n')
  })

  it('doCreate: an explicitly selected target takes precedence over the file filter', async () => {
    const { fileRefs } = serveGroupedSpecies()
    const editorState = createEditorState({
      selectedEntityType: 'species',
      selectedDataFile: fileRefs[1],
      availableDataFiles: fileRefs,
      packFilters: { enabledPacks: ['base'], activeOnly: false },
    })
    const { doCreate } = useSaveHandlers({ draftRef: ref({}), editorState, gameDataStore: createGameDataStore() })

    await doCreate({ targetFile: fileRefs[0] })

    expect(mockWriteBasePackFile).toHaveBeenCalledExactlyOnceWith({
      folderName: 'base',
      relativePath: 'data/groups/dilan/species.yaml',
      content: expect.any(String),
    })
    expect(editorState.recordSourceFiles[editorState.selectedRecordId!]).toBe('data/groups/dilan/species.yaml')
  })

  it('doBatchDelete: writes every selected file and preserves unselected records', async () => {
    const { contents } = serveGroupedSpecies()
    const editorState = createEditorState({
      selectedEntityType: 'species',
      selectedRecordId: 'pet_yilu',
      packFilters: { enabledPacks: ['base'], activeOnly: false },
      recordSourceFiles: { pet_dilan: 'data/groups/dilan/species.yaml', pet_yilu: 'data/groups/yilu/species.yaml' },
    })
    const gameDataStore = createGameDataStore()
    const allIds = ['pet_dilan', 'pet_didilan', 'pet_yilu', 'pet_yiluxin']
    gameDataStore.species = { allIds, byId: Object.fromEntries(allIds.map(id => [id, { id }])) }
    const { doBatchDelete } = useSaveHandlers({ draftRef: ref({}), editorState, gameDataStore })

    await doBatchDelete(['pet_dilan', 'pet_yilu'])

    expect(mockWriteBasePackFile.mock.calls.map(([call]) => call.relativePath)).toEqual([
      'data/groups/dilan/species.yaml',
      'data/groups/yilu/species.yaml',
    ])
    expect(parse(contents['data/groups/dilan/species.yaml'])).toEqual([{ id: 'pet_didilan' }])
    expect(parse(contents['data/groups/yilu/species.yaml'])).toEqual([{ id: 'pet_yiluxin' }])
    expect(gameDataStore.species.allIds).toEqual(['pet_didilan', 'pet_yiluxin'])
    expect(editorState.selectedRecordId).toBeNull()
    expect(editorState.recordSourceFiles).toEqual({})
    expect(ElMessage.success).toHaveBeenCalledWith('已删除 2 条记录')
  })

  it('doBatchDelete: a later write failure keeps unwritten records and their selection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { contents } = serveGroupedSpecies()
    mockWriteBasePackFile.mockImplementation(
      async ({ relativePath, content }: { relativePath: string; content: string }) => {
        if (relativePath === 'data/groups/yilu/species.yaml') throw new Error('disk full')
        contents[relativePath] = content
      },
    )
    const editorState = createEditorState({
      selectedEntityType: 'species',
      selectedRecordId: 'pet_yilu',
      packFilters: { enabledPacks: ['base'], activeOnly: false },
      recordSourceFiles: { pet_dilan: 'data/groups/dilan/species.yaml', pet_yilu: 'data/groups/yilu/species.yaml' },
    })
    const gameDataStore = createGameDataStore()
    const allIds = ['pet_dilan', 'pet_yilu']
    gameDataStore.species = { allIds, byId: Object.fromEntries(allIds.map(id => [id, { id }])) }
    const { doBatchDelete } = useSaveHandlers({ draftRef: ref({}), editorState, gameDataStore })

    await doBatchDelete(allIds)

    expect(parse(contents['data/groups/dilan/species.yaml'])).toEqual([{ id: 'pet_didilan' }])
    expect(parse(contents['data/groups/yilu/species.yaml'])).toEqual([{ id: 'pet_yilu' }, { id: 'pet_yiluxin' }])
    expect(gameDataStore.species.allIds).toEqual(['pet_yilu'])
    expect(gameDataStore.species.byId).toEqual({ pet_yilu: { id: 'pet_yilu' } })
    expect(editorState.selectedRecordId).toBe('pet_yilu')
    expect(editorState.recordSourceFiles).toEqual({ pet_yilu: 'data/groups/yilu/species.yaml' })
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith('已删除 1 条记录，其余未完成: disk full')
    errorSpy.mockRestore()
  })
})
