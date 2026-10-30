<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import RecordForm from './RecordForm.vue'
import LocaleFields from './LocaleFields.vue'
import ChangeReview from './ChangeReview.vue'
import SourceMediaPreview from './SourceMediaPreview.vue'
import { readResourceBytes } from '@/services/resourceTransport'
import { descriptionProblem } from './AuthorDescription'
import { useAuthorDrafts, isConflict, recordKey, reviewToken, type AuthorDraft } from './drafts'
import { sharedFieldsUnder } from './fields'
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
const tab = ref('species'),
  selectedId = ref(''),
  section = ref<'base' | 'references' | 'media'>('base')
const screen = ref<'editor' | 'save' | 'conflict' | 'discard'>('editor')
const locale = ref(localStorage.getItem('arcadia-author-locale') || 'zh-CN')
const editor = ref(localStorage.getItem('arcadia-author-editor') || 'code'),
  assistantExecution = ref(false)
const jobs = ref<AuthorJob[]>([]),
  choices = ref<Record<string, string>>({}),
  reviewed = ref<Record<string, string>>({})
const history = ref<{ kind: string; id: string; section: 'base' | 'references' | 'media' }[]>([])
const asset = ref<{ file: string; bytes: Uint8Array }>(),
  assetLoading = ref(false)
