import { describe, expect, it } from 'vitest'
import { useAuthorDrafts, isConflict } from '../drafts'
import { initialRecord, localeFor, objectType } from '../objects'
import { recordKey } from '../drafts'
import type { AuthorSnapshot, SourceRecord } from '../types'
const record = (kind: string, id: string): SourceRecord => ({
  kind,
  file: `data/${kind}/${id}.yaml`,
  version: 'v1',
  index: null,
  record: { id },
})
const snapshot = (records: SourceRecord[] = []): AuthorSnapshot => ({
  root: '/',
  name: 'test',
  project: { projectId: 'test', namespace: 'test', sdkApi: 2 },
  records,
  files: records.map(row => ({ file: row.file })),
  assets: [],
  locales: {},
  localeSources: [],
  diagnostics: [],
})

describe('independent object drafts', () => {
  it('saves new data and text through the same payload and keeps external occupancy as a conflict', () => {
    const store = useAuthorDrafts(),
      row = { ...record('marks', 'guard'), version: null, record: initialRecord('marks', 'guard') }
    store.createRecord(row)
    const source = localeFor([], row, 'en', [])!
    store.editLocale(source, 'guard', 'marks', { name: 'Guard' })
    store.sync(snapshot())
    expect(store.conflicts.value).toHaveLength(0)
    expect(store.payload().map(item => [item.kind, item.expectedVersion])).toEqual([
      ['create-record', null],
      ['locale', null],
    ])
    const occupied = snapshot()
    occupied.files.push({ file: row.file })
    store.sync(occupied)
    expect(isConflict(store.drafts[recordKey(row)]!)).toBe(true)
    expect(store.drafts[recordKey(row)]!.value.id).toBe('guard')
    // A partial save must leave the locale draft writable after the record reaches disk.
    store.clear([row.file])
    store.sync(snapshot([{ ...row, version: 'saved' }]))
    expect(store.pending.value).toHaveLength(1)
    expect(store.conflicts.value).toHaveLength(0)
  })
  it('retains old version checks and follows moved records only after reconciliation', () => {
    const store = useAuthorDrafts(),
      row = record('skills', 'hit')
    store.editRecord(row, { ...row.record, power: 60 })
    store.sync(snapshot([{ ...row, file: 'data/skills/elsewhere.yaml', version: 'v2' }]))
    expect(store.conflicts.value).toHaveLength(1)
    expect(store.payload()[0]).toMatchObject({ file: row.file, expectedVersion: 'v1', record: { power: 60 } })
  })
  it('keeps ability/emblem namespaces and blocks malformed or ambiguous locale files', () => {
    const row = { ...record('marks', 'passive'), record: initialRecord('ability', 'passive') }
    expect(objectType(row)).toBe('ability')
    expect(localeFor([], row, 'en', [])?.namespace).toBe('mark_ability')
    expect(localeFor([], row, 'en', ['locales/en/mark_ability.json'])).toBeUndefined()
    expect(localeFor([], row, '../en', [])).toBeUndefined()
  })
})
