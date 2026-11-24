<script setup lang="ts">
import {
  ElMessage,
  ElMessageBox,
  ElButton,
  ElSelectV2,
  ElDialog,
  ElInput,
  ElCheckbox,
  ElProgress,
  ElTabs,
  ElTabPane,
} from 'element-plus'
import { getBackendOrigin } from '@/bootstrap/deployment'
import { contentTaskError } from '@/utils/contentTaskMessages'
import { useRouter } from 'vue-router'
import PackageEnvironmentTargets from './PackageEnvironmentTargets.vue'
import EnvironmentFingerprint from './EnvironmentFingerprint.vue'
import EnvironmentPackagePreview from './EnvironmentPackagePreview.vue'
import { indexPackagePreviews, packagePreview, type PackagePreview } from './environmentPackagePreview'
import { createLocalContentLibraryClient } from './contentLibraryClient'
import { authorCall, type AuthorJob, type SourceProject } from '@/features/authoring/types'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useGameDataStore } from '@/stores/gameData'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { useBattleClientStore } from '@/stores/battleClient'
import { usePetStorageStore } from '@/stores/petStorage'
import { listServerEnvironments, readServerEnvironmentContent } from '@/services/serverEnvironment'
import { isStaticMode } from '@/utils/env'
import { findMissingTeamContent, type TeamContentLookup } from '@/utils/teamContent'
import type {
  ContentIds,
  ContentLibrarySnapshot,
  InstalledContentPackage,
  PackageGraphEntry,
} from '@/types/contentPackages'
import type { ServerEnvironmentContent, ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'

interface PackageView {
  id: string
  name: string
  title: string
  version?: string
  namespace?: string
  author?: string
  description?: string
  source: string
  counts?: { species: number; skills: number; marks: number }
  graph?: PackageGraphEntry[]
  preview?: PackagePreview
  contentIds?: ContentIds
  builtin?: boolean
  project?: SourceProject
  local?: InstalledContentPackage
  error?: string
}
const props = defineProps<{
  location?: 'local' | 'server' | 'room'
  projects?: SourceProject[]
  projectsLoading?: boolean
}>()
const emit = defineEmits<{ refreshProjects: [] }>()
const filter = ref<'all' | 'projects' | 'installed' | 'issues'>('all')
const router = useRouter()
const canAuthor = (!props.location || props.location === 'local') && !!window.arcadiaDesktop?.author
async function browsePackage(id: string) {
  await router.push({ name: 'AuthorWorkspace', params: { projectId: id }, query: { view: 'editor' } })
}
const api = !props.location || props.location === 'local' ? window.arcadiaDesktop : undefined
const libraryClient = createLocalContentLibraryClient(api)
const local = !!libraryClient
const gameData = useGameDataStore()
const rooms = usePrivateRoomStore()
const battle = useBattleClientStore()
const pets = usePetStorageStore()
const room = computed(() => rooms.currentRoom)
const snapshot = ref<ContentLibrarySnapshot>()
const mode = ref<'installed' | 'issues' | 'server' | 'room'>(
  props.location === 'server'
    ? 'server'
    : props.location === 'room'
      ? 'room'
      : local || props.location === 'local'
        ? 'installed'
        : room.value
          ? 'room'
          : 'server',
)
const selectedId = ref('')
const detailTab = ref<'overview' | 'dependencies' | 'impact'>('overview')
const detailOpen = ref(false)
const query = ref('')
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const offline = ref(false)
const serverEnvironments = shallowRef<ServerEnvironmentDescriptor[]>([])
const serverEnvironmentOptions = computed(() =>
  serverEnvironments.value.map(environment => ({
    value: environment.id,
    label:
      (environment.isDefault ? '默认环境 · ' : '') +
      (environment.packages.map(pkg => pkg.name + ' ' + pkg.version).join('、') || '空环境'),
  })),
)
const serverEnvironmentId = ref('')
const serverLoading = ref(false)
const serverError = ref('')
const remoteContent = shallowRef<ServerEnvironmentContent>()
const remotePreviews = computed(() => indexPackagePreviews(remoteContent.value))
const remoteLoading = ref(false)
const remoteError = ref('')
const adding = ref(false)
const npmSpec = ref('')
const installKind = ref<'npm' | 'url' | 'git' | 'project'>('npm')
const archiveUrl = ref(''),
  archiveIntegrity = ref(''),
  gitUrl = ref(''),
  commit = ref(''),
  artifactPath = ref('')
const buildProjects = ref<SourceProject[]>([]),
  buildProject = ref(''),
  latestBuild = ref<AuthorJob>()
watch([adding, installKind], async ([show, kind], _, onCleanup) => {
  let current = true
  onCleanup(() => {
    current = false
  })
  if (!show || kind !== 'project') return
  try {
    const rows = await authorCall<SourceProject[]>({ action: 'list' })
    if (current) buildProjects.value = rows.filter(row => !row.readOnly)
  } catch (cause) {
    if (current) error.value = String(cause)
  }
})
watch([adding, buildProject, installKind], async ([show, id, kind], _, onCleanup) => {
  let current = true
  onCleanup(() => {
    current = false
  })
  latestBuild.value = undefined
  if (!show || !id || kind !== 'project') return
  try {
    const jobs = await authorCall<AuthorJob[]>({ action: 'jobs', id })
    const latest = jobs.find(job => ['release', 'pack'].includes(job.kind))
    if (current && latest?.state === 'succeeded' && !latest.stale) latestBuild.value = latest
  } catch (cause) {
    if (current) error.value = String(cause)
  }
})
const canInstall = computed(() =>
  installKind.value === 'npm'
    ? !!npmSpec.value.trim()
    : installKind.value === 'url'
      ? archiveUrl.value.startsWith('https://')
      : installKind.value === 'git'
        ? gitUrl.value.startsWith('https://') && /^[a-f0-9]{40}$/i.test(commit.value)
        : !!latestBuild.value,
)
async function installSelected() {
  if (!canInstall.value) return
  if (installKind.value === 'npm') return inspectNpm()
  if (installKind.value === 'project') {
    const jobId = latestBuild.value?.jobId,
      id = buildProject.value
    return installSource(
      async () =>
        (await authorCall<{ packageId: string }>({ action: 'install-built-author-pack', id, jobId })).packageId,
    )
  }
  const source =
    installKind.value === 'url'
      ? { kind: 'url' as const, url: archiveUrl.value.trim(), integrity: archiveIntegrity.value.trim() || undefined }
      : {
          kind: 'git' as const,
          url: gitUrl.value.trim(),
          commit: commit.value.trim(),
          artifactPath: artifactPath.value.trim() || undefined,
        }
  return installSource(() => libraryClient!.action({ action: 'install-remote', source }))
}
let disposed = false
let refreshRequest = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
const readonly = computed(() => mode.value === 'server' || mode.value === 'room')
const serverCatalogUrl = computed(() =>
  mode.value === 'server' && !isStaticMode
    ? props.location
      ? getBackendOrigin()
      : !local || battle.isConnected
        ? battle.serverUrl
        : undefined
    : undefined,
)
const remoteEnvironment = computed(() =>
  mode.value === 'room'
    ? (room.value?.personalEnvironment?.descriptor ?? room.value?.environment)
    : serverEnvironments.value.find(environment => environment.id === serverEnvironmentId.value),
)
const emptyIds = (): ContentIds => ({ species: [], skills: [], marks: [] })
const publicIds = (content: ServerEnvironmentContent, namespace?: string): ContentIds =>
  Object.fromEntries(
    (['species', 'skills', 'marks'] as const).map(kind => [
      kind,
      content[kind]
        .filter(item => (namespace ? item.id.startsWith(namespace + ':') : !item.id.includes(':')))
        .map(item => item.id),
    ]),
  ) as unknown as ContentIds
const packages = computed<PackageView[]>(() => {
  if (readonly.value)
    return (remoteEnvironment.value?.packages ?? []).map(pkg => {
      const ids = remoteContent.value
        ? publicIds(remoteContent.value, pkg.projectId === 'base' ? undefined : pkg.namespace)
        : emptyIds()
      return {
        id: pkg.projectId,
        name: pkg.name,
        title: pkg.name,
        version: pkg.version,
        namespace: pkg.namespace,
        author: '',
        description: '',
        source: mode.value === 'room' ? (room.value?.personalEnvironment ? '私人环境' : '房间服务器') : '当前服务器',
        contentIds: ids,
        preview: packagePreview(remotePreviews.value, pkg),
      }
    })
  const sources: PackageView[] = (props.projects ?? []).map(project => ({
    id: 'project:' + project.id,
    name: project.name,
    title: project.name,
    source: project.directory,
    project,
  }))
  const installed = (snapshot.value?.packages ?? []).map(pkg => ({
    id: pkg.id,
    name: pkg.name,
    title: pkg.title,
    version: pkg.version,
    namespace: pkg.namespace,
    author: pkg.author,
    description: pkg.description,
    source: pkg.source.label,
    contentIds: pkg.contentIds,
    graph: pkg.graph,
    counts: pkg.counts,
    builtin: pkg.bundled,
    local: pkg,
    error: pkg.error,
  }))
  return [...sources, ...installed]
})
const tasksOpen = ref(false)
const installLabels: Record<string, string> = {
  queued: '排队中',
  running: '下载、安装与校验',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}
async function installTaskAction(action: 'cancel-install' | 'retry-install' | 'clear-install-tasks', operationId = '') {
  try {
    await libraryClient!.action(action === 'clear-install-tasks' ? { action } : { action, operationId })
    await refresh()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '任务操作失败'
  }
}
const visiblePackages = computed(() =>
  packages.value.filter(
    pkg =>
      (filter.value !== 'projects' || !!pkg.project) &&
      (filter.value !== 'installed' || !!pkg.local) &&
      ((mode.value !== 'issues' && filter.value !== 'issues') || !!pkg.error) &&
      [pkg.title, pkg.name, pkg.author].join(' ').toLowerCase().includes(query.value.toLowerCase()),
  ),
)
const selected = computed(
  () => visiblePackages.value.find(pkg => pkg.id === selectedId.value) ?? visiblePackages.value[0],
)
const issueCount = computed(() => snapshot.value?.packages.filter(pkg => pkg.error).length ?? 0)
const proposedLookup = computed<TeamContentLookup>(() => {
  const available = emptyIds()
  if (readonly.value && remoteContent.value) {
    for (const kind of ['species', 'skills', 'marks'] as const)
      available[kind] = remoteContent.value[kind].map(item => item.id)
  } else {
    return {
      getSpecies: id => gameData.getSpecies(id),
      getSkill: id => gameData.getSkill(id),
      getMark: id => gameData.getMark(id),
    }
  }
  const sets = {
    species: new Set(available.species),
    skills: new Set(available.skills),
    marks: new Set(available.marks),
  }
  return {
    getSpecies: id => sets.species.has(id),
    getSkill: id => sets.skills.has(id),
    getMark: id => sets.marks.has(id),
  }
})
const relatedTeams = computed(() => {
  if (!selected.value?.contentIds) return []
  const ids = new Set(Object.values(selected.value.contentIds).flat())
  return pets.teams
    .filter(team =>
      team.pets.some(pet => [pet.species, ...pet.skills, pet.ability, pet.emblem].some(id => !!id && ids.has(id))),
    )
    .map(team => ({ name: team.name, missing: findMissingTeamContent(team.pets, proposedLookup.value) }))
})
function select(pkg: PackageView) {
  selectedId.value = pkg.id
  detailOpen.value = true
  detailTab.value = 'overview'
}
function addOtherVersion() {
  if (!selected.value) return
  installKind.value = 'npm'
  npmSpec.value = selected.value.name + '@'
  adding.value = true
}
function changeMode(value: typeof mode.value) {
  mode.value = value
  query.value = ''
  detailOpen.value = false
  selectedId.value = value === 'issues' ? (snapshot.value?.packages.find(pkg => pkg.error)?.id ?? '') : ''
}
async function refresh() {
  if (!local) return
  const request = ++refreshRequest
  const result = await libraryClient!.list()
  if (disposed || request !== refreshRequest) return
  snapshot.value = result
}
function refreshLists() {
  emit('refreshProjects')
  void run(refresh)
}
async function poll() {
  try {
    await refresh()
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : '无法读取内容状态'
  } finally {
    if (!disposed) pollTimer = setTimeout(poll, 1500)
  }
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '内容包操作失败'
  } finally {
    busy.value = false
  }
}
async function installSource(source: () => Promise<string | null>) {
  if (!local) return
  await run(async () => {
    adding.value = false
    tasksOpen.value = true
    const id = await source()
    if (!id || disposed) return
    await refresh()
    adding.value = false
    filter.value = 'all'
    query.value = ''
    selectedId.value = id
    detailOpen.value = true
    notice.value = '内容包已安装。'
  })
}
async function inspectFile() {
  await installSource(() => libraryClient!.installFile({ offline: offline.value }))
}
async function inspectNpm() {
  await installSource(() => libraryClient!.installNpm({ spec: npmSpec.value.trim(), offline: offline.value }))
}
async function checkPackageUpdate() {
  const pkg = selected.value?.local
  if (!pkg || !libraryClient) return
  await run(async () => {
    const version = await libraryClient.action({ action: 'check-update', packageId: pkg.id })
    if (!version) {
      ElMessage.info('当前已安装最新兼容版本')
      return
    }
    const confirmed = await ElMessageBox.confirm(`${pkg.name}  ${pkg.version} → ${version}`, '数据包更新', {
      confirmButtonText: '安装更新',
      cancelButtonText: '取消',
    }).then(
      () => true,
      () => false,
    )
    if (!confirmed) return
    const id = await libraryClient.action({ action: 'apply-update', packageId: pkg.id, version })
    if (id) selectedId.value = id
    await refresh()
    ElMessage.success(pkg.bundled ? '官方环境已更新' : '新版本已安装，可在环境中选择')
  })
}
async function uninstall() {
  const pkg = selected.value
  if (!local || !pkg?.local) return
  await run(async () => {
    await libraryClient!.action({ action: 'uninstall', packageId: pkg.id })
    await refresh()
    selectedId.value = ''
    notice.value = '内容包已卸载'
  })
}
watch(
  () => !!room.value,
  inRoom => {
    if (!inRoom && mode.value === 'room') changeMode('server')
  },
)
watch(
  serverCatalogUrl,
  async (server, _previous, onCleanup) => {
    serverEnvironments.value = []
    serverEnvironmentId.value = ''
    serverError.value = ''
    serverLoading.value = !!server
    if (!server) return
    const controller = new AbortController()
    const { signal } = controller
    onCleanup(() => controller.abort())
    try {
      const environments = await listServerEnvironments(server, fetch, signal)
      if (signal.aborted) return
      serverEnvironments.value = environments
      serverEnvironmentId.value = (environments.find(environment => environment.isDefault) ?? environments[0])?.id ?? ''
    } catch (cause) {
      if (!signal.aborted) serverError.value = cause instanceof Error ? cause.message : '无法读取服务器环境'
    } finally {
      if (!signal.aborted) serverLoading.value = false
    }
  },
  { immediate: true },
)
watch(
  [
    () => (mode.value === 'server' ? serverCatalogUrl.value : battle.serverUrl),
    () => remoteEnvironment.value?.id,
    () => remoteEnvironment.value?.resourceRevision,
    () => (mode.value === 'room' && room.value?.personalEnvironment ? rooms.personalEnvironment?.content : undefined),
  ],
  async ([server, id, , personalContent], _previous, onCleanup) => {
    remoteContent.value = undefined
    remoteError.value = ''
    remoteLoading.value = false
    if (mode.value === 'room' && room.value?.personalEnvironment) {
      if (rooms.personalEnvironment?.reference.descriptor.id === id && personalContent)
        remoteContent.value = personalContent
      return
    }
    if (!id || !server) return
    const controller = new AbortController()
    const { signal } = controller
    onCleanup(() => controller.abort())
    remoteLoading.value = true
    try {
      const result = await readServerEnvironmentContent(server, id, fetch, signal)
      if (!signal.aborted) remoteContent.value = result
    } catch (cause) {
      if (!signal.aborted) remoteError.value = cause instanceof Error ? cause.message : '无法读取环境内容'
    } finally {
      if (!signal.aborted) remoteLoading.value = false
    }
  },
  { immediate: true },
)
onMounted(() => {
  if (local) {
    loading.value = true
    void poll().finally(() => {
      loading.value = false
    })
  }
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(pollTimer)
})
</script>

