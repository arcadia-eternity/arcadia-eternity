<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { PersonalEnvironmentReference } from '@arcadia-eternity/protocol'
import {
  createPersonalEnvironmentBundle,
  downloadPersonalEnvironment,
  encodePersonalEnvironmentBundle,
  parsePersonalEnvironmentBundle,
  PERSONAL_ENVIRONMENT_DOWNLOAD_MAX_BYTES,
  PERSONAL_ENVIRONMENT_MAX_BYTES,
  type PreparedPersonalEnvironment,
} from '@/services/personalEnvironment'
import { readResourceBytes } from '@/services/resourceTransport'
import { getDesktopApi } from '@/utils/env'

const props = defineProps<{
  expected?: PersonalEnvironmentReference
  prepared?: PreparedPersonalEnvironment
  disabled?: boolean
  allowReplace?: boolean
}>()
const emit = defineEmits<{ prepared: [value: PreparedPersonalEnvironment]; error: [message: string] }>()
const fileInput = ref<HTMLInputElement>()
const url = ref('')
const busy = ref(false)
const error = ref('')
const desktop = getDesktopApi()
const captureLocal = desktop?.capturePersonalEnvironment?.bind(desktop)
const shown = computed(() => props.prepared?.reference ?? props.expected)
const revision = computed(() => shown.value?.descriptor.peerRevision ?? shown.value?.descriptor.id)
let pending: { controller: AbortController } | undefined
let disposed = false
const downloads = new Map<string, ReturnType<typeof setTimeout>>()

function report(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '无法准备此环境，请检查文件或链接后重试。'
  error.value = message
  emit('error', message)
}
function cancel() {
  const job = pending
  pending = undefined
  busy.value = false
  job?.controller.abort(new DOMException('准备已取消', 'AbortError'))
}
watch(
  () => [props.expected?.descriptor.id, props.disabled, props.allowReplace],
  () => {
    cancel()
    error.value = ''
  },
  { flush: 'sync' },
)

async function prepare(
  action: (signal: AbortSignal, expected?: PersonalEnvironmentReference) => Promise<PreparedPersonalEnvironment>,
) {
  if (props.disabled || disposed) return
  cancel()
  error.value = ''
  const expected = props.expected
    ? (JSON.parse(JSON.stringify(props.expected)) as PersonalEnvironmentReference)
    : undefined
  const allowReplace = !!props.allowReplace
  const job = { controller: new AbortController() }
  pending = job
  busy.value = true
  let candidate: PreparedPersonalEnvironment | undefined
  try {
    candidate = await action(job.controller.signal, expected)
    if (disposed || pending !== job || job.controller.signal.aborted || props.disabled) {
      candidate.release()
      candidate = undefined
      return
    }
    if (expected && !allowReplace && candidate.reference.descriptor.id !== expected.descriptor.id)
      throw new Error('此文件与房间约定的环境版本不同，请向房主取得相同版本。')
    // Accepted materials now belong to the parent. Do not abort their release-bound signal on unmount.
    pending = undefined
    busy.value = false
    const accepted = candidate
    candidate = undefined
    emit('prepared', accepted)
  } catch (cause) {
    candidate?.release()
    if (pending === job && !disposed && !job.controller.signal.aborted) report(cause)
  } finally {
    if (pending === job) {
      pending = undefined
      busy.value = false
    }
  }
}

function readFile(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      cleanup()
      reader.abort()
      reject(signal.reason ?? new DOMException('准备已取消', 'AbortError'))
    }
    reader.onload = () => {
      cleanup()
      resolve(String(reader.result))
    }
    reader.onerror = () => {
      cleanup()
      reject(new Error('无法读取此环境文件。'))
    }
    reader.onabort = () => {
      cleanup()
      reject(signal.reason ?? new DOMException('准备已取消', 'AbortError'))
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    reader.readAsText(file)
  })
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || props.disabled) return
  if (file.size > PERSONAL_ENVIRONMENT_MAX_BYTES) {
    cancel()
    report(new Error('环境文件超过 128 MiB，请使用较小的环境文件。'))
    return
  }
  await prepare(async signal =>
    parsePersonalEnvironmentBundle(await readFile(file, signal), { kind: 'file', name: file.name }, signal),
  )
}
async function acceptUrl() {
  if (props.disabled) return
  const address = url.value.trim()
  let source: URL
  try {
    source = new URL(address)
    if (address.length > 8192 || source.protocol !== 'https:' || source.username || source.password || source.hash)
      throw new Error('invalid URL')
  } catch {
    report(new Error('请输入不含账户信息的 HTTPS 环境链接。'))
    return
  }
  const location = source.toString()
  await prepare(async signal => {
    const bytes = await readResourceBytes(location, { signal, maxBytes: PERSONAL_ENVIRONMENT_DOWNLOAD_MAX_BYTES })
    return parsePersonalEnvironmentBundle(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      { kind: 'https', url: location },
      signal,
    )
  })
}
async function acceptExpected() {
  await prepare(async (signal, expected) => {
    if (!expected || expected.source.kind !== 'https') throw new Error('此环境没有可下载的链接。')
    return downloadPersonalEnvironment(expected, signal)
  })
}
async function acceptLocal() {
  if (!captureLocal) return
  await prepare(async (signal, expected) => {
    const capture = await captureLocal()
    signal.throwIfAborted()
    const bundle = await createPersonalEnvironmentBundle(capture, expected?.rules, signal)
    return parsePersonalEnvironmentBundle(bundle, { kind: 'file', name: 'personal-environment.arcadia.json' }, signal)
  })
}
function exportCurrent() {
  if (!props.prepared || props.disabled) return
  try {
    const contents = encodePersonalEnvironmentBundle(props.prepared.bundle)
    const objectUrl = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = `arcadia-environment-${props.prepared.reference.descriptor.id.slice(0, 12)}.json`
    document.body.appendChild(link)
    try {
      link.click()
    } finally {
      link.remove()
      const timer = setTimeout(() => {
        URL.revokeObjectURL(objectUrl)
        downloads.delete(objectUrl)
      }, 0)
      downloads.set(objectUrl, timer)
    }
  } catch (cause) {
    report(cause)
  }
}
onBeforeUnmount(() => {
  disposed = true
  cancel()
  for (const [objectUrl, timer] of downloads) {
    clearTimeout(timer)
    URL.revokeObjectURL(objectUrl)
  }
  downloads.clear()
})
</script>