const jobTitles: Record<string, string> = { check: '检查', test: '场景测试', demo: '演示对战', pack: '打包' }
const tabs: Record<string, string> = {
  species: '精灵',
  skills: '技能',
  marks: '印记',
  assets: '资源',
  effects: '效果代码',
  tests: '检查与运行',
  assistant: 'AI 助手',
}
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
const effectiveRecords = computed(() =>
  (snapshot.value?.records ?? []).map(row => ({
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
        record: draft.base as ContentRow,
        sharedFields: draft.sharedFields,
      }
    : undefined
})
const currentDraft = computed(() => (selected.value ? drafts[recordKey(selected.value)] : undefined))
function openDraft(draft: AuthorDraft) {
  navigate(draft.kind, draft.id)
  if (draft.language) locale.value = draft.language
}
const currentRecord = computed(() =>
  selected.value ? ((currentDraft.value?.value ?? selected.value.record) as ContentRow) : undefined,
)
const languages = computed(() => [
  ...new Set([locale.value, ...(snapshot.value?.localeSources ?? []).map(source => source.language)]),
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
      row.kind === tab.value &&
      `${label(row)} ${row.record.id}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()),
  ),
)
const currentLocaleSource = computed(() =>
  selected.value ? textSource(snapshot.value?.localeSources ?? [], selected.value, locale.value) : undefined,
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
    ? consumers(effectiveRecords.value, { kind: selected.value.kind, id: selected.value.record.id }, projectId.value)
    : [],
)
const impacts = computed(() =>
  Object.fromEntries(
    pending.value.map(draft => [draft.key, consumers(effectiveRecords.value, draft, projectId.value).map(label)]),
  ),
)
const assets = computed(() =>
  [
    ...new Set([
      ...(snapshot.value?.assets ?? []).map(row => row.file),
      ...effectiveRecords.value.flatMap(row => resourcePaths(row.record.presentation)),
    ]),
  ].filter(file => /\.(png|jpe?g|webp|mp3|ogg|swf)(\?|$)/i.test(file)),
)
const visibleAssets = computed(() =>
  assets.value.filter(file => file.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())),
)
const assetUsers = computed(() =>
  asset.value
    ? effectiveRecords.value.filter(row => resourcePaths(row.record.presentation).includes(asset.value!.file))
    : [],
)
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
  const oldAsset = snapshot.value?.assets.find(row => row.file === asset.value?.file)
  snapshot.value = next
  store.sync(next)
  if (screen.value === 'conflict' && conflicts.value.some(draft => reviewed.value[draft.key] !== reviewToken(draft))) {
    captureConflict()
    notice.value = '外部来源再次变化，请根据最新内容重新选择。'
  }
  if (asset.value && !/^https?:/.test(asset.value.file)) {
    const current = next.assets.find(row => row.file === asset.value!.file)
    if (!current) {
      asset.value = undefined
      notice.value = '资源已移走或删除。请在外部整理引用。'
    } else if (oldAsset?.modified !== current.modified || oldAsset?.size !== current.size)
      await readAsset(asset.value.file)
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
  snapshot.value = undefined
  selectedId.value = ''
  asset.value = undefined
  jobs.value = []
  history.value = []
  screen.value = 'editor'
  store.clear()
  if (previous && previous !== next.id) await authorCall({ action: 'close', id: previous })
  const opened = await refresh()
  tab.value = 'species'
  selectedId.value = opened?.records.find(row => row.kind === 'species')?.record.id ?? ''
  localStorage.setItem('arcadia-author-project', next.id)
}
function switchTab(key: string) {
  tab.value = key
  selectedId.value = ''
  screen.value = 'editor'
  history.value = []
  search.value = ''
  error.value = ''
}
function navigate(kind: string, id: string) {
  const matches = snapshot.value?.records.filter(row => row.kind === kind && row.record.id === id) ?? []
  const row = matches.length === 1 ? matches[0] : undefined
  if (kind === 'behaviors') {
    void attempt(() => external(row?.file))
    return
  }
  if (!row && !drafts[keyFor(kind, id)]) {
    error.value = '未找到唯一的内容对象，请检查外部引用、重复 ID 或依赖。'
    return
  }
  if (selected.value) history.value.push({ kind: tab.value, id: selectedId.value, section: section.value })
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
  if (selected.value) {
    store.editRecord(selected.value, record)
    if (snapshot.value) store.sync(snapshot.value)
  }
}
function editText(text: LocaleText) {
  if (selected.value && currentLocaleSource.value) {
    store.editLocale(currentLocaleSource.value, selectedId.value, tab.value, text)
    if (snapshot.value) store.sync(snapshot.value)
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
async function readAsset(file: string) {
  const id = project.value?.id,
    request = ++mediaEpoch
  mediaController?.abort()
  mediaController = new AbortController()
  assetLoading.value = true
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
async function preview(file: string) {
  if (selected.value) history.value.push({ kind: tab.value, id: selectedId.value, section: section.value })
  tab.value = 'assets'
  screen.value = 'editor'
  search.value = ''
  await readAsset(file)
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
        <router-link to="/content">ARCADIA</router-link><span>/ 创作</span
        ><span v-if="project" class="project-name">{{ project.name }}</span>
      </div>
      <label v-if="project"
        >内容语言<select v-model="locale" :disabled="busy">
          <option v-for="language in languages" :key="language">{{ language }}</option>
        </select></label
      ><router-link to="/content">内容包管理 ↗</router-link>
    </header>
    <details class="project-settings" :open="!project">
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
        <label
          >外部编辑器<select v-model="editor">
            <option value="code">VS Code</option>
            <option value="codium">VSCodium</option>
            <option value="cursor">Cursor</option>
            <option value="zed">Zed</option>
          </select></label
        ><button :disabled="busy" @click="attempt(() => external())">打开编辑器</button
        ><button :disabled="busy" @click="attempt(() => action({ action: 'show' }))">显示项目文件夹</button
        ><button :disabled="busy || dirty" @click="attempt(() => action({ action: 'export' }))">导出源项目</button
        ><button
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
    <div v-if="project" class="savebar">
      <div>
        <strong>{{ dirty ? `未保存 · ${pending.length} 项内容修改` : '所有修改已保存' }}</strong
        ><small>{{ conflicts.length ? '检测到外部变化，保存已暂停' : '预览包含草稿；切换内容会保留修改' }}</small>
      </div>
      <div class="tools">
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
    </div>
    <p v-if="error" class="banner error" role="alert">{{ error }}</p>
    <p v-if="notice" class="banner" role="status">{{ notice }}</p>
    <div v-if="!project" class="welcome">
      <h1>让你的内容加入战斗</h1>
      <p>打开已有内容包，或从模板开始。精灵、技能、印记和资源在这里关联，效果代码在外部编辑器维护。</p>
    </div>
    <div v-else class="workspace">
      <aside class="sidebar">
        <small>{{ project.name }}</small>
        <nav aria-label="内容分类">
          <button
            v-for="(title, key) in tabs"
            :key="key"
            :aria-pressed="tab === key && screen === 'editor'"
            @click="switchTab(key)"
          >
            {{ title
            }}<span v-if="['species', 'skills', 'marks'].includes(key)">{{
              snapshot?.records.filter(row => row.kind === key).length
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
        <template v-else-if="['species', 'skills', 'marks'].includes(tab)">
          <template v-if="selected && currentRecord"
            ><button class="back-link" @click="back">← {{ history.length ? '返回上一项' : tabs[tab] }}</button>
            <header class="page-heading">
              <div>
                <h1>
                  {{ labels[`${tab}:${selectedId}`] || currentRecord.name || selectedId
                  }}<span v-if="currentDraft" class="badge">草稿</span>
                </h1>
                <small>{{ tabs[tab] }} · {{ currentRecord.element || '内容对象' }}</small>
              </div>
              <button @click="section = 'base'">预览名称与描述</button>
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
                  :key="recordKey(selected)"
                  :record="currentRecord"
                  :kind="selected.kind"
                  :records="effectiveRecords"
                  :project-id="projectId"
                  :assets="assets"
                  :shared-fields="currentDraft?.sharedFields ?? selected.sharedFields"
                  :section="section"
                  hide-identity
                  :labels="labels"
                  @change="editRecord"
                  @navigate="navigate"
                  @preview="file => attempt(() => preview(file))"
                  @external="
                    (line, column) =>
                      attempt(() =>
                        external(
                          currentDraft?.file ?? selected?.file,
                          line ?? selected?.line,
                          column ?? selected?.column,
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
                <h1>{{ tabs[tab] }}</h1>
                <p>选择已有内容，查看关系并编辑。</p>
              </div>
              <input v-model="search" type="search" aria-label="搜索内容" placeholder="搜索名称或 ID" />
            </header>
            <div class="catalog">
              <button
                v-for="row in rows"
                :key="recordKey(row) + row.file"
                class="content-card"
                @click="navigate(row.kind, row.record.id)"
              >
                <strong>{{ label(row) }}</strong
                ><small>{{ row.record.element || row.record.id }}{{ drafts[recordKey(row)] ? ' · 有草稿' : '' }}</small>
                <p>
                  {{
                    localized(row, locale).description ||
                    localized(row, defaultLanguage).description ||
                    '查看资料与引用关系'
                  }}
                </p>
              </button>
            </div>
            <p v-if="!rows.length" class="hint">没有匹配内容。在外部编辑器添加并保存后，这里会自动刷新。</p></template
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
          </header>
          <div class="asset-layout">
            <div class="resource-list">
              <button
                v-for="file in visibleAssets"
                :key="file"
                :aria-pressed="asset?.file === file"
                @click="attempt(() => readAsset(file))"
              >
                <strong>{{ file.split('/').at(-1)?.split('?')[0] }}</strong
                ><small
                  >{{ /^https?:/.test(file) ? '远程资源' : '项目资源' }} ·
                  {{ effectiveRecords.filter(row => resourcePaths(row.record.presentation).includes(file)).length }}
                  处使用</small
                >
              </button>
            </div>
            <section v-if="asset" class="asset-detail">
              <p v-if="assetLoading" role="status">正在读取资源…</p>
              <SourceMediaPreview :file="asset.file.split('?')[0]!" :bytes="asset.bytes" />
              <h3>使用此资源的内容</h3>
              <button v-for="row in assetUsers" :key="recordKey(row)" @click="navigate(row.kind, row.record.id)">
                {{ label(row) }} ↗
              </button>
              <p v-if="!assetUsers.length" class="hint">目前没有静态引用。效果代码中的动态使用需在外部确认。</p>
              <details class="source-details">
                <summary>来源详情</summary>
                <p>{{ asset.file }}</p>
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
        <template v-else-if="tab === 'assistant'"
          ><header class="page-heading">
            <div>
              <h1>连接编码助手</h1>
              <p>助手与工作台使用同一份项目源文件。</p>
            </div>
          </header>
          <label class="checkbox"
            ><input v-model="assistantExecution" type="checkbox" />允许助手会话运行项目测试、演示对战和打包</label
          >
          <div class="tools">
            <button :disabled="busy" @click="attempt(copyConnection)">复制 MCP 连接配置</button
            ><button @click="attempt(() => external('skills/arcadia-content-authoring/SKILL.md'))">
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
