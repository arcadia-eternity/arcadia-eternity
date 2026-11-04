import { beforeEach, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { localDataStorage } from '@/services/localStorage'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthorDrafts, useAuthorDraftStorage, type AuthorDraft } from '../drafts'

function freshPinia() {
  const pinia = createPinia().use(createPersistedState({ storage: localDataStorage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
}
beforeEach(() => {
  localStorage.clear()
  freshPinia()
})
it('isolates projects and restores original versions while clearing only saved files', () => {
  const persisted = useAuthorDraftStorage()
  const draft = (key: string, file: string): AuthorDraft => ({
    key,
    file,
    version: 'original',
    index: 0,
    value: { id: key, name: 'edited' },
    base: { id: key },
    sharedFields: [],
    type: 'record',
    kind: 'skills',
    id: key,
  })
  persisted.projects.a = { one: draft('one', 'one.json'), two: draft('two', 'two.json') }
  const session = useAuthorDrafts(persisted)
  session.activate('a')
  expect(session.drafts.one?.version).toBe('original')
  session.clear(['one.json'])
  session.activate('b')
  expect(session.pending.value).toHaveLength(0)
  session.activate('a')
  expect(session.pending.value.map(row => row.file)).toEqual(['two.json'])
  session.activate('a', true)
  expect(session.pending.value).toHaveLength(0)
  expect(persisted.projects.a?.two).toBeDefined()
  session.activate('a')
  session.clear()
  expect(persisted.projects.a).toEqual({})
})

it('rehydrates after a new app and checks restored bases against external edits', () => {
  const first = useAuthorDrafts(useAuthorDraftStorage())
  first.activate('project')
  first.editRecord(
    {
      kind: 'skills',
      file: 'skills.json',
      version: 'base-version',
      index: 0,
      record: { id: 'skill', name: 'original' },
      sharedFields: [],
    },
    { id: 'skill', name: 'edited' },
  )
  freshPinia()
  const restored = useAuthorDrafts(useAuthorDraftStorage())
  restored.activate('project')
  expect(restored.pending.value[0]?.version).toBe('base-version')
  expect(restored.pending.value[0]?.base).toEqual({ id: 'skill', name: 'original' })
  restored.sync({
    records: [
      {
        kind: 'skills',
        file: 'skills.json',
        version: 'external-version',
        index: 0,
        record: { id: 'skill', name: 'external' },
        sharedFields: [],
      },
    ],
    files: [],
    localeSources: [],
  } as unknown as Parameters<typeof restored.sync>[0])
  expect(restored.conflicts.value).toHaveLength(1)
  expect(restored.pending.value[0]?.value.name).toBe('edited')
  expect(restored.pending.value[0]?.version).toBe('base-version')
})