<template>
  <section class="personal-environment" aria-label="私人挑战环境">
    <header>
      <h3>私人挑战环境</h3>
      <span v-if="prepared" class="accepted">已接受此版本</span>
    </header>
    <p>双方都需要取得并接受相同的环境，才能准备对局。此选择不会更改服务器的公开环境。</p>
    <div v-if="shown" class="selection">
      <p>
        版本：<code :title="revision">{{ revision?.slice(0, 16) }}</code>
      </p>
      <ul v-if="shown.descriptor.packages.length">
        <li v-for="pack in shown.descriptor.packages" :key="pack.projectId">
          {{ pack.name }} <span>{{ pack.version }}</span>
        </li>
      </ul>
      <p v-else>官方基础内容</p>
      <p v-if="expected && !prepared">请确认来源后，选择文件或下载环境。</p>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="busy" role="status">正在读取并准备环境…</p>
    <div class="actions">
      <button type="button" :disabled="disabled || busy" @click="fileInput?.click()">选择并接受环境文件</button>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".json,application/json"
        aria-label="私人环境文件"
        :disabled="disabled || busy"
        @change="importFile"
      />
      <button v-if="captureLocal" type="button" :disabled="disabled || busy" @click="acceptLocal">
        使用并接受本机环境
      </button>
      <button
        v-if="expected?.source.kind === 'https'"
        type="button"
        :disabled="disabled || busy"
        @click="acceptExpected"
      >
        下载并接受房间环境
      </button>
      <button v-if="prepared" type="button" :disabled="disabled || busy" @click="exportCurrent">
        导出已接受的环境
      </button>
      <button v-if="busy" type="button" @click="cancel">取消准备</button>
    </div>
    <form v-if="!expected" class="url-form" @submit.prevent="acceptUrl">
      <label
        >环境分享链接<input
          v-model="url"
          type="url"
          placeholder="https://…"
          :disabled="disabled || busy"
          required
          maxlength="8192"
          autocomplete="off"
      /></label>
      <button :disabled="disabled || busy || !url.trim()">下载并接受链接环境</button>
    </form>
    <p class="hint">文件最多 128 MiB；链接下载最多 64 MiB。下载只在你点击接受后开始。</p>
  </section>
</template>

<style scoped>
.personal-environment {
  border: 1px solid #dbe2ea;
  border-radius: 10px;
  padding: 1rem;
  margin: 1rem 0;
  color: #334155;
  background: #fff;
}
.personal-environment header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
}
.personal-environment h3 {
  margin: 0;
  color: #0f172a;
}
.personal-environment p {
  font-size: 0.9rem;
  line-height: 1.6;
}
.accepted {
  color: #047857;
  background: #ecfdf5;
  padding: 0.2rem 0.5rem;
  border-radius: 5px;
  font-size: 0.8rem;
}
.selection {
  border-radius: 7px;
  background: #f8fafc;
  padding: 0.4rem 0.8rem;
  margin: 0.8rem 0;
}
.selection p {
  margin: 0.4rem 0;
}
.selection ul {
  padding-left: 1.2rem;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.selection span {
  color: #64748b;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
button {
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0.55rem 0.8rem;
  background: #fff;
  color: #334155;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.file-input {
  display: none;
}
.url-form {
  display: flex;
  align-items: end;
  gap: 0.6rem;
  margin-top: 0.8rem;
}
.url-form label {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.9rem;
}
.url-form input {
  padding: 0.6rem;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #0f172a;
  background: #fff;
  min-width: 0;
}
.hint {
  color: #64748b;
}
.error {
  color: #b91c1c;
}
code {
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .url-form {
    flex-direction: column;
    align-items: stretch;
  }
  .personal-environment header {
    align-items: start;
    flex-direction: column;
  }
}
</style>
