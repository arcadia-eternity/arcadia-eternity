<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import { ElDialog, ElMessageBox } from 'element-plus'
import { DiffView, DiffModeEnum } from '@git-diff-view/vue'
import '@git-diff-view/vue/styles/diff-view.css'
import CreatorGitHubPanel from './CreatorGitHubPanel.vue'
import { authorCall, jobStates, type AuthorJob } from './types'

const props = defineProps<{
  project: string
  releaseOpen?: boolean
  dirty: boolean
  running: boolean
  version?: string
  pack?: AuthorJob
}>()
const emit = defineEmits<{ close: []; release: []; version: [] }>()
interface ChangedFile {
  path: string
  staged: boolean
  changed: boolean
  conflict: boolean
}
interface GitState {
  repository: boolean
  branch?: string
  detached?: boolean
  upstream?: string
  hasRemote?: boolean
  tags?: string[]
  ahead?: number
  behind?: number
  files?: ChangedFile[]
}
const state = shallowRef<GitState>(),
  selection = ref<{ path: string; staged: boolean }>()
const difference = shallowRef<{ text?: string; patch?: string }>()
const githubOpen = ref(!!props.releaseOpen)
const transferring = ref(false)
const busy = ref(false),
  error = ref(''),
  message = ref(''),
  notice = ref('')
const groups = computed(() => [
  { title: '冲突', staged: false, files: state.value?.files?.filter(file => file.conflict) ?? [] },
  { title: '未暂存', staged: false, files: state.value?.files?.filter(file => file.changed && !file.conflict) ?? [] },
  { title: '已暂存', staged: true, files: state.value?.files?.filter(file => file.staged && !file.conflict) ?? [] },
])
const checkedRelease = computed(
  () => props.pack?.kind === 'release' && props.pack.state === 'succeeded' && !props.pack.stale,
)
const diffData = computed(() => {
  const patch = difference.value?.patch,
    fileName = selection.value?.path
  if (!patch || !/^@@ /m.test(patch)) return undefined
  return { oldFile: { fileName }, newFile: { fileName }, hunks: [patch] }
})
let timer: ReturnType<typeof setInterval>,
  generation = 0,
  refreshing = false
const call = <T,>(operation: string, extra: Record<string, unknown> = {}) =>
  authorCall<T>({ action: 'git', id: props.project, operation, ...extra })
