<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { authorCall, type AuthorJob } from './types'
const props = defineProps<{
  project: string
  pack?: AuthorJob
  dirty: boolean
  hasRemote?: boolean
}>()
const emit = defineEmits<{ bound: [] }>()
interface Account {
  configured: boolean
  login?: string
  connecting: boolean
  verification?: { code: string; url: string }
  error?: string
}
interface Dashboard {
  error?: string
  target?: {
    manifestVersion: string
    packageRepositoryMatches: boolean
    repository: string
    tag: string
    tagged: boolean
    head?: string
  }
  runs?: { id: number; name: string; status: string; conclusion?: string; url: string }[]
  release?: { tag: string; draft: boolean; page: string; archive?: string; integrity?: string }
}
const account = shallowRef<Account>(),
  dashboard = shallowRef<Dashboard>(),
  repos = ref<string[]>([]),
  selected = ref(''),
  newName = ref(''),
  privateRepo = ref(true),
  clientId = ref(''),
  publishNpm = ref(false)
const error = ref(''),
  notice = ref(''),
  busy = ref(false)
let timer: ReturnType<typeof setTimeout>,
  alive = true
const call = <T,>(operation: string, extra: Record<string, unknown> = {}) =>
  authorCall<T>({ action: 'creator-github', id: props.project, operation, ...extra })
