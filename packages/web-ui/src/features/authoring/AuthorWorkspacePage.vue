<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import ObjectIcon from './ObjectIcon.vue'
import RecordForm from './RecordForm.vue'
import LocaleFields from './LocaleFields.vue'
import ChangeReview from './ChangeReview.vue'
import SourceMediaPreview from './SourceMediaPreview.vue'
import AssistantPanel from './AssistantPanel.vue'
import { contentTypes, objectType, initialRecord, localeFor } from './objects'
import { relatedKeys, type AssistantContext, type AssistantProposal, type ReviewedProposal } from './assistant'
import { readResourceBytes } from '@/services/resourceTransport'
import AuthorDescription, { descriptionProblem } from './AuthorDescription'
import { useAuthorDrafts, isConflict, recordKey, reviewToken, type AuthorDraft } from './drafts'
import { atField, clone, object, setField, sharedAt, sharedFieldsUnder } from './fields'
import type { Json } from '@arcadia-eternity/pack-loader/native'
import { consumers, resourcePaths, textSource } from './catalog'
import {
  authorCall,
  type AuthorSnapshot,
  type SourceRecord,
  type SourceProject,
  type ContentRow,
  type LocaleText,
  type AuthorJob,
} from './types'

const projects = ref<SourceProject[]>([]),
  project = ref<SourceProject>(),
  snapshot = ref<AuthorSnapshot>()
const store = useAuthorDrafts(),
  { drafts, pending, conflicts } = store
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  name = ref(''),
  search = ref('')
const tab = ref('all'),
  selectedId = ref(''),
  section = ref<'base' | 'references' | 'media'>('base')
const screen = ref<'editor' | 'save' | 'conflict' | 'discard' | 'create'>('editor')
const picked = ref<string[]>([]),
  recent = ref<string[]>([]),
  localeScope = ref<string[] | null>(null)
const newType = ref('skills'),
  newName = ref(''),
  newId = ref(''),
  newFile = ref('')
const createRelation = ref<{ row: SourceRecord; slot: string }>()
const copyFrom = ref<ContentRow>()
const copyMediaFrom = ref<ContentRow>()
const assistantKeys = ref<string[]>([]),
  assistantSession = ref(0),
  assistantContext = ref<AssistantContext>()
const languageInput = ref('')
const projectSettingsOpen = ref(false)
const readOnly = computed(() => snapshot.value?.capabilities?.sourceEditing === false)
const libraryLimit = ref(60)
watch([tab, search], () => {
  libraryLimit.value = 60
})
const assistantProposals = shallowRef<ReviewedProposal[]>([])
const locale = ref(localStorage.getItem('arcadia-author-locale') || 'zh-CN')
const editor = ref(localStorage.getItem('arcadia-author-editor') || 'code'),
  assistantExecution = ref(false)
const jobs = ref<AuthorJob[]>([]),
  choices = ref<Record<string, string>>({}),
  reviewed = ref<Record<string, string>>({})
const history = ref<{ kind: string; id: string; section: 'base' | 'references' | 'media' }[]>([])
const selectedAssetId = ref('')
const asset = ref<{ file: string; bytes: Uint8Array }>(),
  assetLoading = ref(false)
const jobTitles: Record<string, string> = { check: '检查', test: '场景测试', demo: '演示对战', pack: '打包' }
const tabs: Record<string, string> = {
  ...contentTypes,
  assets: '资源',
  locales: '多语言',
  effects: '效果代码',
  tests: '检查与运行',
  assistant: 'AI 协作',
  tools: '工具接入',
}
const visibleTabs = computed(() =>
  Object.fromEntries(
    Object.entries(tabs).filter(([key]) => !readOnly.value || !['assistant', 'tests', 'effects'].includes(key)),
  ),
)
let epoch = 0,
  mediaEpoch = 0,
  disposed = false,
  unsubscribe: (() => void) | undefined
let timer: ReturnType<typeof setInterval>,
  refreshTimer: ReturnType<typeof setTimeout>,
  mediaController: AbortController | undefined
