<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { DiffView, DiffModeEnum } from '@git-diff-view/vue'
import '@git-diff-view/vue/styles/diff-view.css'
import {
  ArrowsRightLeftIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ArchiveBoxIcon,
  TagIcon,
  CloudArrowUpIcon,
} from '@heroicons/vue/24/outline'
import CreatorGitHubPanel from './CreatorGitHubPanel.vue'
import { authorCall, jobStates, type AuthorJob } from './types'

const props = defineProps<{
  project: string
  projectName: string
  releaseOpen?: boolean
  dirty: boolean
  running: boolean
  version?: string
  pack?: AuthorJob
}>()
const emit = defineEmits<{ git: []; release: []; version: [] }>()
interface ChangedFile {
  path: string
  staged: boolean
  changed: boolean
  conflict: boolean
}
interface GitState {
  repository: boolean
  head?: string
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
const syncOpen = ref(false)
const createOnSync = ref(false)
function openSync() {
  createOnSync.value = true
  syncOpen.value = true
  emit('git')
}
const tagged = computed(() => !!state.value?.tags?.includes('v' + props.version))
const checkLabel = computed(() =>
  props.pack?.stale ? '源码已改变，请重新检查' : props.pack ? jobStates[props.pack.state] : '待检查',
)
const transferring = ref(false)
const busy = ref(false),
  error = ref(''),
  notice = ref('')
const message = defineModel<string>('message', { required: true })
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
    await syncSelection(request)
  } catch (cause) {
    if (request === generation) error.value = diagnose(cause)
  } finally {
    refreshing = false
  }
}
async function syncSelection(request: number) {
  if (props.releaseOpen) return
  const current = selection.value
  const group =
    groups.value.find(g => g.staged === current?.staged && g.files.some(f => f.path === current.path)) ??
    groups.value.find(g => g.files.length)
  if (!group) {
    selection.value = undefined
    difference.value = undefined
    return
  }
  const file = group.files.find(f => f.path === current?.path) ?? group.files[0]!
  await showDiff(file.path, group.staged, request)
}
watch(
  () => props.releaseOpen,
  () => {
    notice.value = ''
    void refresh()
  },
)
async function showDiff(path: string, staged: boolean, request = ++generation) {
  const changed = selection.value?.path !== path || selection.value.staged !== staged
  if (changed) difference.value = undefined
  selection.value = { path, staged }
  const row = state.value?.files?.find(row => row.path === path && (staged ? row.staged : row.changed || row.conflict))
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
    await syncSelection(generation)
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
  <section class="git-workspace" :aria-label="releaseOpen ? '发布新版本' : 'Git 版本管理'">
    <div v-if="error" class="feedback error" role="alert">{{ error }}</div>
    <div v-if="notice" class="feedback" role="status">{{ notice }}</div>
    <div v-if="dirty" class="feedback" role="status">请回到内容编辑保存草稿，再提交或发布。</div>
    <div v-if="!state && !error" class="empty" role="status">正在读取仓库…</div>

    <template v-if="state && !releaseOpen">
      <header class="repo-bar">
        <div class="repo-title">
          <ArrowsRightLeftIcon aria-hidden="true" />
          <h1>{{ state.repository ? (state.detached ? '分离的 HEAD' : state.branch) : '本地仓库' }}</h1>
        </div>
        <span v-if="state.repository" class="muted">{{
          state.upstream ? state.upstream + ' · 待推送 ' + state.ahead + ' · 待拉取 ' + state.behind : '未跟踪远端分支'
        }}</span>
        <div class="actions sync">
          <button :aria-expanded="syncOpen" @click="syncOpen ? (syncOpen = false) : openSync()">GitHub 同步</button>
          <button v-if="state.repository && !syncOpen && !state.hasRemote" :disabled="busy" @click="run('bind')">
            绑定远端
          </button>
          <template v-else-if="state.repository && !syncOpen">
            <button :disabled="busy" @click="run('fetch')">获取更新</button>
            <button :disabled="busy || dirty || running || !!state.files?.length" @click="run('pull')">拉取</button>
            <button :disabled="busy" @click="run('push')">推送分支</button>
          </template>
          <button v-if="!syncOpen && state.hasRemote && tagged" :disabled="busy || dirty" @click="run('push-tag')">
            推送版本标签 v{{ version }}
          </button>
          <button v-if="transferring" @click="authorCall({ action: 'git-cancel', id: project })">取消传输</button>
        </div>
      </header>
      <div v-if="syncOpen" class="sync-panel">
        <CreatorGitHubPanel
          mode="sync"
          :create-on-sync="createOnSync"
          @sync-started="createOnSync = false"
          :project-name="projectName"
          :has-commit="!!state.head"
          :project="project"
          :dirty="dirty"
          :running="running"
          :has-changes="!!state.files?.length"
          :has-remote="state.hasRemote"
          :tag="tagged ? 'v' + version : undefined"
          @bound="refresh"
        />
      </div>
      <div v-if="!state.repository && !syncOpen" class="empty">
        <ArrowsRightLeftIcon aria-hidden="true" />
        <h2>项目尚未加入版本管理</h2>
        <button :disabled="busy" @click="run('init')">初始化 Git 仓库</button>
      </div>
      <div v-if="state.repository" class="changes-layout">
        <aside class="changes" aria-label="工作区更改">
          <header class="pane-heading">
            <h2>文件更改</h2>
            <span>{{ state.files?.length ?? 0 }}</span>
          </header>
          <div class="files">
            <section v-for="group in groups.filter(group => group.files.length)" :key="group.title">
              <div class="group-heading">
                <strong>{{ group.title }} · {{ group.files.length }}</strong>
                <button
                  v-if="group.title === '未暂存' && group.files.length > 1"
                  :disabled="busy || dirty"
                  @click="run('stage-files', { files: group.files.map(row => row.path) })"
                >
                  全部暂存
                </button>
              </div>
              <p v-if="group.title === '冲突'" class="error">请在外部编辑器解决冲突并标记为已解决。</p>
              <ul>
                <li
                  v-for="file in group.files"
                  :key="file.path"
                  :class="{ selected: selection?.path === file.path && selection.staged === group.staged }"
                >
                  <button
                    class="file"
                    :disabled="busy"
                    :aria-label="file.path"
                    :title="file.path"
                    :aria-pressed="selection?.path === file.path && selection.staged === group.staged"
                    @click="showDiff(file.path, group.staged)"
                  >
                    <DocumentTextIcon aria-hidden="true" /><span
                      ><b>{{ file.path.split('/').pop() }}</b
                      ><small v-if="file.path.includes('/')">{{
                        file.path.slice(0, file.path.lastIndexOf('/'))
                      }}</small></span
                    >
                  </button>
                  <button
                    v-if="!file.conflict"
                    class="stage"
                    :disabled="busy || dirty"
                    @click="run(group.staged ? 'unstage' : 'stage', { file: file.path })"
                  >
                    {{ group.staged ? '取消暂存' : '暂存' }}
                  </button>
                </li>
              </ul>
            </section>
          </div>
          <form @submit.prevent="run('commit', { message })">
            <label for="author-commit">提交说明</label>
            <textarea id="author-commit" v-model="message" rows="2" maxlength="4000" />
            <button
              class="primary"
              :disabled="busy || dirty || !message.trim() || !groups[2]?.files.length || !!groups[0]?.files.length"
            >
              提交暂存修改
            </button>
          </form>
        </aside>
        <section class="diff-pane" aria-label="文件差异">
          <template v-if="selection">
            <header class="pane-heading">
              <DocumentTextIcon aria-hidden="true" />
              <h2>{{ selection.path }}</h2>
            </header>
            <div class="diff">
              <DiffView
                v-if="diffData"
                :key="selection.path + selection.staged + difference?.patch"
                :data="diffData"
                :diff-view-mode="DiffModeEnum.Unified"
                :diff-view-wrap="true"
                :diff-view-highlight="false"
              />
              <pre v-else-if="difference">{{ difference.text ?? difference.patch }}</pre>
            </div>
          </template>
          <div v-else class="empty">
            <CheckCircleIcon aria-hidden="true" />
            <h2>工作区干净</h2>
          </div>
        </section>
      </div>
    </template>

    <div v-if="state && releaseOpen" class="release-scroll">
      <div class="release-page">
        <header class="release-heading">
          <h1>发布新版本</h1>
          <span class="version">v{{ version }}</span>
        </header>
        <div class="release-layout">
          <div class="release-sections">
            <section class="release-section">
              <ArchiveBoxIcon aria-hidden="true" />
              <div>
                <h2>本地发行检查</h2>
                <p role="status" :class="{ passed: checkedRelease }">{{ checkLabel }}</p>
                <p v-for="(item, index) in pack?.diagnostics" :key="index" class="error" role="alert">
                  {{ item.message }}
                </p>
                <div class="actions">
                  <button
                    :class="{ primary: !checkedRelease }"
                    :disabled="busy || dirty || running"
                    @click="emit('release')"
                  >
                    {{ checkedRelease ? '重新检查发行包' : '检查并生成发行包' }}
                  </button>
                  <button :disabled="busy || dirty || running" @click="emit('version')">更改发行版本</button>
                  <button :disabled="busy || dirty || running" @click="run('lock')">更新 npm 锁文件</button>
                </div>
              </div>
            </section>
            <section class="release-section">
              <TagIcon aria-hidden="true" />
              <div>
                <h2>版本标签</h2>
                <p>
                  {{
                    !state.repository
                      ? '尚未初始化 Git 仓库'
                      : state.files?.length
                        ? '待提交的文件 · ' + state.files.length
                        : tagged
                          ? '已创建 v' + version
                          : '本地分支 · ' + state.branch
                  }}
                </p>
                <div class="actions">
                  <button v-if="!state.repository || state.files?.length" @click="emit('git')">
                    {{ state.repository ? '查看并提交更改' : '打开版本管理' }}
                  </button>
                  <button
                    v-else-if="!tagged"
                    :class="{ primary: checkedRelease }"
                    :disabled="!checkedRelease || busy || dirty || running"
                    @click="run('tag', { jobId: pack?.jobId })"
                  >
                    创建版本标签 v{{ version }}
                  </button>
                  <button v-if="tagged" @click="openSync">同步版本标签</button>
                </div>
              </div>
            </section>
            <section class="release-section">
              <CloudArrowUpIcon aria-hidden="true" />
              <div>
                <h2>GitHub 发行</h2>
                <CreatorGitHubPanel
                  v-if="state.repository"
                  mode="release"
                  @sync="openSync"
                  :project="project"
                  :dirty="dirty"
                  :has-remote="state.hasRemote"
                  :pack="pack"
                  @bound="refresh"
                />
                <button v-else @click="openSync">GitHub 同步</button>
              </div>
            </section>
          </div>
          <aside class="artifact" aria-label="发行归档">
            <header>
              <ArchiveBoxIcon aria-hidden="true" />
              <h2>发行归档</h2>
            </header>
            <template v-if="checkedRelease && pack?.result">
              <h3>{{ pack.result.filename }}</h3>
              <details v-if="pack.result.integrity">
                <summary>SHA-512 校验值</summary>
                <code>{{ pack.result.integrity }}</code>
              </details>
              <details v-if="pack.result.files" open>
                <summary>归档文件 · {{ pack.result.files.length }}</summary>
                <ul>
                  <li v-for="file in pack.result.files" :key="file">{{ file }}</li>
                </ul>
              </details>
            </template>
            <p v-else class="muted">{{ pack?.stale ? '重新检查后更新归档' : '等待发行检查通过' }}</p>
          </aside>
        </div>
      </div>
    </div>
  </section>
</template>
<style scoped>
.git-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--author-text);
  background: var(--author-panel);
}
svg {
  width: 18px;
  height: 18px;
  flex: none;
}
h1,
h2,
h3,
p,
ul {
  margin: 0;
}
h1 {
  font-size: 21px;
  font-weight: 650;
}
h2 {
  font-size: 16px;
  font-weight: 650;
}
button,
input,
textarea {
  font: inherit;
}
button {
  background: var(--author-panel);
  color: inherit;
  padding: 7px 12px;
  border: 1px solid var(--author-border);
  border-radius: 6px;
  cursor: pointer;
}
button:enabled:hover {
  border-color: var(--author-accent);
  color: var(--author-accent);
}
button.primary {
  background: var(--author-accent);
  border-color: var(--author-accent);
  color: var(--author-on-accent);
}
button.primary:enabled:hover {
  background: var(--author-accent-hover);
  color: var(--author-on-accent);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.actions,
.repo-bar,
.repo-title,
.pane-heading,
.group-heading,
.artifact header,
.release-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}
.actions,
.repo-bar {
  flex-wrap: wrap;
}
.repo-bar {
  padding: 16px 24px;
  border-bottom: 1px solid var(--author-border);
}
.repo-title svg,
.release-section > svg,
.artifact header svg {
  color: var(--author-accent);
}
.sync-panel {
  padding: 14px 24px;
  background: var(--author-bg);
  border-bottom: 1px solid var(--author-border);
  max-height: 40vh;
  overflow: auto;
}
.sync {
  margin-left: auto;
}
.muted,
.files small,
.release-section p {
  color: var(--author-muted);
}
.feedback {
  padding: 8px 20px;
  background: var(--author-soft);
}
.error,
.release-section .error {
  color: var(--author-danger);
  overflow-wrap: anywhere;
}
.changes-layout {
  display: grid;
  grid-template-columns: clamp(260px, 27%, 380px) minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}