async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await fn()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
async function accountState() {
  const next = await call<Account>('account')
  if (!alive) return
  account.value = next
  if (next.error) error.value = next.error
}
async function refresh() {
  await accountState()
  if (!account.value?.login) {
    dashboard.value = undefined
    return
  }
  dashboard.value = await call<Dashboard>('dashboard')
  if (dashboard.value.error) error.value = dashboard.value.error
}
async function poll() {
  if (!alive) return
  if (!busy.value && !document.hidden) {
    const wasConnecting = account.value?.connecting
    try {
      if (wasConnecting) {
        await accountState()
        if (account.value?.login) await refresh()
      } else if (account.value?.login && dashboard.value?.target) await refresh()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }
  if (alive) timer = setTimeout(poll, account.value?.connecting ? 1500 : 20000)
}
async function connect() {
  account.value = await call<Account>('connect', { clientId: clientId.value.trim() })
  clearTimeout(timer)
  timer = setTimeout(poll, 300)
}
async function disconnect() {
  account.value = await call<Account>('disconnect')
  dashboard.value = undefined
  repos.value = []
  selected.value = ''
}
async function list() {
  repos.value = await call<string[]>('repositories')
}
async function create() {
  const name = await call<string | null>('create', { name: newName.value, private: privateRepo.value })
  if (name) {
    notice.value = '已创建 ' + name
    await list()
    selected.value = name
  }
}
async function bind() {
  await call('bind', { repository: selected.value })
  emit('bound')
  await refresh()
}
async function saveRepository() {
  const target = dashboard.value?.target
  if (!target) return
  await call('save-repository', { repository: target.repository, manifestVersion: target.manifestVersion })
  await refresh()
  emit('bound')
}
async function dispatch() {
  const result = await call<{ submitted: boolean } | null>('dispatch', {
    jobId: props.pack?.jobId,
    publishNpm: publishNpm.value,
  })
  if (result) {
    notice.value = '已提交发行工作流'
    await refresh()
  }
}
async function copyRelease(field: 'archive' | 'integrity') {
  const archive = dashboard.value?.release?.[field]
  if (archive) {
    await navigator.clipboard.writeText(archive)
    notice.value = field === 'archive' ? '已复制发行归档地址' : '已复制归档校验值'
  }
}
async function open(url: string) {
  await call('open', { url })
}
const labels: Record<string, string> = {
  queued: '排队中',
  in_progress: '运行中',
  completed: '已结束',
  success: '成功',
  failure: '失败',
  cancelled: '已取消',
  waiting: '等待中',
  action_required: '需要处理',
  skipped: '已跳过',
}
onMounted(async () => {
  await run(refresh)
  if (alive) timer = setTimeout(poll, 1500)
})
onBeforeUnmount(() => {
  alive = false
  clearTimeout(timer)
})
</script>
<template>
  <section class="creator-github">
    <strong
      >GitHub 创作账号<span v-if="account?.login"> · {{ account.login }}</span></strong
    >
    <div v-if="account && !account.login">
      <template v-if="account.verification"
        ><code>{{ account.verification.code }}</code>
        <button @click="run(() => open(account!.verification!.url))">在 GitHub 输入设备码</button>
      </template>
      <span v-else-if="account.connecting">正在请求设备码…</span>
      <template v-else
        ><label v-if="!account.configured">创作 App Client ID <input v-model="clientId" placeholder="Iv1.…" /></label>
        <button :disabled="busy || (!account.configured && !clientId.trim())" @click="run(connect)">
          连接 GitHub
        </button></template
      >
      <button v-if="account.connecting" @click="run(disconnect)">取消连接</button>
    </div>
    <template v-if="account?.login">
      <div>
        <button :disabled="busy" @click="run(disconnect)">断开连接</button>
        <button @click="run(() => open('https://github.com/settings/installations'))">管理仓库授权</button>
      </div>
      <div v-if="!hasRemote">
        <button :disabled="busy" @click="run(list)">列出授权仓库</button>
        <select v-if="repos.length" v-model="selected" aria-label="授权仓库">
          <option value="">选择仓库</option>
          <option v-for="repo in repos" :key="repo">{{ repo }}</option>
        </select>
        <button v-if="selected" :disabled="busy" @click="run(bind)">绑定所选仓库</button>
        <details>
          <summary>创建 GitHub 仓库</summary>
          <button @click="run(() => open('https://github.com/new'))">在 GitHub 创建</button
          ><input v-model="newName" aria-label="新仓库名称" placeholder="仓库名称" />
          <label><input type="checkbox" v-model="privateRepo" />私有仓库</label
          ><button :disabled="busy || !newName.trim()" @click="run(create)">创建仓库</button>
        </details>
      </div>
      <button :disabled="busy" @click="run(refresh)">刷新远端状态</button>
      <template v-if="dashboard?.target">
        <p>{{ dashboard.target.repository }} · {{ dashboard.target.tag }}</p>
        <button
          v-if="!dashboard.target.packageRepositoryMatches"
          :disabled="dirty || busy"
          @click="run(saveRepository)"
        >
          将仓库地址写入包声明
        </button>
        <ul>
          <li v-for="row in dashboard.runs" :key="row.id">
            <button @click="run(() => open(row.url))">
              {{ row.name }} #{{ row.id }} · {{ labels[row.conclusion || row.status] || row.conclusion || row.status }}
            </button>
          </li>
        </ul>
        <p v-if="!dashboard.release">GitHub 尚无此版本的 Release</p>
        <button v-else @click="run(() => open(dashboard!.release!.page))">
          {{ dashboard.release.draft ? '查看发行草稿' : '查看 GitHub Release' }}
        </button>
        <button v-if="dashboard.release?.archive" @click="run(() => copyRelease('archive'))">复制安装地址</button>
        <button v-if="dashboard.release?.integrity" @click="run(() => copyRelease('integrity'))">复制校验值</button>
        <label><input v-model="publishNpm" type="checkbox" />同时发布到 npm</label>
        <button
          :disabled="
            busy ||
            dirty ||
            pack?.kind !== 'release' ||
            pack.stale ||
            pack.state !== 'succeeded' ||
            (publishNpm && !dashboard.target.packageRepositoryMatches) ||
            !dashboard.target.tagged
          "
          @click="run(dispatch)"
        >
          启动发行工作流
        </button>
      </template>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>
<style scoped>
.creator-github {
  display: grid;
  gap: 0.5rem;
}
.creator-github div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
button,
input,
select {
  font: inherit;
  color: inherit;
}
p,
ul {
  margin: 0;
}
[role='alert'] {
  color: var(--el-color-danger);
}
</style>