function diagnose(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
async function refresh() {
  if (refreshing || busy.value) return
  refreshing = true
  const request = generation
  try {
    const next = await call<GitState>('status')
    if (request !== generation) return
    state.value = next
    if (selection.value) await showDiff(selection.value.path, selection.value.staged, request)
  } catch (cause) {
    if (request === generation) error.value = diagnose(cause)
  } finally {
    refreshing = false
  }
}
async function showDiff(path: string, staged: boolean, request = ++generation) {
  const changed = selection.value?.path !== path || selection.value.staged !== staged
  if (changed) difference.value = undefined
  selection.value = { path, staged }
  const row = state.value?.files?.find(row => row.path === path && (staged ? row.staged : row.changed))
  if (!row) {
    selection.value = undefined
    difference.value = undefined
    return
  }
  try {
    const result = await call<{ text?: string; patch?: string }>('diff', { file: path, staged })
    if (
      request === generation &&
      (changed || result.patch !== difference.value?.patch || result.text !== difference.value?.text)
    )
      difference.value = result
  } catch (cause) {
    if (request === generation) {
      difference.value = undefined
      error.value = diagnose(cause)
    }
  }
}
async function run(operation: string, extra: Record<string, unknown> = {}) {
  if (busy.value) return
  ++generation
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    if (operation === 'lock') {
      await authorCall({ action: 'update-author-lock', id: props.project })
      state.value = await call<GitState>('status')
      notice.value = '已更新 npm 锁文件'
      return
    }
    if (operation === 'bind') {
      const answer = await ElMessageBox.prompt('HTTPS 仓库地址', '绑定远端 origin', {
        inputPlaceholder: 'https://',
        confirmButtonText: '绑定',
        cancelButtonText: '取消',
      })
      extra.url = answer.value
    }
    transferring.value = ['fetch', 'pull', 'push', 'push-tag'].includes(operation)
    state.value = await call<GitState>(operation, extra)
    if (operation === 'commit') {
      message.value = ''
      notice.value = '已提交'
    }
    if (operation === 'tag') notice.value = '已创建本地标签 v' + props.version
    if (operation === 'push-tag') notice.value = '已推送版本标签'
    if (operation === 'push') notice.value = '已推送当前分支'
    if (operation === 'pull') notice.value = '本地分支已同步'
    if (operation === 'fetch') notice.value = '已获取远端更新'
    selection.value = undefined
    difference.value = undefined
  } catch (cause) {
    if (cause !== 'cancel' && cause !== 'close') error.value = diagnose(cause)
  } finally {
    transferring.value = false
    busy.value = false
  }
}
onMounted(() => {
  void refresh()
  timer = setInterval(() => {
    if (!document.hidden) void refresh()
  }, 3000)
})
onBeforeUnmount(() => {
  ++generation
  clearInterval(timer)
})
</script>
<template>
  <ElDialog
    model-value
    append-to-body
    destroy-on-close
    :title="releaseOpen ? '发布新版本' : 'Git 版本管理'"
    width="min(940px, 94vw)"
    :close-on-click-modal="false"
    :show-close="!busy"
    :close-on-press-escape="!busy"
    @closed="emit('close')"
  >
    <section class="git-panel" :aria-busy="busy">
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <button v-if="transferring" @click="authorCall({ action: 'git-cancel', id: project })">取消传输</button>
      <p v-if="dirty" role="status">工作台有未保存修改。Git 只读取磁盘上的文件。</p>
      <button v-if="state && !state.repository" :disabled="busy" @click="run('init')">初始化 Git 仓库</button>
      <template v-if="state?.repository">
        <header>
          <strong>{{ state.detached ? '分离的 HEAD' : state.branch }}</strong>
          <span v-if="state.upstream">{{ state.upstream }} · 待推送 {{ state.ahead }} · 待拉取 {{ state.behind }}</span>
          <span v-else>未跟踪远端分支</span>
          <button v-if="!state.hasRemote" :disabled="busy" @click="run('bind')">绑定远端</button>
          <template v-else>
            <button :disabled="busy" @click="run('fetch')">获取更新</button>
            <button :disabled="busy || dirty || running || !!state.files?.length" @click="run('pull')">拉取</button>
            <button :disabled="busy" @click="run('push')">推送分支</button>
          </template>
        </header>
        <p v-if="!state.files?.length">工作区干净</p>
        <section v-for="group in groups.filter(group => group.files.length)" :key="group.title">
          <header>
            <strong>{{ group.title }}（{{ group.files.length }}）</strong>
            <button
              v-if="group.title === '未暂存' && group.files.length > 1"
              :disabled="busy || dirty"
              @click="run('stage-files', { files: group.files.map(row => row.path) })"
            >
              全部暂存
            </button>
          </header>
          <p v-if="group.title === '冲突'">在外部编辑器解决冲突并标记为已解决后，回到这里提交。</p>
          <ul>
            <li v-for="file in group.files" :key="file.path">
              <button class="file" :disabled="busy" @click="showDiff(file.path, group.staged)">{{ file.path }}</button>
              <button
                v-if="!file.conflict"
                :disabled="busy || dirty"
                @click="run(group.staged ? 'unstage' : 'stage', { file: file.path })"
              >
                {{ group.staged ? '取消暂存' : '暂存' }}
              </button>
            </li>
          </ul>
        </section>
        <section v-if="difference && selection" class="diff">
          <DiffView
            v-if="diffData"
            :key="selection.path + selection.staged + difference.patch"
            :data="diffData"
            :diff-view-mode="DiffModeEnum.Unified"
            :diff-view-wrap="true"
            :diff-view-highlight="false"
          />
          <pre v-else>{{ difference.text ?? difference.patch }}</pre>
        </section>
        <form @submit.prevent="run('commit', { message })">
          <input v-model="message" aria-label="提交说明" placeholder="提交说明" maxlength="4000" />
          <button :disabled="busy || dirty || !message.trim() || !groups[2]?.files.length || !!groups[0]?.files.length">
            提交暂存修改
          </button>
        </form>
        <footer>
          <button :disabled="busy || dirty || running" @click="run('lock')">更新 npm 锁文件</button>
          <button :disabled="busy || dirty || running" @click="emit('version')">更改发行版本 {{ version }}</button>
          <button :disabled="busy || dirty || running" @click="emit('release')">检查并生成发行包</button>
          <button
            v-if="state.hasRemote && state.tags?.includes('v' + version)"
            :disabled="busy || dirty"
            @click="run('push-tag')"
          >
            推送版本标签 v{{ version }}
          </button>
          <button
            v-if="checkedRelease && !state.tags?.includes('v' + version)"
            :disabled="busy || dirty || running || !!state.files?.length"
            @click="run('tag', { jobId: pack?.jobId })"
          >
            创建版本标签 v{{ version }}
          </button>
        </footer>
        <section v-if="releaseOpen && pack?.kind === 'release'" aria-label="本地发行检查">
          <p role="status">本地发行检查 · {{ pack.stale ? '源码已改变，请重新检查' : jobStates[pack.state] }}</p>
          <p v-for="(item, index) in pack.diagnostics" :key="index" role="alert">{{ item.message }}</p>
          <details v-if="checkedRelease && pack.result?.files">
            <summary>{{ pack.result.filename }} · {{ pack.result.files.length }} 个文件</summary>
            <code class="integrity">{{ pack.result.integrity }}</code>
            <ul>
              <li v-for="file in pack.result.files" :key="file">{{ file }}</li>
            </ul>
          </details>
        </section>
        <details :open="githubOpen" @toggle="githubOpen = ($event.target as HTMLDetailsElement).open">
          <summary>GitHub 仓库与发行</summary>
          <CreatorGitHubPanel
            v-if="githubOpen"
            :project="project"
            :dirty="dirty"
            :has-remote="state.hasRemote"
            :pack="pack"
            @bound="refresh"
          />
        </details>
      </template>
    </section>
  </ElDialog>
</template>
<style scoped>
.integrity {
  overflow-wrap: anywhere;
}
.git-panel {
  display: grid;
  gap: 12px;
  max-height: 65vh;
  overflow: auto;
}
header,
form,
footer,
li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
ul {
  list-style: none;
  margin: 4px 0;
  padding: 0;
  max-height: 180px;
  overflow: auto;
}
li {
  padding: 2px 0;
}
.file {
  text-align: left;
  overflow-wrap: anywhere;
  flex: 1;
}
button,
input {
  font: inherit;
  color: inherit;
  padding: 4px 9px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-bg-color);
}
button:enabled {
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
}
input {
  flex: 1;
  min-width: 10rem;
}
p {
  margin: 0;
}
[role='alert'] {
  color: var(--el-color-danger);
  white-space: pre-wrap;
}
.diff {
  max-height: 32vh;
  overflow: auto;
}
pre {
  white-space: pre-wrap;
}
</style>
