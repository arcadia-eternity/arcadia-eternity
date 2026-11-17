<script setup lang="ts">
import { ElButton, ElDrawer } from 'element-plus'
import { contentTaskError } from '@/utils/contentTaskMessages'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ContentPackagesPanel from './ContentPackagesPanel.vue'
import { createLocalContentLibraryClient } from './contentLibraryClient'
import type { InstalledContentPackage } from '@/types/contentPackages'
import { useGameDataStore } from '@/stores/gameData'
import { isRemoteContentActive } from '@/i18n/serverContent'
import EnvironmentImportDialog from '@/features/management/EnvironmentImportDialog.vue'
import EnvironmentWorkspace from '@/features/management/EnvironmentWorkspace.vue'
import type { ManagedEnvironment, ManagedEnvironmentDocument, ManagedEnvironmentInstallation } from '@/types/management'
const route = useRoute()
const router = useRouter()
const library = createLocalContentLibraryClient(window.arcadiaDesktop)
const materials = ref<InstalledContentPackage[]>([])
const materialsOpen = ref(false)
const candidate = ref<InstalledContentPackage>()
const pendingPackage = ref<InstalledContentPackage>()
const packageEnvironmentId = ref('')
async function refreshMaterials() {
  if (!library) return
  materials.value = (await library.list()).packages.filter(pkg => !pkg.error)
}
async function importPackage() {
  if (!library || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const id = await library.installFile({ offline: !allowDownload.value })
    if (id && !disposed) {
      await refreshMaterials()
      pendingPackage.value = materials.value.find(pkg => pkg.id === id)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法导入内容包'
  } finally {
    busy.value = false
  }
}
function acceptPackage() {
  pendingPackage.value = undefined
  candidate.value = undefined
  packageEnvironmentId.value = ''
}
function useCandidate() {
  if (!candidate.value || !packageEnvironmentId.value) return
  pendingPackage.value = { ...candidate.value }
}
const gameData = useGameDataStore()
const canImportSources = !!window.arcadiaDesktop?.contentPackageAction
interface Job {
  id: string
  kind: string
  status: string
  error?: { code?: string; message: string }
  progress?: { stage: string }
  result?: ManagedEnvironmentInstallation
}
interface Snapshot {
  selectedEnvironmentId?: string
  workspaceId: string
  environments: ManagedEnvironment[]
  installations: ManagedEnvironmentInstallation[]
  operations: Job[]
}
const stageLabels: Record<string, string> = {
  resolving: '解析依赖',
  acquiring: '获取来源',
  installing: '下载并安装',
  verifying: '校验材料',
  capturing: '保存版本材料',
  preparing: '准备环境',
}
const jobLabels: Record<string, string> = {
  queued: '排队中',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}
const snapshot = ref<Snapshot>({ workspaceId: '', environments: [], installations: [], operations: [] })
const tasksOpen = ref(false)
const activeTasks = computed(
  () => snapshot.value.operations.filter(job => ['queued', 'running'].includes(job.status)).length,
)
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  saveSequence = ref(0),
  allowDownload = ref(false)
const importing = ref(false)
function openImport() {
  importing.value = true
  error.value = ''
}
const references = ref<unknown[]>()
const preparing = computed(() => snapshot.value.operations.some(job => ['queued', 'running'].includes(job.status)))
let disposed = false,
  timer: ReturnType<typeof setTimeout> | undefined
let refreshSequence = 0
async function call<T>(input: Record<string, unknown>): Promise<T> {
  const api = window.arcadiaDesktop?.localEnvironment
  if (!api) throw new Error('离线环境库需要桌面客户端')
  const response = await api(input)
  if (response.error) throw new Error(response.error.message)
  return response.result as T
}
async function refresh() {
  const sequence = ++refreshSequence
  try {
    const next = await call<Snapshot>({ action: 'snapshot' })
    if (!disposed && sequence === refreshSequence) {
      const before = snapshot.value.installations.find(
        item => item.environmentId === snapshot.value.selectedEnvironmentId,
      )
      const after = next.installations.find(item => item.environmentId === next.selectedEnvironmentId)
      const changed =
        snapshot.value.workspaceId &&
        (snapshot.value.selectedEnvironmentId !== next.selectedEnvironmentId ||
          (before?.status === 'ready' ? before.draftRevision : undefined) !==
            (after?.status === 'ready' ? after.draftRevision : undefined))
      snapshot.value = next
      if (changed && !isRemoteContentActive()) await gameData.reload()
    }
  } catch (cause) {
    if (!disposed && sequence === refreshSequence)
      error.value = cause instanceof Error ? cause.message : '无法读取环境库'
  }
}
async function run(input: Record<string, unknown>, message: string) {
  if (busy.value) return false
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await call(input)
    if (!disposed) {
      notice.value = message
      await refresh()
    }
    return true
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : '操作失败'
    return false
  } finally {
    if (!disposed) busy.value = false
  }
}
async function save(document: ManagedEnvironmentDocument, expectedRevision: string | null) {
  if (
    await run({ action: 'apply', document, expectedRevision, allowDownload: allowDownload.value }, '正在保存并应用。')
  )
    saveSequence.value++
}
async function inspect(version: ManagedEnvironmentInstallation) {
  try {
    references.value = (
      await call<{ references: unknown[] }>({ action: 'references', installationId: version.installationId })
    ).references
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取引用'
  }
}
async function exportEnvironment(version: ManagedEnvironmentInstallation) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  let url: string | undefined
  try {
    const bundle = await call({ action: 'export', installationId: version.installationId })
    if (disposed) return
    url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `environment-${version.installationId}.json`
    link.click()
    notice.value = '环境已导出。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '导出失败'
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000)
    if (!disposed) busy.value = false
  }
}
async function importSources() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await window.arcadiaDesktop!.contentPackageAction!({ action: 'import-sources' })
    if (!disposed && typeof result === 'string') notice.value = result ? `已登记来源：${result}` : '来源登记已清空'
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : '无法导入来源配置'
  } finally {
    if (!disposed) busy.value = false
  }
}
async function importEnvironment(input: { bundle: unknown; environmentId?: string }) {
  if (await run({ action: 'import', ...input }, '正在导入环境。')) {
    importing.value = false
    tasksOpen.value = true
  }
}
onMounted(async () => {
  const poll = async () => {
    await refresh()
    if (!disposed) timer = setTimeout(poll, preparing.value ? 1000 : 4000)
  }
  await poll()
  try {
    await refreshMaterials()
    if (typeof route.query.packageId === 'string') {
      candidate.value = materials.value.find(pkg => pkg.id === route.query.packageId)
      if (!candidate.value) error.value = '构建产物不可用，请重新构建。'
      packageEnvironmentId.value =
        snapshot.value.selectedEnvironmentId ?? snapshot.value.environments[0]?.document.id ?? ''
      const { packageId: _packageId, ...query } = route.query
      await router.replace({ query })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取内容材料'
  }
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
})
</script>
<template>
  <section class="local-environments" aria-label="本机环境库">
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <form v-if="candidate" class="panel" aria-label="选择目标环境" @submit.prevent="useCandidate">
      <strong>{{ candidate.name }} {{ candidate.version }}</strong>
      <label
        >目标环境<select v-model="packageEnvironmentId" required>
          <option
            v-for="environment in snapshot.environments"
            :key="environment.document.id"
            :value="environment.document.id"
          >
            {{ environment.document.name }}
          </option>
        </select></label
      >
      <button :disabled="!packageEnvironmentId">编辑环境依赖</button>
      <button type="button" @click="candidate = undefined">取消</button>
    </form>
    <EnvironmentWorkspace
      :available-packages="materials"
      :pending-package="pendingPackage"
      :package-environment-id="packageEnvironmentId"
      @package-accepted="acceptPackage"
      heading="本机环境库"
      :environments="snapshot.environments"
      :installations="snapshot.installations"
      :can-export="true"
      @export="exportEnvironment"
      :show-use-actions="true"
      use-label="本地使用"
      :show-peer-use="false"
      :current-environment-id="snapshot.selectedEnvironmentId"
      @use="version => run({ action: 'select', environmentId: version.environmentId }, '')"
      :can-edit="true"
      :can-prepare="true"
      :can-delete="true"
      :can-use="!preparing"
      :busy="busy"
      :save-sequence="saveSequence"
      @save="save"
      @remove-package="
        (environment, name, cascade) =>
          run(
            {
              action: 'remove-package',
              environmentId: environment.document.id,
              expectedRevision: environment.revision,
              name,
              cascade,
              allowDownload,
            },
            '正在移出环境。',
          )
      "
      @references="inspect"
      @delete="version => run({ action: 'clear-installation', installationId: version.installationId }, '安装已清理。')"
      @delete-draft="
        environment =>
          run(
            { action: 'delete-draft', environmentId: environment.document.id, expectedRevision: environment.revision },
            '环境草稿已删除。',
          )
      "
    >
      <template #package-source>
        <ElButton v-if="library" :disabled="busy" @click="importPackage">从文件加入内容包</ElButton>
      </template>
      <template #toolbar>
        <ElButton @click="tasksOpen = true">任务{{ activeTasks ? `（${activeTasks}）` : '' }}</ElButton>
        <ElButton :disabled="busy" @click="openImport">导入环境</ElButton>
      </template>
    </EnvironmentWorkspace>
    <EnvironmentImportDialog v-model="importing" :busy="busy || preparing" :error="error" @import="importEnvironment" />
    <details class="source-settings">
      <summary>内容来源</summary>
      <label class="download-policy"><input v-model="allowDownload" type="checkbox" />允许下载缺失的第三方包</label>
      <ElButton v-if="library" @click="materialsOpen = true">本机材料</ElButton>
      <ElButton v-if="canImportSources" :disabled="busy" @click="importSources">导入来源配置</ElButton>
    </details>
    <section v-if="references" class="panel" aria-label="本地版本引用">
      <h3>版本引用</h3>
      <p v-if="!references.length">没有引用，可删除此版本。</p>
      <pre v-else>{{ references }}</pre>
      <button @click="references = undefined">关闭引用</button>
    </section>
    <ElDrawer
      v-model="materialsOpen"
      title="本机材料"
      size="min(1000px, 100vw)"
      append-to-body
      @closed="refreshMaterials"
    >
      <ContentPackagesPanel v-if="materialsOpen" location="local" />
    </ElDrawer>
    <ElDrawer v-model="tasksOpen" title="环境任务" size="min(680px, 100vw)" append-to-body
      ><section class="panel" aria-label="本地环境任务">
        <h3>下载与准备任务</h3>
        <button @click="run({ action: 'clear-completed' }, '已清除结束的任务记录。')">清除已结束</button>
        <p v-if="!snapshot.operations.length">暂无任务。</p>
        <article v-for="job in snapshot.operations" :key="job.id">
          <span
            >{{
              job.kind === 'environment.apply'
                ? '保存并应用'
                : job.kind === 'environment.select'
                  ? '切换环境'
                  : '导入环境'
            }}
            · {{ jobLabels[job.status] }}</span
          >
          <button
            v-if="['queued', 'running'].includes(job.status)"
            @click="run({ action: 'cancel', operationId: job.id }, '已请求取消。')"
          >
            取消任务
          </button>
          <p v-if="job.progress">{{ stageLabels[job.progress.stage] ?? job.progress.stage }}</p>
          <progress v-if="job.status === 'running'" aria-label="正在处理" />
          <button
            v-if="['failed', 'cancelled'].includes(job.status)"
            @click="run({ action: 'retry', operationId: job.id }, '已重新加入队列。')"
          >
            重试
          </button>
          <p v-if="job.error" class="error">{{ contentTaskError(job.error) }}</p>
        </article>
      </section></ElDrawer
    >
  </section>
</template>
<style scoped>
.source-settings {
  margin: 16px 0;
}
.source-settings summary {
  cursor: pointer;
  margin-bottom: 8px;
}
.local-tabs {
  display: flex;
  gap: 8px;
}
.local-tabs button[aria-pressed='true'] {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}
.local-environments :deep(.environment-workspace) {
  height: auto;
  min-height: 0;
}
.local-environments > .panel {
  overflow: auto;
  min-height: 0;
}
.local-environments {
  display: flex;
  flex-direction: column;
  height: auto;
  min-height: 0;
  color: var(--el-text-color-primary);
}
.download-policy {
  display: flex;
  gap: 8px;
  margin: 16px 0;
}
.panel {
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  padding: 18px;
  margin: 20px 0;
  background: var(--el-bg-color);
}
.panel h3 {
  font-size: 17px;
  font-weight: 600;
}
.panel label {
  display: grid;
  gap: 6px;
  margin: 14px 0;
}
.panel button,
.panel input,
.panel select {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
}
.panel article {
  padding: 12px 0;
  border-bottom: 1px solid #e2e8f0;
}
.panel button {
  margin: 6px;
  background: var(--el-bg-color);
}
.error {
  color: #b42318;
}
.panel pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
button:disabled {
  opacity: 0.5;
}
</style>
