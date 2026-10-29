<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGameDataStore } from '@/stores/gameData'
import { usePrivateRoomStore } from '@/stores/privateRoom'
import { useBattleClientStore } from '@/stores/battleClient'
import { usePetStorageStore } from '@/stores/petStorage'
import { readServerEnvironmentContent } from '@/services/serverEnvironment'
import { findMissingTeamContent, type TeamContentLookup } from '@/utils/teamContent'
import type {
  ContentIds,
  ContentLibrarySnapshot,
  InstalledContentPackage,
  PackageGraphEntry,
} from '@/types/contentPackages'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'

interface PackageView {
  id: string
  name: string
  title: string
  version: string
  namespace?: string
  author: string
  description: string
  source: string
  counts?: { species: number; skills: number; marks: number }
  graph?: PackageGraphEntry[]
  contentIds: ContentIds
  builtin?: boolean
  local?: InstalledContentPackage
  error?: string
}
const api = window.arcadiaDesktop
const local = !!api?.listContentPackages && !!api?.contentPackageAction
const gameData = useGameDataStore()
const rooms = usePrivateRoomStore()
const battle = useBattleClientStore()
const pets = usePetStorageStore()
const snapshot = ref<ContentLibrarySnapshot>()
const draftIds = ref<string[]>([])
const mode = ref<'installed' | 'enabled' | 'issues' | 'room'>(local ? 'installed' : 'room')
const selectedId = ref('official')
const detailTab = ref<'overview' | 'dependencies' | 'impact'>('overview')
const detailOpen = ref(false)
const query = ref('')
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const notice = ref('')
const offline = ref(false)
const roomContent = ref<ServerEnvironmentContent>()
const roomLoading = ref(false)
const roomError = ref('')
const adding = ref(false)
const npmSpec = ref('')
let controller: AbortController | undefined
let disposed = false
const pendingSelections = ref(0)
let intent = 0
let refreshRequest = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
const readonly = computed(() => !local || mode.value === 'room')
const room = computed(() => rooms.currentRoom)
const activeIds = computed(() => snapshot.value?.activeIds ?? [])
const selectionLabel = computed(() =>
  pendingSelections.value
    ? '正在保存内容选择…'
    : {
        idle: '',
        preparing: '正在准备所选内容…',
        ready: '',
        failed: '未能启用所选内容，原有内容仍可用。',
      }[snapshot.value?.selection.status ?? 'idle'],
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
const baseIds = computed<ContentIds>(() => {
  if (mode.value === 'room' && roomContent.value) return publicIds(roomContent.value)
  const data = gameData.serverFallback ?? gameData
  return {
    species: data.species.allIds.filter(id => !id.includes(':')),
    skills: data.skills.allIds.filter(id => !id.includes(':')),
    marks: data.marks.allIds.filter(id => !id.includes(':')),
  }
})
const packages = computed<PackageView[]>(() => {
  const base: PackageView = {
    id: 'official',
    name: '官方基础内容',
    title: '官方基础内容',
    version: '随游戏更新',
    author: 'Arcadia Eternity',
    description: '游戏内置的精灵、技能与印记。',
    source: readonly.value && room.value ? '房间服务器' : '游戏内置',
    builtin: true,
    contentIds: baseIds.value,
  }
  if (readonly.value)
    return [
      base,
      ...(room.value?.environment?.packages ?? []).map(pkg => {
        const ids = roomContent.value ? publicIds(roomContent.value, pkg.namespace) : emptyIds()
        return {
          id: pkg.projectId,
          name: pkg.name,
          title: pkg.name,
          version: pkg.version,
          namespace: pkg.namespace,
          author: '',
          description: '',
          source: '房间服务器',
          contentIds: ids,
          counts: roomContent.value
            ? { species: ids.species.length, skills: ids.skills.length, marks: ids.marks.length }
            : undefined,
        }
      }),
    ]
  return [
    base,
    ...(snapshot.value?.packages ?? []).map(pkg => ({
      id: pkg.id,
      name: pkg.name,
      title: pkg.title,
      version: pkg.version,
      namespace: pkg.namespace,
      author: pkg.author,
      description: pkg.description,
      source: pkg.source.label,
      contentIds: pkg.contentIds,
      graph: activeIds.value.includes(pkg.id) ? (snapshot.value?.activeGraph ?? pkg.graph) : pkg.graph,
      counts: pkg.counts,
      local: pkg,
      error: pkg.error,
    })),
  ]
})
const selected = computed(() => packages.value.find(pkg => pkg.id === selectedId.value))
const visiblePackages = computed(() =>
  packages.value.filter(
    pkg =>
      (mode.value !== 'enabled' || pkg.builtin || activeIds.value.includes(pkg.id)) &&
      (mode.value !== 'issues' || !!pkg.error) &&
      (pkg.title + pkg.name + pkg.author).toLowerCase().includes(query.value.toLowerCase()),
  ),
)
const issueCount = computed(() => snapshot.value?.packages.filter(pkg => pkg.error).length ?? 0)
const proposedLookup = computed<TeamContentLookup>(() => {
  const available = emptyIds()
  for (const kind of ['species', 'skills', 'marks'] as const) available[kind].push(...baseIds.value[kind])
  if (readonly.value && roomContent.value) {
    for (const kind of ['species', 'skills', 'marks'] as const)
      available[kind] = roomContent.value[kind].map(item => item.id)
  } else
    for (const pkg of snapshot.value?.packages ?? [])
      if (draftIds.value.includes(pkg.id) && !pkg.error) {
        for (const kind of ['species', 'skills', 'marks'] as const) available[kind].push(...pkg.contentIds[kind])
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
  if (!selected.value) return []
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
  npmSpec.value = selected.value.name + '@'
  adding.value = true
}
function changeMode(value: typeof mode.value) {
  mode.value = value
  query.value = ''
  detailOpen.value = false
  selectedId.value = value === 'issues' ? (snapshot.value?.packages.find(pkg => pkg.error)?.id ?? '') : 'official'
}
async function refresh() {
  if (!local) return
  const request = ++refreshRequest
  const result = await api!.listContentPackages!()
  if (disposed || request !== refreshRequest) return
  snapshot.value = result
  if (!pendingSelections.value) draftIds.value = [...result.desiredIds]
}
async function poll() {
  try {
    await refresh()
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : '无法读取内容状态'
  } finally {
    if (!disposed) pollTimer = setTimeout(poll, snapshot.value?.selection.status === 'preparing' ? 400 : 1500)
  }
}
async function setSelection(ids: string[]) {
  if (!local) return
  const current = ++intent
  pendingSelections.value++
  error.value = ''
  notice.value = ''
  try {
    await api!.contentPackageAction!({ action: 'set-selection', ids, offline: offline.value })
  } catch (cause) {
    if (current === intent && !disposed) error.value = cause instanceof Error ? cause.message : '无法保存内容选择'
  } finally {
    if (!disposed)
      await refresh().catch(() => {
        if (current === intent) error.value = '内容选择已保存，暂时无法读取进度'
      })
    pendingSelections.value--
    if (!disposed && !pendingSelections.value && current === intent && snapshot.value)
      draftIds.value = [...snapshot.value.desiredIds]
  }
}
function retrySelection() {
  void setSelection([...draftIds.value])
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
function toggle(pkg: PackageView, checked: boolean) {
  if (readonly.value || !pkg.local || busy.value) return
  if (checked)
    draftIds.value = [
      ...draftIds.value.filter(id => snapshot.value?.packages.find(p => p.id === id)?.name !== pkg.name),
      pkg.id,
    ]
  else draftIds.value = draftIds.value.filter(id => id !== pkg.id)
  void setSelection([...draftIds.value])
}
async function installSource(source: () => Promise<string | null>) {
  if (!local) return
  await run(async () => {
    const id = await source()
    if (!id || disposed) return
    await refresh()
    adding.value = false
    selectedId.value = id
    detailOpen.value = true
  })
}
async function inspectFile() {
  await installSource(() => api!.installContentPackageFile!({ offline: offline.value }))
}
async function inspectNpm() {
  await installSource(() => api!.installNpmContentPackage!({ spec: npmSpec.value.trim(), offline: offline.value }))
}
async function uninstall() {
  const pkg = selected.value
  if (!local || !pkg?.local) return
  await run(async () => {
    await api!.contentPackageAction!({ action: 'uninstall', packageId: pkg.id })
    await refresh()
    selectedId.value = 'official'
    notice.value = '内容包已卸载'
  })
}
watch(
  [() => battle.serverUrl, () => room.value?.environment?.id],
  async () => {
    controller?.abort()
    roomContent.value = undefined
    roomError.value = ''
    roomLoading.value = false
    const descriptor = room.value?.environment
    if (!descriptor) return
    const request = new AbortController()
    controller = request
    roomLoading.value = true
    try {
      const result = await readServerEnvironmentContent(battle.serverUrl, descriptor.id, fetch, request.signal)
      if (!request.signal.aborted && !disposed) roomContent.value = result
    } catch (cause) {
      if (!request.signal.aborted) roomError.value = cause instanceof Error ? cause.message : '无法读取房间内容'
    } finally {
      if (!request.signal.aborted) roomLoading.value = false
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
  controller?.abort()
  clearTimeout(pollTimer)
})
</script>

<template>
  <main class="content-page" :class="{ 'detail-open': detailOpen }">
    <header class="page-heading">
      <h1>内容包</h1>
      <span class="scope">{{ readonly ? '只读' : '本机管理' }}</span>
    </header>
    <p v-if="error" class="message error" role="alert">{{ error }}</p>
    <p v-if="notice" class="message" role="status">{{ notice }}</p>
    <section v-if="!readonly && selectionLabel" class="message selection-state" role="status" aria-live="polite">
      <p>{{ selectionLabel }}</p>
      <template v-if="snapshot?.selection.status === 'failed'">
        <p class="problem">{{ snapshot.selection.message }}</p>
        <button :disabled="busy || !!pendingSelections" @click="retrySelection">重试准备</button>
      </template>
    </section>
    <div class="workspace">
      <nav class="task-nav" aria-label="内容包导航">
        <template v-if="local"
          ><p class="nav-label">本机内容包</p>
          <button :aria-current="mode === 'installed' ? 'page' : undefined" @click="changeMode('installed')">
            已安装 <span>{{ (snapshot?.packages.length ?? 0) + 1 }}</span></button
          ><button :aria-current="mode === 'enabled' ? 'page' : undefined" @click="changeMode('enabled')">
            已启用 <span>{{ activeIds.length + 1 }}</span></button
          ><button :aria-current="mode === 'issues' ? 'page' : undefined" @click="changeMode('issues')">
            需处理 <span>{{ issueCount }}</span>
          </button>
          <hr
        /></template>
        <p class="nav-label">当前房间</p>
        <button :aria-current="mode === 'room' ? 'page' : undefined" @click="changeMode('room')">房间内容</button>
      </nav>
      <section class="package-workspace" aria-label="内容包管理">
        <div class="toolbar">
          <input v-model="query" type="search" aria-label="搜索内容包" placeholder="搜索内容包名称或作者" /><template
            v-if="!readonly"
            ><button class="primary" :disabled="busy" @click="adding = true">添加内容包</button
            ><button :disabled="busy" @click="run(() => refresh())">刷新</button></template
          >
        </div>
        <p v-if="readonly && !room" class="context-note">尚未进入房间</p>
        <p v-if="readonly && room" class="context-note">房间 {{ room.config.roomCode }}</p>
        <p v-if="readonly && roomError" class="message error" role="alert">{{ roomError }}</p>
        <div class="columns">
          <div class="package-list">
            <p v-if="loading || (readonly && roomLoading)" class="list-note" role="status">正在读取内容包…</p>
            <div
              v-for="pkg in visiblePackages"
              :key="pkg.id"
              class="package-row"
              :class="{ selected: selectedId === pkg.id }"
            >
              <button
                class="package-select"
                :aria-current="selectedId === pkg.id ? 'true' : undefined"
                @click="select(pkg)"
              >
                <span class="package-icon" aria-hidden="true">{{
                  pkg.builtin ? 'AE' : pkg.title.replace(/^@/, '').slice(0, 1).toUpperCase()
                }}</span
                ><span class="package-title"
                  >{{ pkg.title }}<small>{{ pkg.version }}{{ pkg.author ? ' · ' + pkg.author : '' }}</small></span
                >
              </button>
              <div class="row-status">
                <span v-if="pkg.builtin" class="tag">内置</span><span v-else-if="readonly" class="tag">服务器提供</span
                ><label v-else class="enable"
                  ><input
                    type="checkbox"
                    :aria-label="'启用 ' + pkg.title"
                    :checked="draftIds.includes(pkg.id)"
                    :disabled="busy || (!!pkg.error && !draftIds.includes(pkg.id))"
                    @change="toggle(pkg, ($event.target as HTMLInputElement).checked)"
                  />启用</label
                ><span v-if="pkg.error" class="problem">安装不可用</span
                ><small v-if="!readonly && !pkg.builtin && draftIds.includes(pkg.id) !== activeIds.includes(pkg.id)">{{
                  snapshot?.selection.status === 'failed'
                    ? '未能完成'
                    : draftIds.includes(pkg.id)
                      ? '正在启用'
                      : '正在停用'
                }}</small>
              </div>
            </div>
            <p v-if="!visiblePackages.length && !loading" class="list-note">没有符合条件的内容包。</p>
          </div>
          <aside v-if="selected" class="package-detail" aria-label="内容包详情">
            <button class="back" @click="detailOpen = false">返回内容包列表</button>
            <h2>{{ selected.title }}</h2>
            <p class="detail-subtitle">
              {{ selected.version }} ·
              {{
                selected.builtin
                  ? '游戏内置'
                  : readonly
                    ? '本局固定版本'
                    : draftIds.includes(selected.id) !== activeIds.includes(selected.id)
                      ? snapshot?.selection.status === 'failed'
                        ? '未能完成选择'
                        : '正在准备'
                      : activeIds.includes(selected.id)
                        ? '本机已启用'
                        : '已安装，未启用'
              }}
            </p>
            <div class="detail-tabs" role="tablist" aria-label="包详情">
              <button
                v-for="tab in ['overview', 'dependencies', 'impact'] as const"
                :id="'package-tab-' + tab"
                :key="tab"
                role="tab"
                :aria-selected="detailTab === tab"
                aria-controls="package-detail-panel"
                @click="detailTab = tab"
              >
                {{ { overview: '简介', dependencies: '依赖', impact: '队伍影响' }[tab] }}
              </button>
            </div>
            <div id="package-detail-panel" role="tabpanel" :aria-labelledby="'package-tab-' + detailTab">
              <template v-if="detailTab === 'overview'"
                ><p v-if="selected.description">{{ selected.description }}</p>
                <p v-if="selected.counts" class="detail-subtitle">
                  {{ selected.counts.species }} 只精灵 · {{ selected.counts.skills }} 个技能 ·
                  {{ selected.counts.marks }} 个印记
                </p>
                <dl>
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
                <div v-if="!readonly && selected.local" class="detail-actions">
                  <button :disabled="busy" @click="addOtherVersion">安装其他版本</button
                  ><button
                    :title="
                      draftIds.includes(selected.id) || activeIds.includes(selected.id)
                        ? '请先停用后卸载'
                        : snapshot?.selection.status === 'preparing'
                          ? '内容准备完成后可卸载'
                          : undefined
                    "
                    :disabled="
                      busy ||
                      snapshot?.selection.status === 'preparing' ||
                      draftIds.includes(selected.id) ||
                      activeIds.includes(selected.id)
                    "
                    @click="uninstall"
                  >
                    卸载此版本
                  </button>
                </div>
              </template>
              <template v-else-if="detailTab === 'dependencies'"
                ><p v-if="selected.builtin">官方基础内容随游戏提供。</p>
                <template v-else-if="selected.graph"
                  ><p class="detail-subtitle">
                    {{ activeIds.includes(selected.id) ? '当前可用组合的实际依赖' : '安装时的内容包及依赖' }}
                  </p>
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
                <p v-else>服务器未提供依赖清单。</p></template
              >
              <template v-else
                ><p v-if="readonly && roomLoading">正在读取房间内容…</p>
                <p v-else-if="readonly && roomError" class="problem">房间内容尚未读取成功，暂时无法检查队伍引用。</p>
                <p v-else-if="!gameData.loaded && !roomContent">正在读取基础内容…</p>
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
              </template>
            </div>
          </aside>
        </div>
      </section>
    </div>
    <div v-if="adding" class="dialog-backdrop" @keydown.esc="!busy && (adding = false)">
      <section role="dialog" aria-modal="true" aria-labelledby="add-package-title" class="dialog">
        <h2 id="add-package-title">添加内容包</h2>
        <p>安装后自动启用，内容包及其依赖将在本机运行。</p>
        <button :disabled="busy" @click="inspectFile">安装本地 .tgz 文件</button
        ><label class="field"
          >npm 包名与版本<input v-model="npmSpec" placeholder="@author/pets@1.0.0" :disabled="busy" /></label
        ><label class="offline"
          ><input v-model="offline" type="checkbox" :disabled="busy" />仅使用本机已有的 npm 缓存</label
        >
        <p v-if="error" role="alert" class="problem">{{ error }}</p>
        <div class="dialog-actions">
          <button :disabled="busy" @click="adding = false">取消</button
          ><button class="primary" :disabled="busy || !npmSpec.trim()" @click="inspectNpm">
            {{ busy ? '正在安装…' : '安装并启用' }}
          </button>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.content-page {
  --surface: #fff;
  --page: #f5f7fa;
  --text: #243042;
  --muted: #647184;
  --line: #dce2ea;
  --accent: #2467c8;
  max-width: 1280px;
  margin: auto;
  padding: 24px 20px 56px;
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
button {
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
  grid-template-columns: 132px minmax(0, 1fr);
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  overflow: clip;
}
.task-nav {
  padding: 16px 9px;
  border-right: 1px solid var(--line);
}
.nav-label {
  font-size: 12px;
  color: var(--muted);
  padding: 0 8px;
}
.task-nav button {
  display: flex;
  justify-content: space-between;
  width: 100%;
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
.toolbar button {
  white-space: nowrap;
}
.context-note {
  padding: 0 16px;
  color: var(--muted);
  font-size: 12px;
}
.columns {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 310px;
  min-height: 510px;
}
.package-list {
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
.detail-tabs {
  display: flex;
  gap: 7px;
  border-bottom: 1px solid var(--line);
  margin: 16px 0;
}
.detail-tabs button {
  border: 0;
  border-radius: 0;
  padding: 8px 5px;
  border-bottom: 2px solid transparent;
  color: var(--muted);
}
.detail-tabs button[aria-selected='true'] {
  border-bottom-color: var(--accent);
  color: var(--accent);
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
  grid-template-columns: 40px minmax(0, 1fr);
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
.detail-actions button {
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
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: #15223870;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.dialog {
  background: var(--surface);
  border-radius: 9px;
  padding: 24px;
  width: 520px;
  max-width: 100%;
  max-height: calc(100dvh - 40px);
  overflow: auto;
  box-shadow: 0 14px 45px #0003;
}
.dialog p,
.dialog li {
  overflow-wrap: anywhere;
}
.field {
  display: grid;
  gap: 8px;
  margin: 20px 0 14px;
}
.field input {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 9px;
}
.offline {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
}
@media (max-width: 1000px) {
  .columns {
    grid-template-columns: minmax(200px, 1fr) 260px;
  }
  .workspace {
    grid-template-columns: 114px minmax(0, 1fr);
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
    padding: 20px 12px 48px;
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
  .task-nav button {
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
    display: none;
    border-left: 0;
  }
  .detail-open .package-list {
    display: none;
  }
  .detail-open .package-detail {
    display: block;
  }
  .back {
    display: block;
    margin-bottom: 15px;
  }
  .pending {
    align-items: flex-start;
  }
  .dialog-backdrop {
    padding: 12px;
  }
  .dialog {
    padding: 20px;
    max-height: calc(100dvh - 24px);
  }
}
</style>