<template>
  <section
    class="content-page"
    :class="{ 'detail-open': detailOpen && selected, 'remote-packages': props.location && props.location !== 'local' }"
  >
    <span v-if="readonly" class="scope">只读</span>
    <EnvironmentFingerprint
      v-if="readonly && remoteEnvironment?.environmentVersion"
      :key="remoteEnvironment.environmentVersion"
      :value="remoteEnvironment.environmentVersion"
    />
    <p v-if="error" class="message error" role="alert">{{ error }}</p>
    <p v-if="notice" class="message" role="status">{{ notice }}</p>
    <div class="workspace">
      <section class="package-workspace" aria-label="内容包管理">
        <div class="toolbar">
          <label v-if="projects" class="package-filter"
            >类型
            <select v-model="filter" aria-label="内容包类型" @change="detailOpen = false">
              <option value="all">全部</option>
              <option value="projects">创作包</option>
              <option value="installed">本地包</option>
              <option v-if="issueCount || filter === 'issues'" value="issues">需处理</option>
            </select>
          </label>
          <nav v-else-if="!props.location || props.location === 'local'" class="task-nav" aria-label="内容包导航">
            <template v-if="local && (!props.location || props.location === 'local')"
              ><p class="nav-label">本机内容包</p>
              <button :aria-current="mode === 'installed' ? 'page' : undefined" @click="changeMode('installed')">
                全部 <span>{{ snapshot?.packages.length ?? 0 }}</span></button
              ><button :aria-current="mode === 'issues' ? 'page' : undefined" @click="changeMode('issues')">
                需处理 <span>{{ issueCount }}</span>
              </button>
              <hr
            /></template>
            <template v-if="!props.location"
              ><p class="nav-label">联机内容包</p>
              <button :aria-current="mode === 'server' ? 'page' : undefined" @click="changeMode('server')">
                服务器内容
              </button>
              <button v-if="room" :aria-current="mode === 'room' ? 'page' : undefined" @click="changeMode('room')">
                房间内容
              </button></template
            >
          </nav>
          <ElInput
            clearable
            style="width: min(100%, 22rem)"
            v-model="query"
            type="search"
            aria-label="搜索内容包"
            placeholder="搜索内容包名称或作者"
          />
          <template v-if="local && !readonly"
            ><button class="primary" :disabled="busy" @click="adding = true">
              {{ projects ? '安装内容包' : '添加内容包' }}</button
            ><button :disabled="busy" @click="refreshLists">刷新</button>
            <button @click="tasksOpen = true">
              下载与安装
              {{ snapshot?.operations?.filter(job => ['queued', 'running'].includes(job.status)).length || '' }}
            </button></template
          >
        </div>
        <template v-if="mode === 'server'">
          <p v-if="!serverCatalogUrl" class="context-note">
            {{ isStaticMode ? '离线网页没有配对的服务器。' : '连接服务器后可查看已发布的内容包。' }}
          </p>
          <p v-else-if="serverError" class="message error" role="alert">{{ serverError }}</p>
          <p v-else-if="!serverLoading && !serverEnvironments.length" class="context-note">服务器暂无公开环境。</p>
          <label v-else-if="serverEnvironments.length" class="server-environment-picker">
            服务器环境
            <ElSelectV2
              v-model="serverEnvironmentId"
              :options="serverEnvironmentOptions"
              filterable
              aria-label="服务器环境"
              @change="changeMode('server')"
            />
          </label>
        </template>
        <p v-else-if="mode === 'room' && room" class="context-note">房间 {{ room.config.roomCode }}</p>
        <p v-if="readonly && remoteError" class="message error" role="alert">{{ remoteError }}</p>
        <div class="columns">
          <div class="package-list">
            <p
              v-if="projectsLoading || loading || (readonly && (serverLoading || remoteLoading))"
              class="list-note"
              role="status"
            >
              正在读取内容包…
            </p>
            <div
              v-for="pkg in visiblePackages"
              :key="pkg.id"
              class="package-row"
              :class="{ selected: selected?.id === pkg.id }"
            >
              <button
                class="package-select"
                :aria-current="selected?.id === pkg.id ? 'true' : undefined"
                @click="select(pkg)"
              >
                <span class="package-icon" aria-hidden="true">{{
                  pkg.builtin ? 'AE' : pkg.title.replace(/^@/, '').slice(0, 1).toUpperCase()
                }}</span
                ><span class="package-title"
                  >{{ pkg.title
                  }}<small v-if="pkg.version">{{ pkg.version }}{{ pkg.author ? ' · ' + pkg.author : '' }}</small></span
                >
              </button>
              <div class="row-status">
                <span v-if="projects" class="tag">{{ pkg.project ? '创作包' : '本地包' }}</span>
                <span v-if="pkg.builtin" class="tag">内置</span><span v-else-if="readonly" class="tag">服务器提供</span
                ><span v-else-if="!projects" class="tag">已安装</span
                ><span v-if="pkg.error" class="problem">安装不可用</span>
              </div>
            </div>
            <p
              v-if="
                !visiblePackages.length &&
                !projectsLoading &&
                !loading &&
                (!readonly || (remoteEnvironment && !remoteLoading))
              "
              class="list-note"
            >
              {{
                projects && !query && filter === 'all'
                  ? '本机还没有创作项目或已安装的内容包。'
                  : '没有符合条件的内容包。'
              }}
            </p>
          </div>
          <aside v-if="selected" class="package-detail" aria-label="内容包详情">
            <button class="back" @click="detailOpen = false">返回内容包列表</button>
            <h2>{{ selected.title }}</h2>
            <slot v-if="selected.project" name="project-detail" :project="selected.project" />
            <template v-else>
              <p class="detail-subtitle">
                {{ selected.version }} ·
                {{ readonly ? (mode === 'room' ? '本局固定版本' : '服务器已发布版本') : '已安装' }}
              </p>
              <button
                v-if="canAuthor && !readonly"
                class="primary"
                :disabled="busy"
                @click="browsePackage(selected.id)"
              >
                浏览内容（只读）
              </button>
            </template>
            <PackageEnvironmentTargets
              v-if="api?.localEnvironment && !readonly && !selected.error && (selected.local || selected.project)"
              :key="selected.id"
              :project="selected.project"
              :installed="selected.local"
            />
            <template v-if="!selected.project">
              <ElTabs v-model="detailTab" aria-label="包详情">
                <ElTabPane label="简介" name="overview"
                  ><p v-if="selected.description">{{ selected.description }}</p>
                  <EnvironmentPackagePreview v-if="selected.preview" :preview="selected.preview" />
                  <p v-else-if="selected.counts" class="detail-subtitle">
                    {{ selected.counts.species }} 只精灵 · {{ selected.counts.skills }} 个技能 ·
                    {{ selected.counts.marks }} 个印记
                  </p>
                  <dl>
                    <template v-if="selected.local?.license"
                      ><dt>许可证</dt>
                      <dd>{{ selected.local.license }}</dd></template
                    >
                    <template v-if="selected.local?.installedAt"
                      ><dt>安装时间</dt>
                      <dd>{{ new Date(selected.local.installedAt).toLocaleString() }}</dd></template
                    >
                    <template v-for="(range, engine) in selected.local?.engines" :key="engine"
                      ><dt>{{ engine }} 兼容范围</dt>
                      <dd>{{ range }}</dd></template
                    >
                    <template v-if="selected.local?.sdkApi"
                      ><dt>SDK API</dt>
                      <dd>{{ selected.local.sdkApi }}</dd></template
                    >
                    <dt>来源</dt>
                    <dd>{{ selected.source }}</dd>
                    <template v-if="selected.author"
                      ><dt>作者</dt>
                      <dd>{{ selected.author }}</dd></template
                    >
                  </dl>
                  <p v-if="selected.error" class="problem">{{ selected.error }}</p>
                  <details>
                    <summary>包标识与版本信息</summary>
                    <p>{{ selected.name }} {{ selected.version }}</p>
                    <p v-if="selected.namespace">命名空间：{{ selected.namespace }}</p>
                  </details>
                  <div
                    v-if="!readonly && (selected.local?.bundled || selected.local?.source.kind === 'npm')"
                    class="detail-actions"
                  >
                    <button :disabled="busy || offline" @click="checkPackageUpdate">检查数据包更新</button>
                  </div>
                  <div v-if="!readonly && selected.local && !selected.builtin" class="detail-actions">
                    <button :disabled="busy" @click="addOtherVersion">安装其他版本</button
                    ><button :disabled="busy" @click="uninstall">卸载此版本</button>
                  </div>
                </ElTabPane>
                <ElTabPane label="依赖" name="dependencies"
                  ><p v-if="selected.builtin">官方基础包支持独立更新。</p>
                  <template v-else-if="selected.graph"
                    ><p class="detail-subtitle">安装时的内容包及依赖</p>
                    <p v-for="(range, name) in selected.local?.dependencyRanges" :key="name">{{ name }}：{{ range }}</p>
                    <ul class="dependencies">
                      <li v-for="(dependency, index) in selected.graph" :key="dependency.name + '-' + index">
                        <strong>{{ dependency.name }}</strong> {{ dependency.version
                        }}<small v-if="dependency.namespace">内容命名空间：{{ dependency.namespace }}</small>
                        <details v-if="Object.keys(dependency.dependencies).length">
                          <summary>所需依赖</summary>
                          <p v-for="(version, name) in dependency.dependencies" :key="name">{{ name }} {{ version }}</p>
                        </details>
                      </li>
                    </ul></template
                  >
                  <p v-else>服务器未提供依赖清单。</p></ElTabPane
                >
                <ElTabPane label="队伍影响" name="impact"
                  ><p v-if="readonly && remoteLoading">正在读取环境内容…</p>
                  <p v-else-if="readonly && remoteError" class="problem">
                    环境内容尚未读取成功，暂时无法检查队伍引用。
                  </p>
                  <p v-else-if="!gameData.loaded && !remoteContent">正在读取基础内容…</p>
                  <p v-else-if="!relatedTeams.length">暂无队伍引用此包的内容。</p>
                  <ul v-else class="team-impact">
                    <li v-for="(team, index) in relatedTeams" :key="index">
                      <strong>{{ team.name }}</strong
                      ><span class="tag" :class="{ warning: team.missing.length }">{{
                        team.missing.length ? '存在不可用引用' : '内容引用齐全'
                      }}</span>
                      <ul v-if="team.missing.length">
                        <li v-for="(item, itemIndex) in team.missing" :key="itemIndex">{{ item.message }}</li>
                      </ul>
                    </li>
                  </ul>
                </ElTabPane>
              </ElTabs>
            </template>
          </aside>
        </div>
      </section>
    </div>
    <ElDialog
      v-model="tasksOpen"
      title="下载与安装"
      width="min(32rem, calc(100vw - 24px))"
      append-to-body
      destroy-on-close
    >
      <p v-if="error" role="alert" class="problem">{{ error }}</p>
      <p v-if="!snapshot?.operations?.length">暂无安装任务。</p>
      <article v-for="job in snapshot?.operations" :key="job.id" class="install-task">
        <strong>{{ job.label }}</strong>
        <p>
          {{ job.stage === 'recording' && job.status === 'running' ? '保存安装记录' : installLabels[job.status] }}
        </p>
        <ElProgress
          v-if="job.status === 'running'"
          indeterminate
          :percentage="100"
          :show-text="false"
          aria-label="正在安装"
        />
        <p v-if="job.error">{{ contentTaskError(job.error) }}</p>
        <ElButton
          v-if="['queued', 'running'].includes(job.status)"
          :disabled="job.stage === 'recording'"
          @click="installTaskAction('cancel-install', job.id)"
        >
          {{ job.status === 'queued' ? '移出队列' : '取消' }}
        </ElButton>
        <ElButton
          v-if="['failed', 'cancelled'].includes(job.status)"
          @click="installTaskAction('retry-install', job.id)"
        >
          重试
        </ElButton>
      </article>
      <template #footer>
        <ElButton @click="installTaskAction('clear-install-tasks')">清除已结束</ElButton>
        <ElButton type="primary" @click="tasksOpen = false">关闭</ElButton>
      </template>
    </ElDialog>
    <ElDialog
      v-model="adding"
      title="安装内容包"
      width="min(32rem, calc(100vw - 24px))"
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
    >
      <form class="grid gap-4" @submit.prevent="installSelected">
        <label
          >安装来源<select aria-label="安装来源" v-model="installKind">
            <option value="npm">npm 注册表</option>
            <option value="url">HTTPS 发行归档</option>
            <option value="git">Git 固定提交</option>
            <option v-if="canAuthor" value="project">本机项目构建</option>
          </select></label
        >
        <template v-if="installKind === 'url'">
          <label
            >发行归档地址<ElInput v-model="archiveUrl" placeholder="https://…/releases/download/…/pack.tgz"
          /></label>
          <label>完整性校验（可选）<ElInput v-model="archiveIntegrity" placeholder="sha512-…" /></label>
        </template>
        <template v-if="installKind === 'git'">
          <label>HTTPS 仓库地址<ElInput v-model="gitUrl" /></label>
          <label>完整提交 SHA<ElInput v-model="commit" maxlength="40" /></label>
          <label>预构建包目录<ElInput v-model="artifactPath" placeholder="默认仓库根目录" /></label>
        </template>
        <template v-if="installKind === 'project'">
          <label
            >源项目<select v-model="buildProject">
              <option value="">选择项目</option>
              <option v-for="row in buildProjects" :key="row.id" :value="row.id">{{ row.name }}</option>
            </select></label
          >
          <span v-if="buildProject">{{ latestBuild?.result?.filename || '请先在创作工作台构建当前版本。' }}</span>
        </template>
        <label v-if="installKind === 'npm'"
          >npm 包名与版本<ElInput v-model="npmSpec" placeholder="@author/pets@1.0.0" clearable :disabled="busy"
        /></label>
        <ElCheckbox v-if="installKind === 'npm'" v-model="offline" :disabled="busy"
          >仅使用本机已有的 npm 缓存</ElCheckbox
        >
        <div><ElButton :disabled="busy" @click="inspectFile">安装本地内容包</ElButton></div>
        <p v-if="error" role="alert" class="problem">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <ElButton @click="adding = false">取消</ElButton>
          <ElButton native-type="submit" type="primary" :loading="busy" :disabled="!canInstall">安装到资源库</ElButton>
        </div>
      </form>
    </ElDialog>
  </section>