let reviewedPayload = ''
const dirty = computed(() => pending.value.length > 0)
const pendingFiles = computed(() => [...new Set(pending.value.map(draft => draft.file))])
const projectId = computed(() => snapshot.value?.project.projectId ?? '')
const keyFor = (kind: string, id: string) => recordKey({ kind, record: { id } })
const effectiveRecords = computed<SourceRecord[]>(() =>
  [
    ...(snapshot.value?.records ?? []),
    ...pending.value
      .filter(draft => draft.created)
      .map(draft => ({
        kind: draft.kind,
        file: draft.file,
        index: null,
        version: null,
        record: draft.value as ContentRow,
      })),
  ].map(row => ({
    ...row,
    record: (drafts[recordKey(row)]?.value ?? row.record) as ContentRow,
  })),
)
const selected = computed<SourceRecord | undefined>(() => {
  const found =
    snapshot.value?.records.filter(row => row.kind === tab.value && row.record.id === selectedId.value) ?? []
  if (found.length === 1) return found[0]
  const draft = drafts[keyFor(tab.value, selectedId.value)]
  return draft
    ? {
        kind: draft.kind,
        file: draft.file,
        index: draft.index,
        version: draft.version,
        record: (draft.created ? draft.value : draft.base) as ContentRow,
        sharedFields: draft.sharedFields,
      }
    : undefined
})
const currentDraft = computed(() => (selected.value ? drafts[recordKey(selected.value)] : undefined))
function openDraft(draft: AuthorDraft) {
  if (draft.kind === 'presentations' && object(draft.value.target)) {
    navigate(String(draft.value.target.kind), String(draft.value.target.id))
    section.value = 'media'
  } else if (draft.kind === 'resources') {
    tab.value = 'assets'
    search.value = draft.id
  } else navigate(draft.kind, draft.id)
  if (draft.language) locale.value = draft.language
}
const currentRecord = computed(() =>
  selected.value ? ((currentDraft.value?.value ?? selected.value.record) as ContentRow) : undefined,
)
const languages = computed(() => [
  ...new Set([
    locale.value,
    ...(snapshot.value?.localeSources ?? []).map(source => source.language),
    ...pending.value.flatMap(draft => (draft.language ? [draft.language] : [])),
  ]),
])
const defaultLanguage = computed(() =>
  snapshot.value?.localeSources.some(source => source.language === 'zh-CN')
    ? 'zh-CN'
    : (snapshot.value?.localeSources[0]?.language ?? 'zh-CN'),
)
function localized(row: SourceRecord, language: string): LocaleText {
  const pendingText = pending.value.find(
    draft =>
      draft.type === 'locale' && draft.kind === row.kind && draft.id === row.record.id && draft.language === language,
  )
  if (pendingText) return pendingText.value as LocaleText
  const source = textSource(snapshot.value?.localeSources ?? [], row, language)
  if (!source) return {}
  return (Object.hasOwn(source.entries, row.record.id) ? source.entries[row.record.id] : {}) ?? {}
}
function label(row: SourceRecord) {
  return (
    localized(row, locale.value).name ||
    localized(row, defaultLanguage.value).name ||
    String(row.record.name || row.record.id)
  )
}
const labels = computed(() =>
  Object.fromEntries(effectiveRecords.value.map(row => [`${row.kind}:${row.record.id}`, label(row)])),
)
const rows = computed(() =>
  effectiveRecords.value.filter(
    row =>
      ['species', 'skills', 'marks'].includes(row.kind) &&
      (tab.value === 'all' || objectType(row) === tab.value) &&
      `${label(row)} ${row.record.id}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()),
  ),
)
const currentLocaleSource = computed(() => (selected.value ? localeSourceFor(selected.value, locale.value) : undefined))
function localeSourceFor(row: SourceRecord, language: string) {
  return localeFor(
    snapshot.value?.localeSources ?? [],
    row,
    language,
    snapshot.value?.files.map(file => file.file) ?? [],
  )
}
const localeRows = computed(() =>
  effectiveRecords.value.filter(
    row =>
      ['species', 'skills', 'marks'].includes(row.kind) &&
      (localeScope.value === null || localeScope.value.includes(recordKey(row))),
  ),
)
const pickedRows = computed(() => effectiveRecords.value.filter(row => picked.value.includes(recordKey(row))))
const recentRows = computed(() =>
  recent.value.flatMap(key => effectiveRecords.value.find(row => recordKey(row) === key) ?? []),
)
const assistantEntries = computed(() =>
  effectiveRecords.value
    .filter(row => ['species', 'skills', 'marks', 'presentations', 'resources'].includes(row.kind))
    .map(row => ({
      key: recordKey(row),
      label: `${row.kind === 'presentations' ? '表现 · ' : row.kind === 'resources' ? '资源 · ' : ''}${label(row)}`,
    })),
)
const currentLocaleDraft = computed(() =>
  pending.value.find(
    draft =>
      draft.type === 'locale' &&
      draft.kind === tab.value &&
      draft.id === selectedId.value &&
      draft.language === locale.value,
  ),
)
const currentText = computed<LocaleText>(
  () =>
    (currentLocaleDraft.value?.value as LocaleText | undefined) ??
    (selected.value ? localized(selected.value, locale.value) : {}),
)
const fallbackText = computed(() =>
  selected.value && locale.value !== defaultLanguage.value ? localized(selected.value, defaultLanguage.value) : {},
)
const localeShared = computed(
  () =>
    currentLocaleDraft.value?.sharedFields ??
    sharedFieldsUnder(currentLocaleSource.value?.sharedFields ?? [], [selectedId.value]),
)
const marks = computed(() =>
  effectiveRecords.value
    .filter(row => row.kind === 'marks')
    .map(row => ({
      id: row.record.id,
      name: label(row),
      reference: `${snapshot.value?.project.namespace}:${row.record.id}`,
    })),
)
const usedBy = computed(() =>
  selected.value
    ? consumers(
        effectiveRecords.value,
        { kind: selected.value.kind, id: selected.value.record.id },
        projectId.value,
      ).filter(row => ['species', 'skills', 'marks'].includes(row.kind))
    : [],
)
const impacts = computed(() =>
  Object.fromEntries(
    pending.value.map(draft => [draft.key, consumers(effectiveRecords.value, draft, projectId.value).map(label)]),
  ),
)
function iconSource(owner: SourceRecord) {
  const binding = effectiveRecords.value.find(
    row =>
      row.kind === 'presentations' &&
      object(row.record.target) &&
      row.record.target.kind === owner.kind &&
      row.record.target.id === owner.record.id,
  )
  return assets.value.find(row => row.kind === 'image' && row.id === binding?.record.icon)?.source
}
const resourceRows = computed(() => effectiveRecords.value.filter(row => row.kind === 'resources'))
const assets = computed(() =>
  resourceRows.value.map(row => ({
    id: row.record.id,
    source: String(row.record.source ?? ''),
    kind: String(row.record.kind ?? ''),
    name: String(row.record.name || row.record.id),
  })),
)
const visibleAssets = computed(() =>
  assets.value.filter(row =>
    `${row.name} ${row.id} ${row.source}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()),
  ),
)
const assetRecord = computed(() => resourceRows.value.find(row => row.record.id === selectedAssetId.value))
const assetUsers = computed(() =>
  assetRecord.value
    ? effectiveRecords.value
        .filter(row => row.kind === 'presentations' && resourcePaths(row.record).includes(assetRecord.value!.record.id))
        .flatMap(row => {
          const target = row.record.target
          return object(target)
            ? effectiveRecords.value.filter(owner => owner.kind === target.kind && owner.record.id === target.id)
            : []
        })
    : [],
)
const currentMedia = computed<SourceRecord>(() => {
  const owner = selected.value
  const found = effectiveRecords.value.find(
    row =>
      row.kind === 'presentations' &&
      object(row.record.target) &&
      row.record.target.kind === owner?.kind &&
      row.record.target.id === owner?.record.id,
  )
  if (found) return found
  const id = `${owner?.kind}.${owner?.record.id}`
  return {
    kind: 'presentations',
    file: `data/presentations/${encodeURIComponent(id)}.yaml`,
    index: null,
    version: null,
    record: { id, target: { kind: owner?.kind ?? 'species', id: owner?.record.id ?? '' } },
  }
})
function editMedia(record: ContentRow) {
  const row = currentMedia.value
  if (row.version === null && !drafts[recordKey(row)]) store.createRecord({ ...row, record })
  else store.editRecord(row, record)
  if (snapshot.value) store.sync(snapshot.value)
}
function editAssetSource(event: Event) {
  if (readOnly.value || !assetRecord.value) return
  const row = assetRecord.value
  const location = (event.target as HTMLInputElement).value
  store.editRecord(row, { ...row.record, source: location })
  void attempt(() => readAsset(location, row.record.id))
  notice.value = '资源位置已加入草稿；所有使用者继续使用原资源 ID。'
}
const files = computed(
  () =>
    snapshot.value?.files.filter(row =>
      tab.value === 'effects' ? row.file.startsWith('src/') : /^(test|tests)\//.test(row.file),
    ) ?? [],
)
const running = computed(() => jobs.value.some(job => ['queued', 'running'].includes(job.state)))
const validation = computed(() =>
  pending.value.flatMap(draft => {
    const issues: string[] = []
    if (draft.type === 'locale' && typeof draft.value.description === 'string') {
      const problem = descriptionProblem(draft.value.description, draft.language ?? 'zh-CN')
      if (problem)
        issues.push(`${labels.value[`${draft.kind}:${draft.id}`] || draft.id} · ${draft.language}：${problem}`)
    }
    return issues
  }),
)
const selectedSources = computed(() => [
  ...new Set(
    [
      currentDraft.value?.file ?? selected.value?.file,
      currentLocaleDraft.value?.file ?? currentLocaleSource.value?.file,
      currentMedia.value.version !== null || drafts[recordKey(currentMedia.value)]
        ? currentMedia.value.file
        : undefined,
    ].filter((file): file is string => !!file),
  ),
])

