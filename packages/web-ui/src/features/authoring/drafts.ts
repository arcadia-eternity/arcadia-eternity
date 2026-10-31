import { computed, reactive } from 'vue'
import type { Json } from '@arcadia-eternity/pack-loader/native'
import { clone, equal, changes, setField, sharedAt, sharedFieldsUnder, type FieldChange } from './fields'
import type { AuthorSnapshot, ContentRow, LocaleSource, LocaleText, SharedField, SourceRecord } from './types'

export const recordKey = (row: Pick<SourceRecord, 'kind' | 'record'>) =>
  JSON.stringify(['record', row.kind, row.record.id])
export const localeKey = (source: LocaleSource, id: string) =>
  JSON.stringify(['locale', source.language, source.namespace, id])
export interface DraftSource {
  file: string
  version: string | null
  index: number | null
  value: Record<string, Json>
  sharedFields: SharedField[]
}
export interface AuthorDraft extends DraftSource {
  key: string
  type: 'record' | 'locale'
  kind: string
  id: string
  language?: string
  namespace?: string
  base: Record<string, Json>
  created?: boolean
  latest?: DraftSource
}
const recordSource = (row: SourceRecord): DraftSource => ({
  file: row.file,
  version: row.version,
  index: row.index,
  value: clone(row.record),
  sharedFields: row.sharedFields ?? [],
})
const localeSource = (source: LocaleSource, id: string): DraftSource => ({
  file: source.file,
  version: source.version,
  index: null,
  value: clone(Object.hasOwn(source.entries, id) ? source.entries[id] : {}) as Record<string, Json>,
  sharedFields: sharedFieldsUnder(source.sharedFields, [id]),
})
export const isConflict = (draft: AuthorDraft) =>
  !draft.latest ||
  draft.latest.version !== draft.version ||
  draft.latest.file !== draft.file ||
  draft.latest.index !== draft.index
export const reviewToken = (draft: AuthorDraft) =>
  JSON.stringify(draft.latest ? [draft.latest.file, draft.latest.version, draft.latest.index] : null)
export const decisionKey = (draft: AuthorDraft, field: FieldChange) => JSON.stringify([draft.key, field.path])

export function useAuthorDrafts() {
  const drafts = reactive<Record<string, AuthorDraft>>({})
  const pending = computed(() => Object.values(drafts))
  const conflicts = computed(() => pending.value.filter(isConflict))
  function put(draft: AuthorDraft) {
    if (equal(draft.base, draft.value)) delete drafts[draft.key]
    else drafts[draft.key] = draft
  }
  function editRecord(row: SourceRecord, record: ContentRow) {
    const key = recordKey(row),
      source = recordSource(row)
    put({
      ...(drafts[key] ?? {
        ...source,
        key,
        type: 'record',
        kind: row.kind,
        id: row.record.id,
        base: clone(source.value),
        latest: source,
      }),
      value: clone(record),
    })
  }
  function createRecord(row: SourceRecord) {
    const key = recordKey(row)
    if (drafts[key]) throw new Error('此对象已有草稿')
    const source = recordSource(row)
    put({ ...source, key, type: 'record', kind: row.kind, id: row.record.id, created: true, base: {}, latest: source })
  }
  function editLocale(source: LocaleSource, id: string, kind: string, text: LocaleText) {
    const key = localeKey(source, id),
      current = localeSource(source, id)
    put({
      ...(drafts[key] ?? {
        ...current,
        key,
        type: 'locale',
        kind,
        id,
        language: source.language,
        namespace: source.namespace,
        base: clone(current.value),
        latest: current,
      }),
      value: clone(text) as Record<string, Json>,
    })
  }
  function sync(snapshot: AuthorSnapshot) {
    for (const draft of pending.value) {
      if (draft.type === 'record') {
        const matches = snapshot.records.filter(row => row.kind === draft.kind && row.record.id === draft.id)
        draft.latest = draft.created
          ? !matches.length && !snapshot.files.some(file => file.file === draft.file)
            ? { file: draft.file, version: null, index: null, value: {}, sharedFields: [] }
            : undefined
          : matches.length === 1
            ? recordSource(matches[0]!)
            : undefined
      } else {
        const sources = snapshot.localeSources.filter(
          source => source.language === draft.language && source.namespace === draft.namespace,
        )
        const objects = snapshot.records.filter(row => row.kind === draft.kind && row.record.id === draft.id)
        const creating = drafts[recordKey({ kind: draft.kind, record: { id: draft.id } })]?.created
        draft.latest =
          objects.length + Number(!!creating) === 1
            ? sources.length === 1
              ? localeSource(sources[0]!, draft.id)
              : !sources.length && draft.version === null && !snapshot.files.some(file => file.file === draft.file)
                ? { file: draft.file, version: null, index: null, value: {}, sharedFields: [] }
                : undefined
            : undefined
      }
    }
  }
  function reconcile(decisions: Record<string, string>, reviewed: Record<string, string>) {
    const prepared: AuthorDraft[] = []
    for (const draft of conflicts.value) {
      if (!draft.latest) throw new Error('来源缺失或存在重复对象。请在外部修复，草稿会继续保留。')
      if (reviewed[draft.key] !== reviewToken(draft)) throw new Error('核对期间来源再次变化，请重新选择。')
      const next = clone(draft.latest.value)
      for (const field of changes(draft.base, draft.value)) {
        const choice = decisions[decisionKey(draft, field)]
        if (!['draft', 'latest'].includes(choice ?? '')) throw new Error('请为每一项草稿修改选择保留的值。')
        if (choice === 'draft') {
          if (sharedAt(draft.latest.sharedFields, field.path))
            throw new Error('此字段现在属于共享配置，只能采用外部值或在外部编辑。')
          setField(next, field.path, field.after)
        }
      }
      prepared.push({
        ...draft,
        ...clone(draft.latest),
        base: clone(draft.latest.value),
        value: next,
        latest: clone(draft.latest),
      })
    }
    prepared.forEach(put)
  }
  function clear(files?: string[]) {
    for (const draft of pending.value) if (!files || files.includes(draft.file)) delete drafts[draft.key]
  }
  function payload() {
    return pending.value.map(draft => ({
      kind: draft.created ? 'create-record' : draft.type,
      file: draft.file,
      expectedVersion: draft.version,
      index: draft.index,
      id: draft.id,
      record: clone(draft.value),
    }))
  }
  return { drafts, pending, conflicts, createRecord, editRecord, editLocale, sync, reconcile, clear, payload }
}