</template>

<style scoped>
.package-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.package-filter select {
  font: inherit;
  color: inherit;
  background: var(--surface);
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
}
.install-task {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.content-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}
.content-tabs [aria-current='page'] {
  background: #eaf2ff;
  color: #2467c8;
}
.content-page {
  --surface: #fff;
  --page: #f5f7fa;
  --text: #243042;
  --muted: #647184;
  --line: #dce2ea;
  --accent: #2467c8;
  max-width: 1280px;
  margin: auto;
  padding: 8px 20px 12px;
  color: var(--text);
}
.page-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 20px;
}
.page-heading h1 {
  font-size: 26px;
  font-weight: 600;
  margin: 0 0 6px;
}
.scope,
.tag {
  font-size: 12px;
  background: #edf2f8;
  padding: 3px 7px;
  border-radius: 4px;
  color: #516077;
}
.scope {
  white-space: nowrap;
}
h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px;
}
p {
  line-height: 1.65;
}
button,
input {
  font: inherit;
}
button:not(.el-button) {
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 8px 11px;
  background: var(--surface);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
input[type='checkbox'] {
  accent-color: var(--accent);
}
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  overflow: clip;
}
.task-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  flex-shrink: 0;
}
.nav-label,
.task-nav hr {
  display: none;
}
.nav-label {
  font-size: 12px;
  color: var(--muted);
  padding: 0 8px;
}
.task-nav button:not(.el-button) {
  display: flex;
  justify-content: space-between;
  width: auto;
  gap: 8px;
  border: 0;
  text-align: left;
  margin: 4px 0;
  padding: 10px;
}
.task-nav button[aria-current='page'] {
  background: #eaf1ff;
  color: var(--accent);
  font-weight: 600;
}
.task-nav span {
  font-size: 12px;
  color: var(--muted);
}
hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 18px 6px;
}
.package-workspace {
  min-width: 0;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding: 15px;
}
.toolbar input {
  min-width: 80px;
  flex: 1;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: var(--page);
  border-radius: 5px;
}
.toolbar button:not(.el-button) {
  white-space: nowrap;
}
.context-note {
  padding: 0 16px;
  color: var(--muted);
  font-size: 12px;
}
.server-environment-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font-size: 13px;
}
.server-environment-picker .el-select-v2 {
  flex: 1;
  min-width: 0;
}
.columns {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(310px, 36%);
  align-items: start;
  min-height: 0;
  overflow: hidden;
}
.package-list {
  overflow: auto;
  min-width: 0;
}
.package-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--line);
  padding: 10px 14px;
}
.package-row.selected {
  background: #edf3ff;
}
.package-select {
  display: flex;
  gap: 12px;
  align-items: center;
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 4px 0;
  text-align: left;
  background: transparent;
}
.package-icon {
  display: grid;
  place-items: center;
  background: #e9eff7;
  color: var(--accent);
  width: 36px;
  height: 36px;
  border-radius: 7px;
  flex-shrink: 0;
  font-weight: 600;
}
.package-title {
  overflow-wrap: anywhere;
  font-weight: 600;
}
.package-title small {
  display: block;
  font-weight: 400;
  font-size: 12px;
  color: var(--muted);
  margin-top: 3px;
}
.row-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  flex-shrink: 0;
}
.row-status small {
  font-size: 12px;
  color: var(--muted);
}
.enable {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}
.enable input {
  width: 16px;
  height: 16px;
}
.list-note {
  padding: 14px 18px;
  font-size: 13px;
  color: var(--muted);
}
.package-detail {
  overflow: auto;
  border-left: 1px solid var(--line);
  padding: 20px 17px;
  min-width: 0;
}
.package-detail h2 {
  overflow-wrap: anywhere;
}
.detail-subtitle {
  font-size: 12px;
  color: var(--muted);
  margin: 6px 0 14px;
}
.package-detail p,
.package-detail li,
.package-detail dd {
  overflow-wrap: anywhere;
}
.package-detail p,
.package-detail li {
  font-size: 13px;
}
.package-detail dl {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
  margin: 16px 0;
}
.package-detail dt {
  color: var(--muted);
}
.package-detail dd {
  margin: 0;
}
.package-detail details {
  margin: 14px 0;
  font-size: 12px;
  color: var(--muted);
}
summary {
  cursor: pointer;
}
.dependencies,
.team-impact {
  list-style: none;
  margin: 0;
  padding: 0;
}
.dependencies > li,
.team-impact > li {
  border-bottom: 1px solid var(--line);
  padding: 10px 0;
}
.dependencies small {
  display: block;
  color: var(--muted);
}
.team-impact .tag {
  display: inline-block;
  margin: 5px;
}
.team-impact ul {
  padding-left: 16px;
}
.warning {
  background: #fff1d6;
  color: #835516;
}
.detail-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 16px 0;
}
.detail-actions button:not(.el-button) {
  font-size: 12px;
}
.message {
  padding: 10px 14px;
  background: #edf3fc;
  border-radius: 6px;
  margin: 12px 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.error,
.problem {
  color: #a92f37;
}
.problem {
  font-size: 12px;
}
.back {
  display: none;
}
@media (max-width: 1000px) {
  .columns {
    grid-template-columns: minmax(200px, 1fr) 260px;
  }
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .package-row {
    padding: 9px;
  }
  .package-select {
    gap: 8px;
  }
}
@media (max-width: 720px) {
  .content-page {
    padding: 8px 12px 24px;
  }
  .page-heading h1 {
    font-size: 23px;
  }
  .workspace {
    display: block;
  }
  .task-nav {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: 7px;
  }
  .task-nav button:not(.el-button) {
    width: auto;
    gap: 10px;
    margin: 0;
    padding: 8px;
  }
  .nav-label,
  .task-nav hr {
    display: none;
  }
  .toolbar {
    padding: 12px;
    flex-wrap: wrap;
  }
  .columns {
    display: block;
  }
  .package-detail {
    overflow: auto;
    display: none;
    border-left: 0;
  }
  .detail-open .package-list {
    display: none;
  }
  .detail-open .package-detail {
    overflow: auto;
    display: block;
  }
  .back {
    display: block;
    margin-bottom: 15px;
  }
  .pending {
    align-items: flex-start;
  }
}
</style>

<style scoped>
.remote-packages .workspace {
  grid-template-columns: minmax(0, 1fr);
}
.install-task {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.content-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}
.content-tabs [aria-current='page'] {
  background: #eaf2ff;
  color: #2467c8;
}
.source-projects {
  margin: 16px 0 24px;
  padding: 16px;
  border: 1px solid var(--content-border, #7f8b8033);
  border-radius: 12px;
}
.source-projects header,
.source-create {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.source-projects h2 {
  font-size: 16px;
  margin: 0 auto 0 0;
}
.source-create {
  margin-top: 12px;
}
.source-create label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.source-project-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
  margin-top: 12px;
}
.source-project-list button:not(.el-button) {
  text-align: left;
  padding: 12px;
}
.source-project-list small {
  display: block;
  margin-top: 4px;
  opacity: 0.7;
}
</style>
