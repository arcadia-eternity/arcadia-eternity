<script setup lang="ts">
import { contentTaskError } from '@/utils/contentTaskMessages'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import EnvironmentWorkspace from '@/features/management/EnvironmentWorkspace.vue'
import type { ManagedEnvironment, ManagedEnvironmentDocument, ManagedEnvironmentInstallation } from '@/types/management'
interface Job {
  id: string
  kind: string
  status: string
  error?: { code?: string; message: string }
  progress?: { stage: string }
  result?: ManagedEnvironmentInstallation
}
interface Snapshot {
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
const localTab = ref<'workspace' | 'tasks' | 'transfers'>('workspace')
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  saveSequence = ref(0),
  allowDownload = ref(false)
const selectedExport = ref(''),
  importId = ref(''),
  references = ref<unknown[]>()
const preparing = computed(() => snapshot.value.operations.some(job => ['queued', 'running'].includes(job.status)))
const readyVersions = computed(() => snapshot.value.installations.filter(version => version.status === 'ready'))
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
    if (!disposed && sequence === refreshSequence) snapshot.value = next
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
async function exportEnvironment() {
  if (!selectedExport.value || busy.value) return
  busy.value = true
  error.value = ''
  let url: string | undefined
  try {
    const bundle = await call({ action: 'export', installationId: selectedExport.value })
    if (disposed) return
    url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `environment-${selectedExport.value}.json`
    link.click()
    notice.value = '环境文件已导出，可在目标服务器的环境库中导入并发布。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '导出失败'
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000)
    if (!disposed) busy.value = false
  }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 128 * 1024 * 1024) {
    error.value = '环境文件不能超过 128 MiB'
    return
  }
  try {
    await run(
      {
        action: 'import',
        bundle: JSON.parse(await file.text()),
        ...(importId.value.trim() ? { environmentId: importId.value.trim() } : {}),
      },
      '已开始校验导入材料；不会覆盖同名环境。',
    )
  } catch {
    error.value = '无法读取环境文件'
  }
}
onMounted(async () => {
  const poll = async () => {
    await refresh()
    if (!disposed) timer = setTimeout(poll, preparing.value ? 1000 : 4000)
  }
  await poll()
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
})
</script>
<template>
  <section class="local-environments" aria-label="本机环境库">
    <h2>本机环境库</h2>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <nav class="local-tabs" aria-label="环境工具">
      <button :aria-pressed="localTab === 'workspace'" @click="localTab = 'workspace'">环境组合</button
      ><button :aria-pressed="localTab === 'tasks'" @click="localTab = 'tasks'">
        准备任务 {{ preparing ? '· 处理中' : '' }}</button
      ><button :aria-pressed="localTab === 'transfers'" @click="localTab = 'transfers'">导入与导出</button>
    </nav>
    <label v-if="localTab === 'workspace'" class="download-policy"
      ><input v-model="allowDownload" type="checkbox" />允许下载缺失的第三方包</label
    >
    <EnvironmentWorkspace
      v-if="localTab === 'workspace'"
      :environments="snapshot.environments"
      :installations="snapshot.installations"
      :can-edit="true"
      :can-prepare="true"
      :can-delete="true"
      :can-use="false"
      :busy="busy"
      :save-sequence="saveSequence"
      @save="save"
      @package-state="
        (environment, name, enabled, cascade) =>
          run(
            {
              action: 'package-state',
              environmentId: environment.document.id,
              expectedRevision: environment.revision,
              name,
              enabled,
              cascade,
              allowDownload: allowDownload,
            },
            '正在保存并应用。',
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
    />
    <section v-if="references" class="panel" aria-label="本地版本引用">
      <h3>版本引用</h3>
      <p v-if="!references.length">没有引用，可删除此版本。</p>
      <pre v-else>{{ references }}</pre>
      <button @click="references = undefined">关闭引用</button>
    </section>
    <section v-if="localTab === 'transfers'" class="panel" aria-label="环境导入导出">
      <h3>在本机与服务器之间传递环境</h3>
      <label
        >导出的环境<select v-model="selectedExport">
          <option value="">选择版本</option>
          <option v-for="version in readyVersions" :key="version.installationId" :value="version.installationId">
            {{ version.document.name }} · {{ new Date(version.createdAt).toLocaleString() }}
          </option>
        </select></label
      >
      <button :disabled="busy || !selectedExport" @click="exportEnvironment">导出环境文件</button>
      <label>导入为新环境标识（可选）<input v-model="importId" placeholder="保留原标识；不能与现有环境重名" /></label>
      <label
        >导入环境文件<input
          type="file"
          accept="application/json,.json"
          :disabled="busy || preparing"
          @change="importFile"
      /></label>
    </section>
    <section v-if="localTab === 'tasks'" class="panel" aria-label="本地环境任务">
      <h3>下载与准备任务</h3>
      <button @click="run({ action: 'clear-completed' }, '已清除结束的任务记录。')">清除已结束</button>
      <p v-if="!snapshot.operations.length">暂无任务。</p>
      <article v-for="job in snapshot.operations" :key="job.id">
        <span>{{ job.kind === 'environment.apply' ? '保存并应用' : '导入环境' }} · {{ jobLabels[job.status] }}</span>
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
    </section>
  </section>
</template>
<style scoped>
.local-tabs {
  display: flex;
  gap: 8px;
}
.local-tabs button[aria-pressed='true'] {
  background: #eff6ff;
  border-color: #2563eb;
}
.local-environments :deep(.environment-workspace) {
  flex: 1;
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
  height: calc(100dvh - 230px);
  min-height: 0;
  color: #243042;
}
.download-policy {
  display: flex;
  gap: 8px;
  margin: 16px 0;
}
.panel {
  border: 1px solid #dce2ea;
  border-radius: 10px;
  padding: 18px;
  margin: 20px 0;
  background: white;
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
  border: 1px solid #cbd5e1;
  border-radius: 6px;
}
.panel article {
  padding: 12px 0;
  border-bottom: 1px solid #e2e8f0;
}
.panel button {
  margin: 6px;
  background: white;
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
