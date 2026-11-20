<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { authorCall, type AuthorJob, type SourceProject } from './types'
const props = defineProps<{
  mode: 'sync' | 'clone' | 'release'
  project?: string
  projectName?: string
  hasCommit?: boolean
  running?: boolean
  hasChanges?: boolean
  tag?: string
  pack?: AuthorJob
  dirty?: boolean
  hasRemote?: boolean
}>()
const emit = defineEmits<{ bound: []; cloned: [project: SourceProject]; sync: [] }>()
interface Account {
  installationUrl?: string
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
  repoName = ref(''),
  transferring = ref(false),
  newName = ref(
    (props.projectName ?? '')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^[^a-z0-9]+|-+$/gi, '')
      .slice(0, 100) || 'content-pack',
  ),
  createdRepo = ref(''),
  privateRepo = ref(true),
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
  if (props.mode === 'clone') {
    await list()
    return
  }
  if (props.mode === 'sync') {
    repoName.value = props.hasRemote ? ((await call<{ repository?: string }>('sync-target')).repository ?? '') : ''
    if (!props.hasRemote && !repoName.value) await list()
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
      else await accountState()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }
  if (alive) timer = setTimeout(poll, account.value?.connecting ? 1500 : 20000)
}
async function connect() {
  account.value = await call<Account>('connect')
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
async function clone() {
  transferring.value = true
  try {
    emit('cloned', await call<SourceProject>('clone', { repository: selected.value }))
  } finally {
    transferring.value = false
  }
}
async function transfer(operation: 'fetch' | 'pull' | 'push' | 'push-tag') {
  transferring.value = true
  try {
    await authorCall({ action: 'git', id: props.project, operation, githubApp: true })
    notice.value = {
      fetch: '已获取远端更新',
      pull: '本地分支已同步',
      push: '已推送当前分支',
      'push-tag': '已推送版本标签',
    }[operation]
    emit('bound')
  } finally {
    transferring.value = false
  }
}
async function create() {
  const result = await call<{ repository: string; bound: boolean; error?: string } | null>('create', {
    name: newName.value.trim(),
    private: privateRepo.value,
  })
  if (!result) return
  createdRepo.value = result.repository
  selected.value = result.repository
  if (!repos.value.includes(result.repository)) repos.value.push(result.repository)
  notice.value = '已创建 ' + result.repository
  if (!result.bound) {
    error.value = result.error || '请绑定已创建的仓库。'
    return
  }
  repoName.value = result.repository
  emit('bound')
}
async function bind() {
  await call('bind', { repository: selected.value })
  repoName.value = selected.value
  emit('bound')
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
    <strong v-if="account?.login">{{ account.login }}</strong>
    <button v-if="mode === 'release' && account && (!account.login || !dashboard?.target)" @click="emit('sync')">
      前往 GitHub 同步
    </button>
    <div v-if="mode !== 'release' && account && !account.login">
      <template v-if="account.verification"
        ><code>{{ account.verification.code }}</code>
        <button @click="run(() => open(account!.verification!.url))">在 GitHub 输入设备码</button>
      </template>
      <span v-else-if="account.connecting">正在请求设备码…</span>
      <button v-else :disabled="busy" @click="run(connect)">连接 GitHub</button>
      <button v-if="account.connecting" @click="run(disconnect)">取消连接</button>
    </div>
    <template v-if="account?.login">
      <div v-if="mode !== 'release'">
        <button :disabled="busy" @click="run(disconnect)">断开连接</button>
        <button v-if="account.installationUrl" @click="run(() => open(account!.installationUrl!))">安装到仓库</button>
        <button @click="run(() => open('https://github.com/settings/installations'))">管理仓库授权</button>
      </div>
      <form v-if="mode === 'sync' && !hasRemote && !createdRepo" class="new-repo" @submit.prevent="run(create)">
        <label
          >仓库名称 <span>{{ account.login }} /</span
          ><input
            v-model.trim="newName"
            aria-label="仓库名称"
            required
            maxlength="100"
            pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{0,99}"
        /></label>
        <label
          >可见性<select v-model="privateRepo">
            <option :value="true">私有</option>
            <option :value="false">公开</option>
          </select></label
        >
        <button type="submit" :disabled="busy || !newName">创建并绑定仓库</button>
      </form>
      <div v-if="mode === 'clone' || (mode === 'sync' && !hasRemote)">
        <button :disabled="busy" @click="run(list)">列出授权仓库</button>
        <select v-if="repos.length" v-model="selected" aria-label="授权仓库">
          <option value="">选择仓库</option>
          <option v-for="repo in repos" :key="repo">{{ repo }}</option>
        </select>
        <button v-if="selected && mode === 'clone'" :disabled="busy" @click="run(clone)">克隆并打开</button>
        <button v-else-if="selected" :disabled="busy" @click="run(bind)">绑定所选仓库</button>
      </div>
      <template v-if="mode === 'sync' && hasRemote">
        <p v-if="repoName">{{ repoName }}</p>
        <div v-if="repoName">
          <button :disabled="busy" @click="run(() => transfer('fetch'))">获取更新</button>
          <button :disabled="busy || dirty || running || hasChanges" @click="run(() => transfer('pull'))">拉取</button>
          <button :disabled="busy || !hasCommit" @click="run(() => transfer('push'))">推送分支</button>
          <span v-if="!hasCommit">暂存要同步的文件并完成首次提交。</span>
          <button v-if="tag" :disabled="busy || dirty" @click="run(() => transfer('push-tag'))">
            推送版本标签 {{ tag }}
          </button>
        </div>
        <p v-else>当前远端不是 GitHub HTTPS 仓库，请使用本机 Git 同步。</p>
      </template>
      <button
        v-if="transferring"
        @click="authorCall({ action: 'git-cancel', id: mode === 'clone' ? 'clone' : project })"
      >
        取消传输
      </button>
      <button v-if="mode === 'release' && dashboard?.target" :disabled="busy" @click="run(refresh)">
        刷新发行状态
      </button>
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
.creator-github div,
.new-repo {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
button,
input:not([type='checkbox']),
select {
  font: inherit;
  color: inherit;
  border: 1px solid var(--author-border);
  border-radius: 6px;
  background: var(--author-panel);
  padding: 6px 10px;
  max-width: 100%;
}
label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
button:enabled,
summary {
  cursor: pointer;
}
button:enabled:hover {
  border-color: var(--author-accent);
}
button:disabled {
  opacity: 0.5;
}
p,
ul {
  margin: 0;
}
[role='alert'] {
  color: var(--el-color-danger);
}
</style>