async function action<T>(input: Record<string, unknown>) {
  return authorCall<T>({ id: project.value?.id, ...input })
}
async function attempt(operation: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await operation()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
function captureConflict() {
  reviewed.value = Object.fromEntries(conflicts.value.map(draft => [draft.key, reviewToken(draft)]))
  choices.value = {}
}
async function refresh() {
  if (!project.value || disposed) return
  const id = project.value.id,
    request = ++epoch
  const next = await authorCall<AuthorSnapshot>({ action: 'snapshot', id })
  if (disposed || project.value?.id !== id || request !== epoch) return
  const oldAsset = snapshot.value?.assets.find(row => row.id === selectedAssetId.value)
  snapshot.value = next
  store.sync(next)
  if (screen.value === 'conflict' && conflicts.value.some(draft => reviewed.value[draft.key] !== reviewToken(draft))) {
    captureConflict()
    notice.value = '外部来源再次变化，请根据最新内容重新选择。'
  }
  if (asset.value && selectedAssetId.value) {
    const current = next.assets.find(row => row.id === selectedAssetId.value)
    const source = assetRecord.value?.record.source
    if (
      typeof source === 'string' &&
      (asset.value.file !== source || oldAsset?.modified !== current?.modified || oldAsset?.size !== current?.size)
    ) {
      try {
        await readAsset(source, selectedAssetId.value)
      } catch {
        error.value = '素材暂时无法读取；资源关联仍保留，可以修改素材位置重新定位。'
      }
    }
  }

  return next
}
async function openProject(next: SourceProject) {
  if (dirty.value) throw new Error('请先保存或放弃草稿，再切换项目。')
  const previous = project.value?.id
  epoch++
  mediaEpoch++
  mediaController?.abort()
  project.value = next
  projectSettingsOpen.value = false
  snapshot.value = undefined
  selectedId.value = ''
  asset.value = undefined
  jobs.value = []
  history.value = []
  picked.value = []
  recent.value = []
  localeScope.value = null
  assistantContext.value = undefined
  assistantKeys.value = []
  assistantProposals.value = []
  screen.value = 'editor'
  store.clear()
  if (previous && previous !== next.id) await authorCall({ action: 'close', id: previous })
  await refresh()
  tab.value = 'all'
  localStorage.setItem('arcadia-author-project', next.id)
}
function switchTab(key: string) {
  notice.value = ''
  if (key === 'assistant' && !assistantContext.value) assistantKeys.value = picked.value.slice()
  if (key === 'locales') localeScope.value = null
  tab.value = key
  selectedId.value = ''
  screen.value = 'editor'
  history.value = []
  search.value = ''
  error.value = ''
}
function navigate(kind: string, id: string) {
  if (kind === 'presentations') {
    const target = effectiveRecords.value.find(row => row.kind === kind && row.record.id === id)?.record.target
    if (object(target)) {
      navigate(String(target.kind), String(target.id))
      section.value = 'media'
    }
    return
  }
  if (kind === 'resources') {
    const resource = assets.value.find(row => row.id === id)
    if (resource) void attempt(() => preview(resource.source, id))
    return
  }
  const matches = effectiveRecords.value.filter(row => row.kind === kind && row.record.id === id)
  const row = matches.length === 1 ? matches[0] : undefined
  if (kind === 'behaviors') {
    void attempt(() => external(row?.file))
    return
  }
  if (!row || matches.length !== 1) {
    error.value = '未找到唯一的内容对象，请检查外部引用、重复 ID 或依赖。'
    return
  }
  history.value.push({ kind: tab.value, id: selectedId.value, section: section.value })
  recent.value = [recordKey(row), ...recent.value.filter(key => key !== recordKey(row))].slice(0, 6)
  tab.value = kind
  selectedId.value = id
  section.value = 'base'
  screen.value = 'editor'
  search.value = ''
  error.value = ''
}
function back() {
  const previous = history.value.pop()
  if (previous) {
    tab.value = previous.kind
    selectedId.value = previous.id
    section.value = previous.section
  } else selectedId.value = ''
  screen.value = 'editor'
}
function editRecord(record: ContentRow) {
  if (readOnly.value) return
  if (selected.value) {
    store.editRecord(selected.value, record)
    if (snapshot.value) store.sync(snapshot.value)
  }
}
function editText(text: LocaleText) {
  if (readOnly.value) return
  if (selected.value && currentLocaleSource.value) {
    store.editLocale(currentLocaleSource.value, selectedId.value, tab.value, text)
    if (snapshot.value) store.sync(snapshot.value)
  }
}
function editRowText(row: SourceRecord, text: LocaleText) {
  if (readOnly.value) return
  const source = localeSourceFor(row, locale.value)
  if (!source) throw new Error('对应语言来源不唯一或无法读取，请先在外部修复')
  store.editLocale(source, row.record.id, row.kind, text)
  if (snapshot.value) store.sync(snapshot.value)
}
function languageFields(row: SourceRecord) {
  const draft = pending.value.find(
    draft =>
      draft.type === 'locale' &&
      draft.kind === row.kind &&
      draft.id === row.record.id &&
      draft.language === locale.value,
  )
  return (
    draft?.sharedFields ?? sharedFieldsUnder(localeSourceFor(row, locale.value)?.sharedFields ?? [], [row.record.id])
  )
}
function openLocales(keys: string[]) {
  history.value.push({ kind: tab.value, id: selectedId.value, section: section.value })
  localeScope.value = keys
  tab.value = 'locales'
  selectedId.value = ''
  screen.value = 'editor'
}
function togglePick(row: SourceRecord, checked: boolean) {
  const key = recordKey(row)
  picked.value = checked ? [...new Set([...picked.value, key])] : picked.value.filter(value => value !== key)
}
function suggestFile() {
  const kind = ['ability', 'emblem'].includes(newType.value) ? 'marks' : newType.value
  newFile.value = `data/${kind}/${newId.value}.yaml`
}
function beginCreate(type = 'skills', slot?: string, duplicate = false) {
  if (readOnly.value) return
  createRelation.value = slot && selected.value ? { row: selected.value, slot } : undefined
  copyFrom.value = duplicate && currentRecord.value ? clone(currentRecord.value) : undefined
  copyMediaFrom.value =
    duplicate && (currentMedia.value.version !== null || drafts[recordKey(currentMedia.value)])
      ? clone(currentMedia.value.record)
      : undefined
  newType.value = type
  newId.value = `content-${crypto.randomUUID().slice(0, 8)}`
  newName.value = duplicate && selected.value ? label(selected.value) + ' · 副本' : ''
  suggestFile()
  screen.value = 'create'
}
function createObject() {
  if (!snapshot.value || !newName.value.trim() || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(newId.value))
    throw new Error('请填写名称，并使用字母、数字、连字符或下划线作为标识')
  const kind = ['ability', 'emblem'].includes(newType.value) ? 'marks' : newType.value
  if (
    !newFile.value.startsWith(`data/${kind}/`) ||
    !/\.(json|ya?ml)$/.test(newFile.value) ||
    newFile.value.split('/').some(part => !part || ['.', '..'].includes(part)) ||
    /[\\:\0]/.test(newFile.value)
  )
    throw new Error('请选择此类型数据目录内的新 JSON 或 YAML 文件')
  if (
    effectiveRecords.value.some(row => row.kind === kind && row.record.id === newId.value) ||
    snapshot.value.files.some(row => row.file === newFile.value) ||
    pending.value.some(draft => draft.file === newFile.value)
  )
    throw new Error('标识或新建位置已被占用，请换一个位置')
  const row: SourceRecord = {
    kind,
    file: newFile.value,
    index: null,
    version: null,
    record: copyFrom.value ? { ...clone(copyFrom.value), id: newId.value } : initialRecord(newType.value, newId.value),
  }
  const source = localeSourceFor(row, locale.value)
  if (!source) throw new Error('名称语言来源存在问题，请先在外部修复')
  const relation = createRelation.value
  if (
    relation &&
    sharedAt(drafts[recordKey(relation.row)]?.sharedFields ?? relation.row.sharedFields ?? [], [relation.slot])
  )
    throw new Error('关联字段来自共享 YAML，请在外部修改')
  if (copyMediaFrom.value) {
    const file = `data/presentations/${encodeURIComponent(`${kind}.${row.record.id}`)}.yaml`
    if (snapshot.value.files.some(row => row.file === file) || pending.value.some(draft => draft.file === file))
      throw new Error('副本的表现文件位置已被占用，请使用其他对象标识')
  }
  store.createRecord(row)
  if (copyMediaFrom.value) {
    const id = `${kind}.${row.record.id}`
    store.createRecord({
      kind: 'presentations',
      file: `data/presentations/${encodeURIComponent(id)}.yaml`,
      index: null,
      version: null,
      record: { ...clone(copyMediaFrom.value), id, target: { kind, id: row.record.id } },
    })
  }
  store.editLocale(source, row.record.id, kind, { name: newName.value.trim() })
  if (relation) {
    const record = clone((drafts[recordKey(relation.row)]?.value ?? relation.row.record) as ContentRow)
    const refValue = {
      $ref: { projectId: projectId.value, kind: kind === 'skills' ? 'skill' : 'mark', id: row.record.id },
    }
    const values: Json[] = Array.isArray(record[relation.slot]) ? (record[relation.slot] as Json[]) : []
    record[relation.slot] = [
      ...values,
      relation.slot === 'learnable_skills' ? { skill_id: refValue, level: 1, hidden: false } : refValue,
    ]
    store.editRecord(relation.row, record)
  }
  store.sync(snapshot.value)
  navigate(kind, row.record.id)
  notice.value = '已创建草稿；名称、关联和内容定义会一起进入保存核对。'
}
function openAssistant(keys: string[]) {
  assistantKeys.value = keys
  assistantProposals.value = []
  assistantContext.value = undefined
  assistantSession.value++
  tab.value = 'assistant'
  selectedId.value = ''
  screen.value = 'editor'
}
function prepareAssistant(options: { keys: string[]; related: boolean; drafts: boolean; request: string }) {
  if (!snapshot.value || !options.keys.length) throw new Error('请先选择协作内容')
  const keys = [...new Set(options.keys)]
  const extra = options.related ? relatedKeys(effectiveRecords.value, keys, projectId.value) : []
  const objects = [...keys, ...extra].map(key => {
    const matches = (options.drafts ? effectiveRecords.value : snapshot.value!.records).filter(
      row => recordKey(row) === key,
    )
    if (matches.length !== 1) throw new Error('范围中有新建草稿或重复对象，请包含草稿并检查来源')
    const row = matches[0]!,
      draft = options.drafts ? drafts[key] : undefined
    return {
      key,
      label: label(row),
      access: keys.includes(key) ? ('editable' as const) : ('reference-only' as const),
      source: {
        file: draft?.file ?? row.file,
        version: draft ? draft.version : row.version,
        index: draft?.index ?? row.index,
        sharedFields: draft?.sharedFields ?? row.sharedFields,
      },
      record: clone(row.record),
      texts: Object.fromEntries(
        languages.value.map(language => [
          language,
          options.drafts
            ? clone(localized(row, language))
            : clone(textSource(snapshot.value!.localeSources, row, language)?.entries[row.record.id] ?? {}),
        ]),
      ),
    }
  })
  assistantContext.value = {
    protocol: 'arcadia-author-context/v1',
    snapshotId: crypto.randomUUID(),
    projectId: projectId.value,
    request: options.request,
    includesDrafts: options.drafts,
    objects,
  }
}
function proposalRow(proposal: AssistantProposal) {
  const matches = effectiveRecords.value.filter(row => recordKey(row) === proposal.key)
  if (matches.length !== 1) throw new Error('对象来源已缺失或不唯一，建议尚未采用')
  return matches[0]!
}
function proposalValue(proposal: AssistantProposal) {
  const row = effectiveRecords.value.find(row => recordKey(row) === proposal.key)
  return row
    ? atField(
        proposal.target === 'record' ? row.record : (localized(row, proposal.language!) as Record<string, Json>),
        proposal.path,
      )
    : undefined
}
function applyProposal(proposal: AssistantProposal) {
  if (readOnly.value) throw new Error('此内容包为只读')
  if (!assistantContext.value?.objects.some(row => row.key === proposal.key && row.access === 'editable'))
    throw new Error('该对象不在本次可修改范围内')
  const row = proposalRow(proposal)
  if (proposal.target === 'record') {
    const shared = [...(row.sharedFields ?? []), ...(drafts[proposal.key]?.sharedFields ?? [])]
    if (sharedAt(shared, proposal.path)) throw new Error('该字段来自共享 YAML，请在外部编辑器处理')
    const record = clone(row.record)
    setField(record, proposal.path, proposal.after)
    store.editRecord(row, record)
  } else {
    const source = localeSourceFor(row, proposal.language!)
    if (!source || sharedAt(sharedFieldsUnder(source.sharedFields, [row.record.id]), proposal.path))
      throw new Error('该语言字段不可写，请在外部编辑器处理')
    const text = clone(localized(row, proposal.language!)) as Record<string, Json>
    setField(text, proposal.path, proposal.after)
    store.editLocale(source, row.record.id, row.kind, text)
  }
  if (snapshot.value) store.sync(snapshot.value)
}
async function importAsset() {
  const result = await action<{ file: string; name: string } | null>({ action: 'import-asset' })
  if (result) {
    await refresh()
    tab.value = 'assets'
    selectedId.value = ''
    let id = result.file
      .split('/')
      .at(-1)!
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
    if (!/^[a-zA-Z0-9]/.test(id)) id = 'media-' + id
    const base = id
    let suffix = 2
    while (assets.value.some(row => row.id === id)) id = `${base}-${suffix++}`
    store.createRecord({
      kind: 'resources',
      file: `data/resources/${id}.yaml`,
      index: null,
      version: null,
      record: {
        id,
        name: result.name,
        kind: /\.swf$/i.test(result.file) ? 'swf' : /\.(mp3|ogg)$/i.test(result.file) ? 'audio' : 'image',
        source: result.file,
      },
    })
    await readAsset(result.file)
    notice.value = '素材已导入，资源定义已加入草稿，可继续关联后一起保存。'
  }
}
async function review() {
  await refresh()
  if (!dirty.value) return
  if (conflicts.value.length) {
    captureConflict()
    screen.value = 'conflict'
  } else {
    reviewedPayload = JSON.stringify(store.payload())
    screen.value = 'save'
  }
}
async function save() {
  if (!dirty.value) return
  await refresh()
  if (conflicts.value.length) {
    captureConflict()
    screen.value = 'conflict'
    throw new Error('来源已变化，请先核对。')
  }
  if (validation.value.length) throw new Error('请先修正名称与描述中的格式问题。')
  if (reviewedPayload !== JSON.stringify(store.payload())) throw new Error('草稿已经变化，请重新查看保存内容。')
  try {
    const result = await action<{
      results: { file: string; saved: boolean; diagnostic?: { message: string } }[]
      complete: boolean
    }>({ action: 'save-changes', changes: store.payload() })
    const saved = result.results.filter(row => row.saved).map(row => row.file)
    store.clear(saved)
    await refresh()
    screen.value = 'editor'
    notice.value = result.complete
      ? `已保存 ${saved.length} 个源文件。`
      : `已保存 ${saved.length} 个源文件，其余修改仍保留在草稿中。`
    if (!result.complete)
      error.value = result.results.find(row => !row.saved)?.diagnostic?.message ?? '保存未全部完成，请核对剩余修改。'
  } catch (cause) {
    await refresh()
    if (conflicts.value.length) {
      captureConflict()
      screen.value = 'conflict'
    }
    throw cause
  }
}
async function reconcile() {
  await refresh()
  store.reconcile(choices.value, reviewed.value)
  screen.value = 'editor'
  notice.value = '已按选择更新草稿，尚未写入文件。请再次查看并保存。'
}
async function discard() {
  store.clear()
  await refresh()
  screen.value = 'editor'
  notice.value = '已放弃草稿并读取当前源文件。'
}
async function external(file?: string, line?: number, column?: number) {
  if (readOnly.value) return action({ action: 'show', file })
  if (file && pending.value.some(draft => draft.file === file && draft.version === null))
    throw new Error('此来源尚未创建，请先查看并保存草稿，再用外部编辑器打开。')
  localStorage.setItem('arcadia-author-editor', editor.value)
  await action({ action: 'editor', file, editor: editor.value, line, column })
}
async function copyConnection() {
  const config = await action({ action: 'connection', execute: assistantExecution.value })
  await navigator.clipboard.writeText(JSON.stringify(config, null, 2))
  notice.value = '已复制 MCP 配置。'
}
async function start(kind: string) {
  if (dirty.value) throw new Error('请先保存草稿，运行任务读取的是磁盘内容。')
  const job = await action<AuthorJob>({ action: 'start', kind })
  jobs.value = [job, ...jobs.value.filter(row => row.jobId !== job.jobId)]
}
async function readAsset(file: string, resourceId?: string) {
  selectedAssetId.value = resourceId ?? assets.value.find(row => row.source === file)?.id ?? ''
  const id = project.value?.id,
    request = ++mediaEpoch
  mediaController?.abort()
  mediaController = new AbortController()
  assetLoading.value = true
  asset.value = { file, bytes: new Uint8Array() }
  try {
    const data = /^https?:/.test(file)
      ? {
          file,
          bytes: await readResourceBytes(file, { signal: mediaController.signal, maxBytes: 64 * 1024 * 1024 }),
        }
      : await action<{ file: string; bytes: Uint8Array }>({ action: 'media', file })
    if (!disposed && request === mediaEpoch && project.value?.id === id)
      asset.value = { file: data.file, bytes: new Uint8Array(data.bytes) }
  } catch (cause) {
    if (!disposed && request === mediaEpoch && project.value?.id === id) throw cause
  } finally {
    if (request === mediaEpoch) assetLoading.value = false
  }
}
async function preview(file: string, resourceId?: string) {
  if (selected.value) history.value.push({ kind: tab.value, id: selectedId.value, section: section.value })
  tab.value = 'assets'
  screen.value = 'editor'
  search.value = ''
  await readAsset(file, resourceId)
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
watch(locale, value => localStorage.setItem('arcadia-author-locale', value))
watch(pendingFiles, (next, previous) => {
  const id = project.value?.id
  if (!id) return
  for (const file of new Set([...next, ...(previous ?? [])]))
    void authorCall({ action: 'dirty', id, file, dirty: next.includes(file) }).catch(cause => {
      error.value = String(cause)
    })
})
onBeforeRouteLeave(() => !busy.value && (!dirty.value || window.confirm('离开将丢弃未保存的草稿，继续吗？')))
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload)
  unsubscribe = window.arcadiaDesktop?.onAuthorChanged?.(event => {
    if (event.id !== project.value?.id) return
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      void refresh().catch(cause => {
        error.value = String(cause)
      })
    }, 200)
  })
  timer = setInterval(() => {
    const id = project.value?.id
    if (id)
      void authorCall<AuthorJob[]>({ action: 'jobs', id })
        .then(result => {
          if (!disposed && project.value?.id === id) jobs.value = result
        })
        .catch(cause => {
          error.value = String(cause)
        })
  }, 1000)
  await attempt(async () => {
    projects.value = await authorCall({ action: 'list' })
    const last = projects.value.find(row => row.id === localStorage.getItem('arcadia-author-project'))
    if (last) await openProject(last)
  })
})
onBeforeUnmount(() => {
  disposed = true
  epoch++
  mediaEpoch++
  mediaController?.abort()
  unsubscribe?.()
  clearInterval(timer)
  clearTimeout(refreshTimer)
  window.removeEventListener('beforeunload', beforeUnload)
  if (project.value) void action({ action: 'close' }).catch(() => {})
})
</script>

