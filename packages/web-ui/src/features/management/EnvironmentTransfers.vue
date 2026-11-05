<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ManagedEnvironmentVersion, ManagementOperation } from '@/types/management'

const props = defineProps<{
  versions: ManagedEnvironmentVersion[]
  operations: ManagementOperation[]
  busy: boolean
  canImport: boolean
  canExport: boolean
}>()
const emit = defineEmits<{
  import: [input: { bundle: unknown; environmentId?: string; expectedRevision: null }]
  export: [version: ManagedEnvironmentVersion]
  download: [operation: ManagementOperation]
}>()
const maxBytes = 128 * 1024 * 1024
const selectedVersion = ref('')
const selectedFile = ref('')
const fileBytes = ref(0)
const importId = ref('')
const bundle = shallowRef<unknown>()
const preview = ref<{ name: string; id: string; contentRevision: string; packageCount: number; fileCount: number }>()
const validation = ref('')
const reading = ref(false)
const fileInput = ref<HTMLInputElement>()
const now = ref(Date.now())
let readGeneration = 0
let reader: FileReader | undefined
let timer: ReturnType<typeof setInterval> | undefined
const readyVersions = computed(() => props.versions.filter(version => version.status === 'ready'))
const exports = computed(() => props.operations.filter(operation => operation.kind === 'environment.export'))
const statuses: Record<ManagementOperation['status'], string> = {
  queued: '等待中',
  running: '导出中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '执行中断',
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`
function downloadInfo(operation: ManagementOperation) {
  const result = operation.result
  if (
    operation.status !== 'succeeded' ||
    !record(result) ||
    !text(result.filename) ||
    !text(result.downloadPath) ||
    !/^\/api\/management\/v1\/transfers\/[a-f0-9]{64}$/.test(result.downloadPath) ||
    typeof result.bytes !== 'number' ||
    !Number.isSafeInteger(result.bytes) ||
    result.bytes < 0 ||
    typeof result.expiresAt !== 'number' ||
    !Number.isFinite(result.expiresAt)
  )
    return undefined
  return { filename: result.filename, bytes: result.bytes, expiresAt: result.expiresAt }
}
function clearFile() {
  readGeneration++
  reader?.abort()
  reader = undefined
  reading.value = false
  bundle.value = undefined
  preview.value = undefined
  selectedFile.value = ''
  fileBytes.value = 0
  importId.value = ''
  validation.value = ''
  if (fileInput.value) fileInput.value.value = ''
}
async function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  clearFile()
  if (!file || !props.canImport || props.busy) return
  if (file.size > maxBytes) {
    validation.value = '环境文件超过 128 MiB，请缩小导出内容后重试。'
    return
  }
  const generation = readGeneration
  const currentReader = new FileReader()
  reader = currentReader
  reading.value = true
  try {
    const contents = await new Promise<string>((resolve, reject) => {
      currentReader.onload = () => resolve(String(currentReader.result))
      currentReader.onerror = () => reject(new Error('无法读取此文件。'))
      currentReader.onabort = () => reject(new Error('读取已取消。'))
      currentReader.readAsText(file)
    })
    if (generation !== readGeneration || !props.canImport) return
    const parsed: unknown = JSON.parse(contents)
    if (
      !record(parsed) ||
      parsed.format !== 'arcadia.environment-export/1' ||
      !record(parsed.document) ||
      parsed.document.schemaVersion !== 2 ||
      !text(parsed.document.id) ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(parsed.document.id) ||
      !text(parsed.document.name) ||
      !record(parsed.document.packages) ||
      !Array.isArray(parsed.files) ||
      !text(parsed.contentRevision)
    ) {
      throw new Error('此文件不是支持的环境导出文件。')
    }
    bundle.value = parsed
    selectedFile.value = file.name
    fileBytes.value = file.size
    preview.value = {
      name: parsed.document.name,
      id: parsed.document.id,
      contentRevision: parsed.contentRevision,
      packageCount: Object.keys(parsed.document.packages).length,
      fileCount: parsed.files.length,
    }
  } catch (cause) {
    if (generation === readGeneration)
      validation.value =
        cause instanceof SyntaxError
          ? '无法解析 JSON，请选择完整的环境导出文件。'
          : cause instanceof Error
            ? cause.message
            : '无法读取环境文件。'
  } finally {
    if (generation === readGeneration) {
      reading.value = false
      reader = undefined
    }
  }
}
function importEnvironment() {
  if (props.busy || !props.canImport || !bundle.value || !preview.value || reading.value) return
  const environmentId = importId.value.trim()
  if (environmentId && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(environmentId)) {
    validation.value = '环境标识须为小写字母、数字、下划线或连字符，最多 80 个字符。'
    return
  }
  validation.value = ''
  emit('import', { bundle: bundle.value, ...(environmentId ? { environmentId } : {}), expectedRevision: null })
}
function exportEnvironment() {
  const version = readyVersions.value.find(version => version.versionId === selectedVersion.value)
  if (!props.busy && props.canExport && version) emit('export', version)
}
function download(operation: ManagementOperation) {
  const info = downloadInfo(operation)
  if (!props.busy && props.canExport && info && info.expiresAt > Date.now()) emit('download', operation)
}
watch(
  () => props.canImport,
  allowed => {
    if (!allowed) clearFile()
  },
)
watch(readyVersions, versions => {
  if (!versions.some(version => version.versionId === selectedVersion.value)) selectedVersion.value = ''
})
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearFile()
})
</script>

<template>
  <section class="environment-transfers" aria-label="环境导入导出">
    <h2>导入与导出</h2>
    <p class="hint">导出包含固定版本的环境配置和已捕获的内容材料。导入后会重新校验，并生成本工作区的固定版本。</p>
    <div class="transfer-grid">
      <form aria-label="导出环境" @submit.prevent="exportEnvironment">
        <h3>导出固定版本</h3>
        <label
          >要导出的版本<select v-model="selectedVersion" :disabled="busy || !canExport">
            <option value="" disabled>选择已准备的版本</option>
            <option v-for="version in readyVersions" :key="version.versionId" :value="version.versionId">
              {{ version.document.name }} · {{ version.versionId }}
            </option>
          </select></label
        >
        <button :disabled="busy || !canExport || !selectedVersion">创建导出文件</button>
        <p v-if="!canExport" class="hint">导出需要此工作区的导出权限。</p>
        <p v-else-if="!readyVersions.length" class="hint">准备固定版本后即可导出。</p>
      </form>
      <form aria-label="导入环境" @submit.prevent="importEnvironment">
        <h3>导入环境文件</h3>
        <label
          >环境 JSON 文件<input
            ref="fileInput"
            type="file"
            accept=".json,application/json"
            :disabled="busy || !canImport || reading"
            @change="chooseFile"
        /></label>
        <p class="hint">文件最多 128 MiB。只创建新环境；若标识已存在，请先填写一个新标识。</p>
        <p v-if="!canImport" class="hint">导入需要此工作区的编辑和准备权限。</p>
        <p v-if="reading" role="status">正在读取环境文件…</p>
        <p v-if="validation" role="alert" class="error">{{ validation }}</p>
        <div v-if="preview" class="import-preview">
          <h4>确认导入内容</h4>
          <p>{{ selectedFile }} · {{ formatBytes(fileBytes) }}</p>
          <dl>
            <dt>环境</dt>
            <dd>{{ preview.name }}（{{ preview.id }}）</dd>
            <dt>内容版本</dt>
            <dd>{{ preview.contentRevision }}</dd>
            <dt>内容材料</dt>
            <dd>{{ preview.packageCount }} 个额外内容包 · {{ preview.fileCount }} 个文件</dd>
          </dl>
          <label
            >新环境标识（可选）<input
              v-model="importId"
              pattern="[a-z0-9][a-z0-9_\-]{0,79}"
              maxlength="80"
              :placeholder="preview.id"
              :disabled="busy || !canImport"
          /></label>
          <div class="actions">
            <button class="primary" :disabled="busy || !canImport || reading">确认导入新环境</button>
            <button type="button" :disabled="busy" @click="clearFile">取消导入</button>
          </div>
          <p class="hint">导入会作为后台任务执行，完成后可在固定版本中使用。</p>
        </div>
      </form>
    </div>
    <div v-if="exports.length" class="export-results" aria-label="导出任务">
      <h3>导出文件</h3>
      <article v-for="operation in exports" :key="operation.id" class="export-result">
        <strong>{{ downloadInfo(operation)?.filename ?? '环境导出' }}</strong>
        <span>{{ statuses[operation.status] }}</span>
        <template v-if="downloadInfo(operation)">
          <p>
            {{ formatBytes(downloadInfo(operation)!.bytes) }} · 有效至
            {{ new Date(downloadInfo(operation)!.expiresAt).toLocaleString() }}
          </p>
          <button
            :disabled="busy || !canExport || downloadInfo(operation)!.expiresAt <= now"
            @click="download(operation)"
          >
            {{ downloadInfo(operation)!.expiresAt <= now ? '文件已过期' : '下载导出文件' }}
          </button>
        </template>
        <p v-else-if="operation.status === 'succeeded'" class="hint">此任务没有可用的下载信息，请重新导出。</p>
        <p v-else-if="operation.status === 'failed' || operation.status === 'interrupted'" class="hint">
          请在“任务”查看失败原因或重试。
        </p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.environment-transfers {
  margin-top: 2rem;
}
h2,
h3,
h4 {
  margin: 0 0 0.75rem;
}
.hint {
  color: #64748b;
  font-size: 0.9rem;
}
.transfer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 1rem;
}
form,
.export-result {
  background: #fff;
  border: 1px solid #dbe2ea;
  border-radius: 12px;
  padding: 1rem;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.8rem 0;
}
input,
select {
  min-width: 0;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0.6rem;
  color: #0f172a;
  background: #fff;
}
button {
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0.5rem 0.8rem;
  background: #fff;
  color: #334155;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary {
  background: #0f766e;
  color: white;
  border-color: #0f766e;
}
.actions {
  display: flex;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.import-preview {
  border-top: 1px solid #e2e8f0;
  margin-top: 1rem;
  padding-top: 1rem;
  overflow-wrap: anywhere;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem 1rem;
  font-size: 0.9rem;
}
dt {
  color: #64748b;
}
dd {
  margin: 0;
}
.export-results {
  margin-top: 1rem;
}
.export-result {
  margin: 0.6rem 0;
  overflow-wrap: anywhere;
}
.export-result span {
  float: right;
}
.error {
  color: #b91c1c;
}
</style>