.changes,
.diff-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.changes {
  border-right: 1px solid var(--author-border);
  background: var(--author-bg);
}
.pane-heading {
  padding: 12px 18px;
  min-height: 48px;
  border-bottom: 1px solid var(--author-border);
}
.pane-heading h2 {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.pane-heading span {
  margin-left: auto;
  color: var(--author-muted);
  font-variant-numeric: tabular-nums;
}
.files,
.diff {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.group-heading {
  justify-content: space-between;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--author-muted);
}
.group-heading button,
.stage {
  font-size: 12px;
  padding: 3px 7px;
}
ul {
  list-style: none;
  padding: 0;
}
.files li {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px 2px 12px;
  border-left: 3px solid transparent;
}
.files li.selected {
  background: var(--author-soft);
  border-color: var(--author-accent);
}
.file {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  text-align: left;
  background: transparent;
  padding: 6px 2px;
}
.file span {
  display: grid;
  min-width: 0;
}
.file small,
.file b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file b {
  font-weight: 550;
}
form {
  display: grid;
  gap: 8px;
  padding: 15px;
  border-top: 1px solid var(--author-border);
}
form label {
  font-weight: 600;
}
textarea {
  resize: vertical;
  background: var(--author-panel);
  color: inherit;
  border: 1px solid var(--author-border);
  border-radius: 6px;
  padding: 8px;
}
.diff pre {
  margin: 0;
  padding: 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
  color: var(--author-muted);
}
.empty svg {
  width: 32px;
  height: 32px;
}
.release-scroll {
  flex: 1;
  overflow: auto;
  background: var(--author-bg);
}
.release-page {
  max-width: 1180px;
  margin: auto;
  padding: clamp(16px, 3vw, 38px);
}
.release-heading {
  margin-bottom: 22px;
}
.release-heading h1 {
  font-size: 26px;
}
.version {
  font:
    600 13px ui-monospace,
    monospace;
  color: var(--author-accent);
  padding: 4px 8px;
  border: 1px solid var(--author-border);
  border-radius: 5px;
}
.release-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr);
  align-items: start;
  gap: 20px;
}
.release-sections,
.artifact {
  background: var(--author-panel);
  border: 1px solid var(--author-border);
  border-radius: 10px;
}
.release-section {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 12px;
  padding: 22px;
}
.release-section + .release-section,
.artifact details {
  border-top: 1px solid var(--author-border);
}
.release-section > svg {
  margin-top: 3px;
}
.release-section h2 {
  margin-bottom: 8px;
}
.release-section p {
  margin-bottom: 12px;
}
.release-section .passed {
  color: var(--el-color-success-dark-2);
}
.artifact {
  padding: 20px;
  overflow-wrap: anywhere;
}
.artifact h3 {
  font:
    600 14px ui-monospace,
    monospace;
  margin: 14px 0;
}
.artifact details,
.artifact p {
  padding-top: 10px;
  margin-top: 10px;
}
.artifact summary {
  cursor: pointer;
}
.artifact ul,
.artifact code {
  display: block;
  margin-top: 8px;
  font:
    12px/1.9 ui-monospace,
    monospace;
}
@media (max-width: 760px) {
  .git-workspace {
    overflow: auto;
  }
  .changes-layout {
    display: flex;
    flex-direction: column;
    min-height: auto;
  }
  .changes {
    border-right: 0;
  }
  .files {
    max-height: 28vh;
    flex: auto;
  }
  .diff-pane {
    min-height: 180px;
    flex: 1 0 auto;
  }
  .release-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .group-heading,
  .pane-heading {
    padding-block: 6px;
  }
}
</style>