<template>
  <main class="author-page">
    <header class="app-header">
      <div class="brand">
        <strong>创作</strong>
        <button
          v-if="project"
          class="project-switch"
          :aria-expanded="projectSettingsOpen"
          @click="projectSettingsOpen = !projectSettingsOpen"
        >
          {{ project.name }} ▾
        </button>
        <span v-if="readOnly" class="badge">只读</span>
      </div>
      <label v-if="project"
        >内容语言<select v-model="locale" :disabled="busy">
          <option v-for="language in languages" :key="language">{{ language }}</option>
        </select></label
      >
      <div v-if="dirty" class="tools save-actions">
        <button v-if="dirty" :disabled="busy" @click="screen = 'discard'">放弃修改</button
        ><button
          v-if="conflicts.length"
          :disabled="busy"
          @click="
            attempt(async () => {
              await refresh()
              captureConflict()
              screen = 'conflict'
            })
          "
        >
          核对外部变化</button
        ><button class="primary" :disabled="busy || !dirty" @click="attempt(review)">
          查看并保存{{ dirty ? `（${pending.length}）` : '' }}
        </button>
      </div>
    </header>
    <details v-if="!project || projectSettingsOpen" class="project-settings" open>
      <summary>{{ project ? '项目与外部工具' : '打开内容包源项目' }}</summary>
      <div class="tools">
        <label
          >项目<select
            :value="project?.id ?? ''"
            :disabled="busy || dirty"
            @change="
              attempt(async () => {
                const row = projects.find(row => row.id === ($event.target as HTMLSelectElement).value)
                if (row) await openProject(row)
              })
            "
          >
            <option value="">选择项目</option>
            <option v-for="row in projects" :key="row.id" :value="row.id">{{ row.name }}</option>
          </select></label
        ><button
          :disabled="busy || dirty"
          @click="
            attempt(async () => {
              const row = await authorCall<SourceProject | null>({ action: 'open' })
              if (row) {
                projects = await authorCall({ action: 'list' })
                await openProject(row)
              }
            })
          "
        >
          打开项目</button
        ><label>新项目名称<input v-model="name" placeholder="例如：寒霜故事" /></label
        ><button
          :disabled="busy || dirty || !name.trim()"
          @click="
            attempt(async () => {
              const row = await authorCall<SourceProject>({ action: 'create', name })
              projects = await authorCall({ action: 'list' })
              await openProject(row)
              name = ''
            })
          "
        >
          从模板创建项目
        </button>
      </div>
      <div v-if="project" class="tools">
        <label v-if="!readOnly"
          >外部编辑器<select v-model="editor">
            <option value="code">VS Code</option>
            <option value="codium">VSCodium</option>
            <option value="cursor">Cursor</option>
            <option value="zed">Zed</option>
          </select></label
        ><button v-if="!readOnly" :disabled="busy" @click="attempt(() => external())">打开编辑器</button
        ><button :disabled="busy" @click="attempt(() => action({ action: 'show' }))">显示项目文件夹</button
        ><button :disabled="busy || dirty" @click="attempt(() => action({ action: 'export' }))">导出源项目</button
        ><button
          v-if="!readOnly"
          :disabled="busy"
          @click="
            attempt(async () => {
              await action({ action: 'sdk' })
              notice = '已连接本机开发 SDK。'
            })
          "
        >
          连接本机 SDK</button
        ><small>{{ project.directory }}</small>
      </div>
    </details>
    <p v-if="error" class="banner error" role="alert">{{ error }}</p>
    <div v-if="notice" class="banner notice" role="status">
      <span>{{ notice }}</span
      ><button aria-label="关闭提示" @click="notice = ''">×</button>
    </div>
    <div v-if="!project" class="welcome">
      <h1>让你的内容加入战斗</h1>
      <p>打开已有内容包，或从模板开始。精灵、技能、印记和资源在这里关联，效果代码在外部编辑器维护。</p>
    </div>
    <div v-else class="workspace">
      <aside class="sidebar">
        <small>{{ project.name }}</small>
        <nav aria-label="内容分类">
          <button
            v-for="(title, key) in visibleTabs"
            :key="key"
            :aria-pressed="tab === key && screen === 'editor'"
            @click="switchTab(key)"
          >
            {{ title
            }}<span v-if="Object.hasOwn(contentTypes, key)">{{
              effectiveRecords.filter(
                row => ['species', 'skills', 'marks'].includes(row.kind) && (key === 'all' || objectType(row) === key),
              ).length
            }}</span>
          </button>
        </nav>
        <details v-if="dirty" open class="draft-list">
          <summary>未保存草稿 · {{ pending.length }}</summary>
          <button v-for="draft in pending" :key="draft.key" @click="openDraft(draft)">
            {{ labels[`${draft.kind}:${draft.id}`] || draft.id
            }}<small
              >{{ draft.type === 'locale' ? draft.language : '内容定义'
              }}{{ isConflict(draft) ? ' · 来源已变化' : '' }}</small
            >
          </button>
        </details>
      </aside>
      <section class="workspace-content" :aria-busy="busy">
        <nav v-if="recentRows.length && screen === 'editor'" class="recent-objects" aria-label="最近打开">
          <small>最近打开</small
          ><button v-for="row in recentRows" :key="recordKey(row)" @click="navigate(row.kind, row.record.id)">
            {{ label(row) }}
          </button>
        </nav>
        <template v-if="screen === 'save'"
          ><header class="page-heading">
            <div>
              <h1>确认保存</h1>
              <p>核对字段改动与使用范围，保存到各自的来源。</p>
            </div>
            <button @click="screen = 'editor'">返回继续编辑</button>
          </header>
          <ChangeReview
            :drafts="pending"
            mode="save"
            :project-id="projectId"
            :labels="labels"
            :impacts="impacts"
            :choices="{}"
            @external="file => attempt(() => external(file))"
          />
          <p v-for="message in validation" :key="message" class="error" role="alert">{{ message }}</p>
          <footer class="review-actions">
            <small>{{ pendingFiles.length }} 个源文件将分别保存；若中途失败，已保存结果会明确列出，其余草稿保留。</small
            ><button
              class="primary"
              :disabled="busy || !dirty || !!validation.length || !!conflicts.length"
              @click="attempt(save)"
            >
              确认保存
            </button>
          </footer></template
        >
        <template v-else-if="screen === 'conflict'"
          ><header class="page-heading">
            <div>
              <h1>核对外部变化</h1>
              <p>逐项选择保留的值。核对只更新草稿，之后仍需保存。</p>
            </div>
            <button @click="screen = 'editor'">稍后处理，保留草稿</button>
          </header>
          <ChangeReview
            :drafts="conflicts"
            mode="conflict"
            :project-id="projectId"
            :labels="labels"
            :impacts="impacts"
            :choices="choices"
            @choose="(key, value) => (choices[key] = value)"
            @external="file => attempt(() => external(file))"
          />
          <p v-if="!conflicts.length" class="hint">当前没有需要核对的外部变化。</p>
          <footer class="review-actions">
            <small>未在草稿中修改的字段采用外部最新值。</small
            ><button
              class="primary"
              :disabled="busy || !conflicts.length || conflicts.some(draft => !draft.latest)"
              @click="attempt(reconcile)"
            >
              按选择更新草稿
            </button>
          </footer></template
        >
        <template v-else-if="screen === 'discard'"
          ><header class="page-heading">
            <div>
              <h1>放弃这些修改？</h1>
              <p>将丢弃当前项目的 {{ pending.length }} 项内容草稿，重新读取磁盘内容。</p>
            </div>
          </header>
          <ul>
            <li v-for="draft in pending" :key="draft.key">
              {{ labels[`${draft.kind}:${draft.id}`] || draft.id }} · {{ draft.language || '内容定义' }}
            </li>
          </ul>
          <div class="tools">
            <button @click="screen = 'editor'">继续编辑</button
            ><button :disabled="busy" @click="attempt(discard)">确认放弃修改</button>
          </div></template
        >
        <template v-else-if="screen === 'create'">
          <header class="page-heading">
            <div>
              <h1>{{ copyFrom ? '创建独立副本' : '新建内容' }}</h1>
              <p>
                {{
                  createRelation ? '创建后关联到当前对象，全部修改先保留为草稿。' : '独立创建内容，关联可以稍后再加。'
                }}
              </p>
            </div>
            <button @click="screen = 'editor'">取消</button>
          </header>
          <form class="create-object" @submit.prevent="attempt(async () => createObject())">
            <label
              >内容类型<select
                aria-label="内容类型"
                v-model="newType"
                :disabled="!!createRelation || !!copyFrom"
                @change="suggestFile"
              >
                <option
                  v-for="(title, key) in contentTypes"
                  v-show="key !== 'all'"
                  :key="key"
                  :value="key"
                  :disabled="key === 'all'"
                >
                  {{ title }}
                </option>
              </select></label
            >
            <label>显示名称<input v-model="newName" required /></label>
            <details>
              <summary>对象标识与保存位置</summary>
              <label>稳定标识<input v-model="newId" @input="suggestFile" required /></label
              ><label>新文件位置<input v-model="newFile" required /></label
              ><small>在对应数据目录内自由安排新文件；已有文件的合并与整理可在外部完成。</small>
            </details>
            <button class="primary" :disabled="busy" type="submit">创建草稿</button>
          </form>
        </template>
        <template v-else-if="tab === 'locales'">
          <header class="page-heading">
            <div>
              <h1>名称与描述</h1>
              <p>{{ localeScope ? `所选 ${localeRows.length} 项内容` : '整个内容包' }} · {{ locale }}</p>
            </div>
            <div class="tools">
              <button v-if="localeScope" @click="localeScope = null">显示整个内容包</button
              ><button v-if="!readOnly" @click="openAssistant(localeRows.map(recordKey))">请 AI 协作</button>
            </div>
          </header>
          <form
            v-if="!readOnly"
            class="tools"
            @submit.prevent="/^[A-Za-z][A-Za-z0-9-]*$/.test(languageInput) && (locale = languageInput)"
          >
            <label
              >添加编辑语言<input
                v-model="languageInput"
                placeholder="例如 en"
                pattern="[A-Za-z][A-Za-z0-9-]*"
                required /></label
            ><button type="submit">切换语言</button>
          </form>
          <article v-for="row in localeRows.slice(0, libraryLimit)" :key="recordKey(row)" class="locale-object">
            <header class="page-heading">
              <h2>{{ label(row) }}</h2>
              <button @click="navigate(row.kind, row.record.id)">打开对象</button>
            </header>
            <LocaleFields
              :read-only="readOnly"
              :text="localized(row, locale)"
              :fallback="locale !== defaultLanguage ? localized(row, defaultLanguage) : {}"
              :record="row.record"
              :language="locale"
              :shared-fields="languageFields(row)"
              :available="!!localeSourceFor(row, locale)"
              :marks="marks"
              @change="text => editRowText(row, text)"
              @navigate="navigate"
              @external="
                () =>
                  attempt(() =>
                    external(localeSourceFor(row, locale)?.version ? localeSourceFor(row, locale)?.file : undefined),
                  )
              "
            />
          </article>
          <button v-if="localeRows.length > libraryLimit" @click="libraryLimit += 60">显示更多</button>
          <p v-if="!localeRows.length" class="hint">没有选择可编辑文本的对象。</p>
        </template>
        <template v-else-if="Object.hasOwn(contentTypes, tab)">
          <template v-if="selected && currentRecord"
            ><button class="back-link" @click="back">← {{ history.length ? '返回上一项' : tabs[tab] }}</button>
            <header class="page-heading">
              <div>
                <h1>
                  <ObjectIcon :kind="selected.kind" :source="iconSource(selected)" :project="project?.id" />
                  {{ labels[`${tab}:${selectedId}`] || currentRecord.name || selectedId
                  }}<span v-if="currentDraft" class="badge">草稿</span>
                </h1>
                <small>{{ contentTypes[objectType(selected)] }} · {{ currentRecord.element || '内容对象' }}</small>
              </div>
              <div class="tools">
                <button v-if="!readOnly" @click="openAssistant([recordKey(selected)])">请 AI 帮忙</button
                ><button @click="openLocales([recordKey(selected)])">多语言</button
                ><button v-if="!readOnly" @click="beginCreate(objectType(selected), undefined, true)">
                  创建独立副本</button
                ><button @click="section = 'base'">预览名称与描述</button>
              </div>
            </header>
            <div v-if="usedBy.length" class="used-by">
              <small>被以下内容使用</small
              ><button v-for="row in usedBy" :key="recordKey(row)" @click="navigate(row.kind, row.record.id)">
                {{ label(row) }} ↗
              </button>
            </div>
            <div class="tabs" role="group" aria-label="对象详情">
              <button :aria-pressed="section === 'base'" @click="section = 'base'">基本资料</button
              ><button :aria-pressed="section === 'references'" @click="section = 'references'">
                {{ tab === 'species' ? '技能、特性与纹章' : '效果引用' }}</button
              ><button :aria-pressed="section === 'media'" @click="section = 'media'">形象与声音</button>
            </div>
            <fieldset :disabled="busy" class="editor-fields">
              <LocaleFields
                v-if="section === 'base'"
                :read-only="readOnly"
                :text="currentText"
                :fallback="fallbackText"
                :record="currentRecord"
                :language="locale"
                :shared-fields="localeShared"
                :available="!!currentLocaleSource"
                :marks="marks"
                @change="editText"
                @external="
                  (line, column) =>
                    attempt(() =>
                      external(
                        currentLocaleDraft?.file ?? currentLocaleSource?.file,
                        line ?? currentLocaleSource?.locations?.[selectedId]?.line,
                        column ?? currentLocaleSource?.locations?.[selectedId]?.column,
                      ),
                    )
                "
                @navigate="navigate"
              />
              <div class="form-panel">
                <RecordForm
                  :read-only="readOnly"
                  :key="recordKey(selected)"
                  :record="section === 'media' ? currentMedia.record : currentRecord"
                  :kind="selected.kind"
                  :records="effectiveRecords"
                  :project-id="projectId"
                  :assets="assets"
                  :shared-fields="
                    section === 'media'
                      ? currentMedia.sharedFields
                      : (currentDraft?.sharedFields ?? selected.sharedFields)
                  "
                  :section="section"
                  hide-identity
                  :labels="labels"
                  @change="record => (section === 'media' ? editMedia(record) : editRecord(record))"
                  @navigate="navigate"
                  @preview="id => attempt(() => preview(assets.find(row => row.id === id)?.source || id, id))"
                  @create="(type, slot) => beginCreate(type, slot)"
                  @external="
                    (line, column) =>
                      attempt(() =>
                        external(
                          section === 'media' ? currentMedia.file : (currentDraft?.file ?? selected?.file),
                          line ?? (section === 'media' ? currentMedia.line : selected?.line),
                          column ?? (section === 'media' ? currentMedia.column : selected?.column),
                        ),
                      )
                  "
                />
              </div>
            </fieldset>
            <details class="source-details">
              <summary>来源详情与对象标识</summary>
              <p>ID：{{ selectedId }}</p>
              <p v-for="file in selectedSources" :key="file">
                {{ file }} <button @click="attempt(() => external(file))">打开 ↗</button>
              </p>
            </details></template
          >
          <template v-else
            ><header class="page-heading">
              <div>
                <h1>{{ tab === 'all' ? '内容库' : tabs[tab] }}</h1>
                <p>
                  {{
                    readOnly
                      ? '基础内容只读；可以查看资料、语言与引用关系。'
                      : '独立创建与编辑任意对象；多选内容可一起处理语言和 AI 协作。'
                  }}
                </p>
              </div>
              <input v-model="search" type="search" aria-label="搜索内容" placeholder="搜索名称或 ID" />
              <button v-if="!readOnly" class="primary" @click="beginCreate(tab === 'all' ? 'skills' : tab)">
                新建内容
              </button>
            </header>
            <div v-if="pickedRows.length" class="selection-bar">
              <strong>已选 {{ pickedRows.length }} 项</strong>
              <p>{{ pickedRows.map(label).join('、') }}</p>
              <div class="tools">
                <button v-if="!readOnly" @click="openAssistant(pickedRows.map(recordKey))">请 AI 协作</button
                ><button @click="openLocales(pickedRows.map(recordKey))">
                  {{ readOnly ? '查看所选语言' : '编辑所选语言' }}</button
                ><button @click="picked = []">取消选择</button>
              </div>
            </div>
            <div class="catalog object-library">
              <article
                v-for="row in rows.slice(0, libraryLimit)"
                :key="recordKey(row) + row.file"
                class="library-entry"
              >
                <label class="pick-object"
                  ><input
                    type="checkbox"
                    :aria-label="`选择${label(row)}`"
                    :checked="picked.includes(recordKey(row))"
                    @change="togglePick(row, ($event.target as HTMLInputElement).checked)"
                /></label>
                <button class="content-card" @click="navigate(row.kind, row.record.id)">
                  <span class="object-title"
                    ><ObjectIcon
                      :kind="row.kind"
                      :source="iconSource(row)"
                      :project="project?.id"
                      :revision="snapshot?.files.find(file => file.file === iconSource(row))?.modified"
                    /><strong>{{ label(row) }}</strong></span
                  ><small>{{ contentTypes[objectType(row)] }}{{ drafts[recordKey(row)] ? ' · 有草稿' : '' }}</small>
                  <AuthorDescription
                    :text="
                      localized(row, locale).description ||
                      localized(row, defaultLanguage).description ||
                      '查看资料与引用关系'
                    "
                    :language="localized(row, locale).description ? locale : defaultLanguage"
                    :context="row.record"
                    :marks="marks"
                    :interactive="false"
                  />
                </button>
                <small>{{
                  consumers(effectiveRecords, { kind: row.kind, id: row.record.id }, projectId)
                    .filter(row => ['species', 'skills', 'marks'].includes(row.kind))
                    .map(label)
                    .join('、') || '独立内容'
                }}</small>
              </article>
            </div>
            <button v-if="rows.length > libraryLimit" @click="libraryLimit += 60">
              显示更多（{{ libraryLimit }} / {{ rows.length }}）
            </button>
            <p v-if="!rows.length" class="hint">没有匹配内容。可以新建独立对象，或在外部添加后自动刷新。</p></template
          >
        </template>
        <template v-else-if="tab === 'assets'"
          ><button v-if="history.length" class="back-link" @click="back">← 返回内容</button>
          <header class="page-heading">
            <div>
              <h1>资源</h1>
              <p>查看已有资源、预览效果，并跳转到使用它的内容。</p>
            </div>
            <input v-model="search" type="search" aria-label="搜索资源" placeholder="搜索资源名称" />
            <button v-if="!readOnly" :disabled="busy" @click="attempt(importAsset)">导入资源</button>
          </header>
          <div class="asset-layout">
            <div class="resource-list">
              <button
                v-for="resource in visibleAssets"
                :key="resource.id"
                :aria-pressed="selectedAssetId === resource.id"
                @click="attempt(() => readAsset(resource.source, resource.id))"
              >
                <strong>{{ resource.name }}</strong
                ><small
                  >{{ /^https?:/.test(resource.source) ? '远程资源' : '项目资源' }} ·
                  {{
                    effectiveRecords.filter(
                      row => row.kind === 'presentations' && resourcePaths(row.record).includes(resource.id),
                    ).length
                  }}
                  处使用</small
                >
              </button>
            </div>
            <section v-if="asset" class="asset-detail">
              <p v-if="assetLoading" role="status">正在读取资源…</p>
              <SourceMediaPreview v-if="asset.bytes.length" :file="asset.file.split('?')[0]!" :bytes="asset.bytes" />
              <label v-if="assetRecord"
                >素材位置
                <input
                  :value="String(assetRecord.record.source)"
                  :disabled="readOnly || !!sharedAt(assetRecord.sharedFields ?? [], ['source'])"
                  @change="editAssetSource"
                />
              </label>
              <p v-if="assetRecord" class="hint">资源 ID：{{ assetRecord.record.id }} · 修改位置会保留全部关联</p>
              <h3>使用此资源的内容</h3>
              <button v-for="row in assetUsers" :key="recordKey(row)" @click="navigate(row.kind, row.record.id)">
                {{ label(row) }} ↗
              </button>
              <p v-if="!assetUsers.length" class="hint">目前没有静态引用。效果代码中的动态使用需在外部确认。</p>
              <details class="source-details">
                <summary>来源详情</summary>
                <p>{{ asset.file }}</p>
                <button
                  v-if="assetRecord && !readOnly"
                  @click="attempt(() => external(assetRecord?.file, assetRecord?.line, assetRecord?.column))"
                >
                  在外部编辑器打开资源定义 ↗
                </button>
                <button
                  v-if="!/^https?:/.test(asset.file)"
                  @click="attempt(() => action({ action: 'show', file: asset!.file }))"
                >
                  在文件管理器中显示
                </button>
              </details>
            </section>
            <p v-else class="hint">{{ assetLoading ? '正在读取资源…' : '选择一项资源进行预览' }}</p>
          </div></template
        >
        <AssistantPanel
          v-else-if="tab === 'assistant'"
          v-model:proposals="assistantProposals"
          :key="assistantSession"
          :entries="assistantEntries"
          :initial-keys="assistantKeys"
          :context="assistantContext"
          :labels="labels"
          :project-id="projectId"
          :value="proposalValue"
          :apply="applyProposal"
          @prepare="options => attempt(async () => prepareAssistant(options))"
        />
        <template v-else-if="tab === 'tools'"
          ><header class="page-heading">
            <div>
              <h1>外部工具接入</h1>
              <p>MCP 读取已保存源文件；AI 协作页可另行交接所选对象的草稿快照。</p>
              <p>
                {{
                  readOnly
                    ? '此包的 MCP 连接仅提供读取，不提供修改或运行项目的工具。'
                    : '下方 MCP 配置授权访问整个源项目；AI 协作页中的选择仅限定交接内容与建议导入范围。'
                }}
              </p>
            </div>
          </header>
          <label v-if="!readOnly" class="checkbox"
            ><input v-model="assistantExecution" type="checkbox" />允许助手会话运行项目测试、演示对战和打包</label
          >
          <div class="tools">
            <button :disabled="busy" @click="attempt(copyConnection)">复制 MCP 连接配置</button
            ><button v-if="!readOnly" @click="attempt(() => external('skills/arcadia-content-authoring/SKILL.md'))">
              打开项目 Skill ↗
            </button>
          </div>
          <p class="hint">源文件发生变化时，草稿会保留并进入核对流程。代码与文件整理继续使用外部工具。</p></template
        >
        <template v-else
          ><header class="page-heading">
            <div>
              <h1>{{ tab === 'effects' ? '效果代码' : '检查与运行' }}</h1>
              <p>
                {{ tab === 'effects' ? '在外部编辑器维护效果实现，保存后自动更新。' : '任务读取已保存的项目源文件。' }}
              </p>
            </div>
          </header>
          <div v-if="tab === 'tests'" class="tools">
            <button :disabled="busy || running || dirty" @click="attempt(() => start('check'))">检查内容与类型</button
            ><button :disabled="busy || running || dirty" @click="attempt(() => start('test'))">运行场景测试</button
            ><button :disabled="busy || running || dirty" @click="attempt(() => start('demo'))">运行演示对战</button
            ><button :disabled="busy || running || dirty" @click="attempt(() => start('pack'))">构建内容包</button>
          </div>
          <div class="file-links">
            <button v-for="file in files" :key="file.file" @click="attempt(() => external(file.file))">
              {{ file.file }} ↗
            </button>
          </div>
          <article v-for="job in tab === 'tests' ? jobs : []" :key="job.jobId" class="job">
            <header>
              <h3>{{ jobTitles[job.kind] || job.kind }} · {{ job.state }}</h3>
              <button
                v-if="['queued', 'running'].includes(job.state)"
                @click="attempt(() => action({ action: 'cancel', jobId: job.jobId }))"
              >
                取消
              </button>
            </header>
            <p v-if="job.stale" class="error">源码已变化，此结果对应旧修订。</p>
            <p v-for="(item, index) in job.diagnostics" :key="index" class="error">
              {{ item.message }}
              <button v-if="item.file" @click="attempt(() => external(item.file, item.line, item.column))">
                打开位置
              </button>
            </p>
            <details>
              <summary>运行输出与来源</summary>
              <small>源修订 {{ job.sourceRevision.slice(0, 12) }}</small>
              <p v-if="job.result?.candidate">内容包 {{ job.result.candidate.integrity }}</p>
              <pre>{{ job.output || '等待输出…' }}</pre>
            </details>
          </article></template
        >
      </section>
    </div>
    <details v-if="snapshot?.diagnostics.length" class="diagnostics">
      <summary>{{ snapshot.diagnostics.length }} 个源内容问题</summary>
      <p v-for="(item, index) in snapshot.diagnostics" :key="index">
        {{ item.message }}
        <button v-if="item.file" @click="attempt(() => external(item.file, item.line, item.column))">打开位置 ↗</button>
      </p>
    </details>
  </main>
</template>
<style scoped src="./author-workspace.css"></style>
