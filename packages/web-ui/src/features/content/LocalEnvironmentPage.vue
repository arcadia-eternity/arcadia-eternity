<script setup lang="ts">
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElDrawer,
  ElDialog,
  ElSkeleton,
  ElSelect,
  ElOption,
  ElCheckbox,
  ElProgress,
  ElRadioGroup,
  ElRadioButton,
} from 'element-plus'
import type {
  EnvironmentExportPreview,
  EnvironmentExportSelection,
  EnvironmentImportProbe,
} from '@arcadia-eternity/content-sdk/management-workspace'
import 'element-plus/theme-chalk/el-radio-group.css'
import 'element-plus/theme-chalk/el-radio-button.css'
import { waitForEnvironmentApply } from './waitForEnvironmentApply'
import { contentTaskError } from '@/utils/contentTaskMessages'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createLocalContentLibraryClient } from './contentLibraryClient'
import { installProjectBuild, localEnvironmentRequest as call } from './localEnvironmentPackages'
import { authorCall, type SourceProject } from '@/features/authoring/types'
import type { InstalledContentPackage } from '@/types/contentPackages'
import { useGameDataStore } from '@/stores/gameData'
import { isRemoteContentActive } from '@/i18n/serverContent'
import EnvironmentImportDialog from '@/features/management/EnvironmentImportDialog.vue'
import EnvironmentWorkspace, { type EnvironmentNavigation } from '@/features/management/EnvironmentWorkspace.vue'
import EnvironmentServerUsage from '@/features/management/EnvironmentServerUsage.vue'
import ManagementEnvironments from '@/features/management/ManagementEnvironments.vue'
import ManagementTasks from '@/features/management/ManagementTasks.vue'
import { useManagementController } from '@/features/management/useManagementController'
import { useLocalServerStore } from '@/stores/localServer'
import type { ManagedEnvironment, ManagedEnvironmentDocument, ManagedEnvironmentInstallation } from '@/types/management'
import { useEnvironmentDrafts } from './unsavedEnvironment'
import {
  environmentGroupKey,
  managedLocation,
  resolveEnvironmentEntry,
  type EnvironmentLocation,
} from './environmentGroups'
const editRequested = defineModel<boolean>('editRequested', { default: false })
const props = defineProps<{ selection?: string | null }>()
const emit = defineEmits<{ catalog: [rows: EnvironmentLocation[]]; select: [key: string]; busy: [value: boolean] }>()
const drafts = useEnvironmentDrafts()
const route = useRoute()
const router = useRouter()
const library = createLocalContentLibraryClient(window.arcadiaDesktop)
const materials = ref<InstalledContentPackage[]>([])
const candidate = ref<InstalledContentPackage>()
const sourceProject = ref<SourceProject>()
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
  sourceProject.value = undefined
  packageEnvironmentId.value = ''
}
function useCandidate() {
  if (!candidate.value || !packageEnvironmentId.value) return
  pendingPackage.value = { ...candidate.value }
}
const gameData = useGameDataStore()
const canAuthor = !!window.arcadiaDesktop?.author
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
const jobNames: Record<string, string> = {
  'environment.apply': '保存并应用',
  'environment.select': '切换环境',
  'environment.import': '导入环境',
  'environment.install-recipe': '安装环境包',
  'environment.save-member': '保存到本机包库',
  'environment.use-member': '用于其他环境',
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
const localServer = useLocalServerStore()
const host = window.arcadiaDesktop?.managementRequest
  ? useManagementController(
      { initialTarget: 'local', initialTab: 'environments', scope: 'content' },
      () => {},
      () => localServer.running,
    )
  : undefined
const selectedKey = ref('')
type LocalEntry = EnvironmentNavigation['entries'][number] & { hostEnvironmentId?: string }
const entries = computed<LocalEntry[]>(() => {
  const hosted = (host?.environments.value ?? []).map(environment => ({
    ...managedLocation(environment, 'host', '本机服务器', host?.installations.value ?? []),
    workspaceId: host?.state.workspaceId.value,
    serverId: host?.server.value?.id,
  }))
  const shared = new Set<string>()
  const personal = snapshot.value.environments.map(environment => {
    const entry = managedLocation(environment, 'local', '本机', snapshot.value.installations)
    const equivalents = hosted.filter(
      row => entry.environmentVersion && row.environmentVersion === entry.environmentVersion,
    )
    const matchingHost = equivalents.find(row => row.id === entry.id) ?? equivalents[0]
    const sameOwner =
      matchingHost?.id === entry.id &&
      (matchingHost.workspaceId === snapshot.value.workspaceId ||
        (environment.builtin && matchingHost.environment.builtin))
    if (sameOwner) shared.add(matchingHost.key)
    return {
      ...entry,
      sources: sameOwner ? ['本机', '本机服务器'] : undefined,
      workspaceId: snapshot.value.workspaceId,
      serverId: matchingHost?.serverId,
      hostEnvironmentId: matchingHost?.id,
      current: entry.id === snapshot.value.selectedEnvironmentId,
    }
  })
  return [...personal, ...hosted.filter(entry => !shared.has(entry.key))]
})
const navigation = computed<EnvironmentNavigation>(() => ({
  entries: entries.value,
  selected: props.selection || selectedKey.value || entries.value[0]?.key || '',
}))
watch(entries, rows => emit('catalog', rows), { immediate: true })
function select(key: string, startEdit = false) {
  if (startEdit) editRequested.value = true
  selectedKey.value = key
  emit('select', key)
}
const relatedHostId = computed(
  () => entries.value.find(entry => entry.key === navigation.value.selected)?.hostEnvironmentId,
)
const viewingHosted = computed(() => navigation.value.selected.startsWith('host/'))
const editableEnvironments = computed(() => snapshot.value.environments.filter(item => !item.builtin))
const targetEnvironment = computed(() =>
  editableEnvironments.value.find(item => item.document.id === packageEnvironmentId.value),
)
const tasksOpen = ref(false)
if (host)
  watch(host.tab, tab => {
    if (tab === 'tasks') {
      tasksOpen.value = true
      host.tab.value = 'environments'
    }
  })
const initialized = ref(false)
const activeTasks = computed(
  () => snapshot.value.operations.filter(job => ['queued', 'running'].includes(job.status)).length,
)
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  saveSequence = ref(0),
  allowDownload = ref(false)
watch(
  () => busy.value || !!host?.busy.value,
  value => emit('busy', value),
  { immediate: true },
)
watch([entries, drafts.open, busy, () => host?.busy.value], ([rows, editing, writing, hostBusy]) => {
  if (props.selection !== undefined || editing || writing || hostBusy || editRequested.value) return
  const key = selectedKey.value
  const current = rows.find(row => row.key === key) ?? rows[0]
  const next = current && resolveEnvironmentEntry(rows, environmentGroupKey(current), key)
  if (next && next.key !== key) select(next.key)
})
const transferMember = ref<{ environmentId: string; name: string; integrity: string }>()
const targetId = ref('')
function chooseTarget(environmentId: string, name: string, integrity: string) {
  targetId.value = ''
  transferMember.value = { environmentId, name, integrity }
}
async function memberAction(input: Record<string, unknown>) {
  if (await run(input, '')) {
    transferMember.value = undefined
    tasksOpen.value = true
  }
}
async function useMember() {
  const target = snapshot.value.environments.find(item => item.document.id === targetId.value)
  if (target && transferMember.value)
    await memberAction({
      action: 'use-member',
      ...transferMember.value,
      targetId: target.document.id,
      expectedRevision: target.revision,
    })
}
const canManageHost = computed(() => !!host?.isAdministrator.value && !!host.server.value)
const importingToHost = ref(false)
async function createOnServer(document: ManagedEnvironmentDocument) {
  if (!host || !canManageHost.value) {
    error.value = '本机服务器未运行'
    return
  }
  if (await host.saveEnvironment(document, null)) {
    saveSequence.value++
    select('host/' + document.id)
  }
}
const importing = ref(false)
const recipeDialog = ref(false)
const recipeSource = ref<'npm' | 'file'>('npm')
const recipeSpec = ref('')
const recipeEnvironmentId = ref('')
const recipeDownload = ref(false)
function openRecipeInstaller() {
  error.value = ''
  recipeSource.value = 'npm'
  recipeSpec.value = ''
  recipeEnvironmentId.value = ''
  recipeDownload.value = allowDownload.value
  recipeDialog.value = true
}
async function installRecipe() {
  const spec = recipeSpec.value.trim()
  if (busy.value || (recipeSource.value === 'npm' && !spec)) return
  const environmentId = recipeEnvironmentId.value.trim()
  if (environmentId && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(environmentId)) {
    error.value = '环境标识须以小写字母或数字开头，可包含短横线或下划线，最多 80 个字符。'
    return
  }
  let installedId: string | undefined
  const success = await run(async () => {
    const task = await call<{ operationId: string } | null>({
      action: 'install-recipe',
      source: recipeSource.value === 'npm' ? { kind: 'npm', spec } : { kind: 'file' },
      allowDownload: recipeDownload.value,
      ...(environmentId && { environmentId }),
    })
    if (!task) return
    const completed = await waitForEnvironmentApply(
      async () => (await call<Snapshot>({ action: 'snapshot' })).operations.find(job => job.id === task.operationId),
      () => !disposed,
    )
    if (disposed) return
    installedId = completed?.result?.environmentId
    if (!installedId) throw new Error('安装任务缺少环境标识，请刷新环境库。')
  }, '')
  if (success && installedId && !disposed) {
    recipeDialog.value = false
    notice.value = '环境包已安装。'
    if (!drafts.open()) select('local/' + installedId)
  }
}
function openImport() {
  importingToHost.value = false
  importing.value = true
  error.value = ''
}
const preparing = computed(() => snapshot.value.operations.some(job => ['queued', 'running'].includes(job.status)))
let disposed = false,
  timer: ReturnType<typeof setTimeout> | undefined
let refreshSequence = 0
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
          (before?.status === 'ready' ? before.environmentVersion : undefined) !==
            (after?.status === 'ready' ? after.environmentVersion : undefined) ||
          (before?.status === 'ready' ? before.draftRevision : undefined) !==
            (after?.status === 'ready' ? after.draftRevision : undefined))
      const savedPackage = next.operations.some(
        job =>
          job.kind === 'environment.save-member' &&
          job.status === 'succeeded' &&
          !snapshot.value.operations.some(previous => previous.id === job.id && previous.status === 'succeeded'),
      )
      gameData.reconcileLocalInstallations(next.installations)
      snapshot.value = next
      if (savedPackage) await refreshMaterials()
      if (changed && !isRemoteContentActive()) await gameData.reload()
    }
  } catch (cause) {
    if (!disposed && sequence === refreshSequence)
      error.value = cause instanceof Error ? cause.message : '无法读取环境库'
  } finally {
    if (!disposed && sequence === refreshSequence) initialized.value = true
  }
}
async function run(input: Record<string, unknown> | (() => Promise<unknown>), message: string) {
  if (busy.value) return false
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    if (typeof input === 'function') await input()
    else await call(input)
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
async function addCandidate() {
  const target = targetEnvironment.value
  if (!target || busy.value || preparing.value) return
  const project = sourceProject.value
  if (
    (await run(async () => {
      const pkg = project ? await installProjectBuild(project.id) : candidate.value
      if (!pkg || disposed) return
      await call({
        action: 'add-package',
        environmentId: target.document.id,
        expectedRevision: target.revision,
        name: pkg.name,
        version: pkg.version,
        allowDownload: allowDownload.value,
      })
    }, '')) &&
    !disposed
  ) {
    if (project) await refreshMaterials()
    acceptPackage()
    select('local/' + target.document.id)
    tasksOpen.value = true
  }
}
async function save(document: ManagedEnvironmentDocument, expectedRevision: string | null, copyFrom?: string) {
  const saved = await run(async () => {
    const { operationId } = await call<{ operationId: string }>({
      action: 'apply',
      document,
      expectedRevision,
      ...(copyFrom && { copyFrom }),
      allowDownload: allowDownload.value,
    })
    await waitForEnvironmentApply(
      async () => (await call<Snapshot>({ action: 'snapshot' })).operations.find(job => job.id === operationId),
      () => !disposed,
    )
  }, '环境已保存并应用。')
  if (saved && !disposed) saveSequence.value++
}
function previewExport(installationId: string) {
  return call<EnvironmentExportPreview>({ action: 'export-preview', installationId })
}
function checkArchives(probe: EnvironmentImportProbe) {
  return call<string[]>({ action: 'import-preview', probe })
}
async function exportEnvironment(version: ManagedEnvironmentInstallation, mode: EnvironmentExportSelection) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  let url: string | undefined
  try {
    const bundle = await call({ action: 'export', installationId: version.installationId, mode })
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
async function importEnvironment(input: { bundle: unknown; environmentId?: string }) {
  if (importingToHost.value) {
    if (!host || !canManageHost.value) {
      error.value = '本机服务器未运行'
      return
    }
    if (await host.importEnvironment(input)) importing.value = false
    return
  }
  if (await run({ action: 'import', allowDownload: allowDownload.value, ...input }, '正在导入环境。')) {
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
    const { packageId, projectId, environmentId, ...query } = route.query
    if (typeof environmentId === 'string') {
      if (entries.value.some(entry => entry.key === 'local/' + environmentId)) select('local/' + environmentId)
      if (!disposed && typeof packageId !== 'string' && typeof projectId !== 'string') await router.replace({ query })
    }
    if (typeof packageId === 'string' || typeof projectId === 'string') {
      if (typeof packageId === 'string') {
        candidate.value = materials.value.find(pkg => pkg.id === packageId)
        if (!candidate.value) error.value = '本地内容包不可用，请重新安装。'
      } else {
        sourceProject.value = (await authorCall<SourceProject[]>({ action: 'list' })).find(
          row => row.id === projectId && !row.readOnly,
        )
        if (!sourceProject.value) error.value = '找不到可编辑的创作包。'
      }
      packageEnvironmentId.value =
        editableEnvironments.value.find(item => item.document.id === snapshot.value.selectedEnvironmentId)?.document
          .id ??
        editableEnvironments.value[0]?.document.id ??
        ''
      if (!disposed) await router.replace({ query })
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
  <section v-if="selection !== null" class="local-environments" aria-label="本机环境库">
    <ElAlert v-if="error" type="error" :title="error" role="alert" :closable="false" show-icon />
    <ElAlert v-if="notice" type="success" :title="notice" role="status" :closable="false" show-icon />
    <ElAlert v-if="host?.error.value" type="error" :title="host.error.value" role="alert" :closable="false" show-icon />
    <ElAlert
      v-if="host?.notice.value"
      type="success"
      :title="host.notice.value"
      role="status"
      :closable="false"
      show-icon
    />
    <ElForm
      label-position="top"
      v-if="(candidate || sourceProject) && !viewingHosted"
      class="panel"
      aria-label="选择目标环境"
      @submit.prevent="addCandidate"
    >
      <strong>{{ candidate ? candidate.name + ' ' + candidate.version : sourceProject?.name }}</strong>
      <p v-if="!editableEnvironments.length">请先新建环境，或复制默认环境。</p>
      <ElFormItem v-else label="目标环境"
        ><ElSelect filterable v-model="packageEnvironmentId" :disabled="busy" aria-label="目标环境">
          <ElOption
            v-for="environment in editableEnvironments"
            :key="environment.document.id"
            :value="environment.document.id"
            :label="environment.document.name"
          /> </ElSelect
      ></ElFormItem>
      <ElButton native-type="submit" type="primary" :loading="busy" :disabled="!targetEnvironment || busy || preparing">
        {{ sourceProject ? '构建并加入环境' : '加入环境' }}
      </ElButton>
      <ElButton v-if="candidate" :disabled="!targetEnvironment || busy" @click="useCandidate">编辑环境依赖</ElButton>
      <ElButton :disabled="busy" @click="acceptPackage">取消</ElButton>
    </ElForm>
    <ElSkeleton v-if="!initialized" :rows="8" animated aria-label="正在加载环境" />
    <ManagementEnvironments
      v-else-if="host && viewingHosted"
      :controller="host"
      :key="selection || undefined"
      :hide-navigation="selection !== undefined"
      :navigation="navigation"
      v-model:edit-requested="editRequested"
      @navigate="select"
    >
      <template #toolbar>
        <ElButton v-if="library || canAuthor" @click="router.push({ name: 'Creation' })">创作</ElButton>
        <ElButton @click="tasksOpen = true">任务</ElButton>
      </template>
    </ManagementEnvironments>
    <EnvironmentWorkspace
      v-else
      :key="selection || undefined"
      :hide-navigation="selection !== undefined"
      :navigation="navigation"
      v-model:edit-requested="editRequested"
      @navigate="select"
      :available-packages="materials"
      :pending-package="pendingPackage"
      :package-environment-id="packageEnvironmentId"
      @package-accepted="acceptPackage"
      :allow-server-creation="canManageHost"
      @create-on-server="createOnServer"
      heading="本机环境库"
      :environments="snapshot.environments"
      :installations="snapshot.installations"
      :can-export="true"
      :preview-export="previewExport"
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
      :busy="busy || !!host?.busy.value"
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
      @delete="version => run({ action: 'clear-installation', installationId: version.installationId }, '安装已清理。')"
      @delete-draft="
        environment =>
          run(
            { action: 'delete-draft', environmentId: environment.document.id, expectedRevision: environment.revision },
            '环境草稿已删除。',
          )
      "
    >
      <template #detail>
        <EnvironmentServerUsage
          v-if="host?.server.value && relatedHostId"
          :controller="host"
          :environment-id="relatedHostId"
        />
      </template>
      <template #member-actions="{ environment, packageName: name, integrity }">
        <ElButton
          link
          type="primary"
          :disabled="
            busy || preparing || !editableEnvironments.some(item => item.document.id !== environment.document.id)
          "
          @click="chooseTarget(environment.document.id, name, integrity)"
          >用于其他环境</ElButton
        >
        <ElButton
          link
          type="primary"
          :disabled="busy || preparing"
          @click="memberAction({ action: 'save-member', environmentId: environment.document.id, name, integrity })"
          >保存到本机包库</ElButton
        >
      </template>
      <template #package-source>
        <ElButton v-if="library" :disabled="busy" @click="importPackage">从文件加入内容包</ElButton>
      </template>
      <template #toolbar>
        <ElButton v-if="library || canAuthor" @click="router.push({ name: 'Creation' })">创作</ElButton>
        <ElButton @click="tasksOpen = true">任务{{ activeTasks ? `（${activeTasks}）` : '' }}</ElButton>
        <ElButton :disabled="busy || preparing" @click="openRecipeInstaller">安装环境包</ElButton>
        <ElButton :disabled="busy" @click="openImport">导入环境</ElButton>
      </template>
      <template #settings><ElCheckbox v-model="allowDownload">允许下载缺失的第三方包</ElCheckbox></template>
    </EnvironmentWorkspace>
    <ElDialog
      :model-value="!!transferMember"
      title="用于其他环境"
      width="min(460px, 94vw)"
      @close="transferMember = undefined"
    >
      <p>{{ transferMember?.name }}</p>
      <ElSelect v-model="targetId" filterable placeholder="选择目标环境" aria-label="目标环境">
        <ElOption
          v-for="item in editableEnvironments.filter(item => item.document.id !== transferMember?.environmentId)"
          :key="item.document.id"
          :label="item.document.name"
          :value="item.document.id"
        />
      </ElSelect>
      <template #footer
        ><ElButton @click="transferMember = undefined">取消</ElButton>
        <ElButton type="primary" :disabled="busy || !targetId" @click="useMember">加入环境</ElButton></template
      >
    </ElDialog>
    <ElDialog
      v-model="recipeDialog"
      title="安装环境包"
      width="min(480px, 94vw)"
      :show-close="!busy"
      :close-on-click-modal="!busy"
      :close-on-press-escape="!busy"
      append-to-body
      destroy-on-close
    >
      <ElForm label-position="top" aria-label="安装环境包" @submit.prevent="installRecipe">
        <ElAlert v-if="error" type="error" :title="error" role="alert" :closable="false" />
        <ElFormItem label="来源">
          <ElRadioGroup v-model="recipeSource" :disabled="busy" aria-label="环境包来源">
            <ElRadioButton value="npm">npm 注册表</ElRadioButton>
            <ElRadioButton value="file">本地归档 (.tgz)</ElRadioButton>
          </ElRadioGroup>
        </ElFormItem>
        <ElFormItem v-if="recipeSource === 'npm'" label="npm 包名与版本">
          <ElInput
            v-model="recipeSpec"
            placeholder="@author/singles-cup@1.0.0"
            aria-label="npm 包名与版本"
            :disabled="busy"
          />
        </ElFormItem>
        <ElFormItem label="新环境标识（可选）">
          <ElInput
            v-model="recipeEnvironmentId"
            aria-label="新环境标识"
            placeholder="默认使用包内标识"
            maxlength="80"
            :disabled="busy"
          />
        </ElFormItem>
        <ElCheckbox v-model="recipeDownload" :disabled="busy">允许联网下载环境包和缺失的依赖</ElCheckbox>
      </ElForm>
      <template #footer>
        <ElButton :disabled="busy" @click="recipeDialog = false">取消</ElButton>
        <ElButton
          type="primary"
          :loading="busy"
          :disabled="busy || (recipeSource === 'npm' && !recipeSpec.trim())"
          @click="installRecipe"
          >{{ recipeSource === 'file' ? '选择归档并安装' : '安装' }}</ElButton
        >
      </template>
    </ElDialog>
    <EnvironmentImportDialog
      :target="importingToHost ? 'host' : 'local'"
      :check-archives="importingToHost ? host?.checkArchives : checkArchives"
      :allow-download="allowDownload"
      v-model="importing"
      :busy="busy || preparing || !!host?.busy.value"
      :error="(importingToHost && host?.error.value) || error"
      @import="importEnvironment"
    >
      <ElCheckbox v-if="canManageHost || importingToHost" v-model="importingToHost">导入到本机服务器</ElCheckbox>
    </EnvironmentImportDialog>
    <ElDrawer v-model="tasksOpen" title="环境任务" size="min(680px, 100vw)" append-to-body
      ><section class="panel" aria-label="本地环境任务">
        <h3>下载与准备任务</h3>
        <ElButton @click="run({ action: 'clear-completed' }, '已清除结束的任务记录。')">清除已结束</ElButton>
        <p v-if="!snapshot.operations.length">暂无任务。</p>
        <article v-for="job in snapshot.operations" :key="job.id">
          <span>{{ jobNames[job.kind] ?? job.kind }} · {{ jobLabels[job.status] }}</span>
          <ElButton
            v-if="['queued', 'running'].includes(job.status)"
            @click="run({ action: 'cancel', operationId: job.id }, '已请求取消。')"
          >
            取消任务
          </ElButton>
          <p v-if="job.progress">{{ stageLabels[job.progress.stage] ?? job.progress.stage }}</p>
          <ElProgress
            v-if="job.status === 'running'"
            indeterminate
            :percentage="100"
            :show-text="false"
            aria-label="正在处理"
          />
          <ElButton
            v-if="['failed', 'cancelled'].includes(job.status)"
            @click="run({ action: 'retry', operationId: job.id }, '已重新加入队列。')"
          >
            重试
          </ElButton>
          <p v-if="job.error" class="error">{{ contentTaskError(job.error) }}</p>
        </article>
      </section>
      <ManagementTasks v-if="host?.server.value" :controller="host" content-only
    /></ElDrawer>
  </section>
</template>
<style scoped>
.local-environments {
  display: grid;
  gap: 12px;
  min-width: 0;
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
.panel button:not(.el-button),
.panel input,
.panel select {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
}
.panel article {
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-light);
}
.panel button {
  margin: 6px;
}
.error {
  color: var(--el-color-danger);
}
button:disabled {
  opacity: 0.5;
}
</style>
