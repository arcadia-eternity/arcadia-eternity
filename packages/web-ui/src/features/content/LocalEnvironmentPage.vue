<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import EnvironmentWorkspace from '@/features/management/EnvironmentWorkspace.vue'
import type { ManagedEnvironment, ManagedEnvironmentDocument, ManagedEnvironmentVersion } from '@/types/management'
interface Job {
  id: string
  kind: string
  status: string
  error?: { message: string }
  result?: ManagedEnvironmentVersion
}
interface Snapshot {
  workspaceId: string
  environments: ManagedEnvironment[]
  versions: ManagedEnvironmentVersion[]
  operations: Job[]
}
const jobLabels: Record<string, string> = {
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}
const snapshot = ref<Snapshot>({ workspaceId: '', environments: [], versions: [], operations: [] })
const busy = ref(false),
  error = ref(''),
  notice = ref(''),
  saveSequence = ref(0),
  allowDownload = ref(false)
const selectedExport = ref(''),
  importId = ref(''),
  references = ref<unknown[]>()
const preparing = computed(() => snapshot.value.operations.some(job => job.status === 'running'))
const readyVersions = computed(() => snapshot.value.versions.filter(version => version.status === 'ready'))
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
  if (await run({ action: 'save', document, expectedRevision }, '草稿已保存，服务器版本保持不变。'))
    saveSequence.value++
}
async function prepare(environment: ManagedEnvironment) {
  await run(
    {
      action: 'prepare',
      environmentId: environment.document.id,
      expectedRevision: environment.revision,
      allowDownload: allowDownload.value,
    },
    '正在准备新版本；可离开页面，稍后查看结果。',
  )
}
async function inspect(version: ManagedEnvironmentVersion) {
  try {
    references.value = (
      await call<{ references: unknown[] }>({ action: 'references', versionId: version.versionId })
    ).references
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取引用'
  }
}
async function exportVersion() {
  if (!selectedExport.value || busy.value) return
  busy.value = true
  error.value = ''
  let url: string | undefined
  try {
    const bundle = await call({ action: 'export', versionId: selectedExport.value })
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
    <p class="scope-note">本机环境库 · 编辑和保存无需开服。服务器使用独立副本，发布前不会改变正在运行的玩法。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <label class="download-policy"><input v-model="allowDownload" type="checkbox" />准备版本时允许下载缺失材料</label>
    <EnvironmentWorkspace
      :environments="snapshot.environments"
      :versions="snapshot.versions"
      :can-edit="true"
      :can-prepare="!preparing"
      :can-delete="true"
      :can-use="false"
      :busy="busy"
      :save-sequence="saveSequence"
      @save="save"
      @prepare="prepare"
      @references="inspect"
      @delete="version => run({ action: 'delete-version', versionId: version.versionId }, '版本已删除。')"
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
    <section class="panel" aria-label="环境导入导出">
      <h3>在本机与服务器之间传递环境</h3>
      <p>导出包含固定版本与内容材料。目标服务器校验导入后，再选择开放或更新。</p>
      <label
        >导出的固定版本<select v-model="selectedExport">
          <option value="">选择版本</option>
          <option v-for="version in readyVersions" :key="version.versionId" :value="version.versionId">
            {{ version.document.name }} · {{ new Date(version.createdAt).toLocaleString() }}
          </option>
        </select></label
      >
      <button :disabled="busy || !selectedExport" @click="exportVersion">导出环境文件</button>
      <label>导入为新环境标识（可选）<input v-model="importId" placeholder="保留原标识；不能与现有环境重名" /></label>
      <label
        >导入环境文件<input
          type="file"
          accept="application/json,.json"
          :disabled="busy || preparing"
          @change="importFile"
      /></label>
    </section>
    <section class="panel" aria-label="本地环境任务">
      <h3>环境任务</h3>
      <p v-if="!snapshot.operations.length">暂无任务。</p>
      <article v-for="job in snapshot.operations" :key="job.id">
        <span
          >{{ job.kind === 'environment.prepare' ? '准备环境版本' : '导入环境' }} · {{ jobLabels[job.status] }}</span
        >
        <button v-if="job.status === 'running'" @click="run({ action: 'cancel', operationId: job.id }, '已请求取消。')">
          取消任务
        </button>
        <p v-if="job.error" class="error">{{ job.error.message }}</p>
      </article>
    </section>
  </section>
</template>
<style scoped>
.local-environments {
  color: #243042;
}
.scope-note {
  padding: 14px;
  background: #eaf2ff;
  border-radius: 8px;
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
