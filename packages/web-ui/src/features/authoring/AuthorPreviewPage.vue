<script setup lang="ts">
import { ElButton, ElForm, ElFormItem, ElInput, ElOption, ElSelect, ElTag, type InputInstance } from 'element-plus'
import { confirmAction } from '@/utils/confirmAction'
import BattleOptionsEditor from '@/components/battle/BattleOptionsEditor.vue'
import { battleOptions, createBattleConfiguration } from '@/services/battleConfiguration'
import { DEFAULT_TIMER_CONFIG } from '@arcadia-eternity/const'
import BattleLoading from '@/components/battle/BattleLoading.vue'
import TeamEditor from '@/components/team/TeamEditor.vue'
import TeamLibrarySelect from '@/components/team/TeamLibrarySelect.vue'
import type { DebugEnvironment } from './debugEnvironment'
import { createProjectTeamLibrary } from './projectTeamLibrary'
import type { TeamEditorDelegate } from '@/components/team/delegate'
import '@/assets/battle-theme.css'
import { onMounted, onBeforeUnmount, ref, shallowRef, computed, watch, nextTick } from 'vue'
import { isNavigationFailure, useRoute, useRouter } from 'vue-router'
import type { PlayerSchemaType } from '@arcadia-eternity/schema'
import { useBattleStore } from '@/stores/battle'
import { useGameDataStore } from '@/stores/gameData'
import { connectAuthorPreview, loadAuthorPreviewSetup, configureAuthorPreview } from '@/services/authorPreview'
import { validateBasicTeam } from '@/utils/basicTeamValidation'
import { createPreviewPet } from './previewPet'
import { createBrowserTeamStorage } from './browserTeamStorage'
import type { IBattleSystem } from '@arcadia-eternity/interface'

const route = useRoute(),
  router = useRouter(),
  battle = useBattleStore(),
  data = useGameDataStore()
const endpoint = typeof route.query.endpoint === 'string' ? route.query.endpoint : ''
const error = ref(''),
  loading = ref(true),
  busy = ref(false),
  active = ref(false),
  side = ref(0)
const players = ref<PlayerSchemaType[]>([])
const delegates = shallowRef<TeamEditorDelegate[]>([])

const environments = ref<DebugEnvironment[]>([])
const environmentId = ref('default')
const preparedEnvironmentId = ref('default')
const preparedEnvironmentInstallation = ref<string | null>(null)
const sourceMappingChanged = ref(false)
const setupWarning = ref('')
const environmentReady = computed(
  () =>
    environmentId.value === preparedEnvironmentId.value &&
    !sourceMappingChanged.value &&
    (!window.arcadiaAuthorPreview ||
      (environments.value.find(item => item.id === environmentId.value)?.version ?? null) ===
        preparedEnvironmentInstallation.value),
)
const battleConfig = ref(createBattleConfiguration())
const timerConfig = ref({ ...DEFAULT_TIMER_CONFIG, enabled: false })
const environmentExpanded = ref(false)
watch(environmentReady, ready => {
  if (!ready) environmentExpanded.value = true
})
const managingEnvironment = ref(false)
const moreActions = ref(false)
const operation = ref('')
const renameInput = ref<InputInstance>()
const environmentDraft = ref<DebugEnvironment>({
  schemaVersion: 1,
  id: '',
  name: '',
  packages: {},
  sources: [],
  version: null,
})
const environmentPackages = ref<{ name: string; version: string }[]>([])
let environmentRead = 0
async function loadEnvironments() {
  if (!window.arcadiaAuthorPreview) return
  const request = ++environmentRead
  const latest = await window.arcadiaAuthorPreview.environment('list')
  if (!disposed && request === environmentRead) environments.value = latest
}
let refreshPending = false
let refreshing = false
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let stopProjectChanges: (() => void) | undefined
function refreshProject() {
  if (disposed || !window.arcadiaAuthorPreview) return
  refreshPending = true
  if (refreshTimer || refreshing || busy.value || loading.value) return
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    void drainProjectChanges()
  }, 30)
}
async function drainProjectChanges() {
  if (disposed || busy.value || loading.value || refreshing || !refreshPending) return
  refreshPending = false
  refreshing = true
  try {
    await Promise.all([loadEnvironments(), library.value?.refresh()])
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    refreshing = false
    if (refreshPending) refreshProject()
  }
}
watch([busy, loading], () => {
  if (refreshPending) refreshProject()
})
const environmentConflict = computed(
  () =>
    managingEnvironment.value &&
    (environments.value.find(item => item.id === environmentDraft.value.id)?.version ?? null) !==
      environmentDraft.value.version,
)

function editEnvironment(create = false) {
  const current = environments.value.find(item => item.id === environmentId.value)
  environmentDraft.value =
    !create && current?.id !== 'default' && current
      ? JSON.parse(JSON.stringify(current))
      : {
          schemaVersion: 1,
          id: `env-${Date.now().toString(36)}`,
          name: '组合测试环境',
          packages: {},
          sources: [],
          version: null,
        }
  environmentPackages.value = Object.entries(environmentDraft.value.packages).map(([name, version]) => ({
    name,
    version,
  }))
  managingEnvironment.value = true
}
async function saveEnvironment() {
  if (busy.value || environmentConflict.value) return
  operation.value = '正在保存环境…'
  busy.value = true
  error.value = ''
  try {
    const rows = environmentPackages.value.map(row => [row.name.trim(), row.version.trim()] as const)
    if (rows.some(([name, version]) => !name || !version)) throw new Error('请填写包名和版本范围')
    const packages = Object.fromEntries(rows)
    if (Object.keys(packages).length !== rows.length) throw new Error('额外包重复')
    const { version, ...document } = environmentDraft.value
    await window.arcadiaAuthorPreview!.environment(
      'save',
      JSON.parse(JSON.stringify({ document: { ...document, packages }, expectedVersion: version })),
    )
    await loadEnvironments()
    environmentId.value = document.id
    managingEnvironment.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
async function addSource() {
  try {
    const source = await window.arcadiaAuthorPreview!.environment('add-source')
    if (source?.changed) sourceMappingChanged.value = true
    if (source && !environmentDraft.value.sources.includes(source.name))
      environmentDraft.value.sources.push(source.name)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
async function prepareEnvironment() {
  if (busy.value) return
  operation.value = '正在准备环境…'
  error.value = ''
  busy.value = true
  try {
    await library.value?.flush()
    await window.arcadiaAuthorPreview!.environment('prepare', { environmentId: environmentId.value })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    busy.value = false
  }
}
const library = shallowRef<Awaited<ReturnType<typeof createProjectTeamLibrary>>>()
const currentTeam = computed(() => library.value?.current(side.value))
const environmentName = computed(
  () => environments.value.find(item => item.id === environmentId.value)?.name ?? '当前测试环境',
)
const saveStatus = computed(() => {
  if (!library.value?.files) return '修改自动暂存于此浏览器'
  if (currentTeam.value?.conflict) return '项目文件已在外部修改，草稿保留；请重新载入或复制为新队伍'
  if (currentTeam.value?.dirty) return currentTeam.value.version ? '有修改未保存到项目' : '新队伍 · 尚未保存到项目'
  return '已保存到项目'
})
watch(
  () => [side.value, library.value?.selected.value[side.value]],
  () => {
    moreActions.value = false
    renameDraft.value = undefined
  },
  { flush: 'sync' },
)
function createTeam(duplicate = false) {
  library.value?.create(side.value, duplicate)
  moreActions.value = false
  renameTeam()
}
let disposed = false,
  transferred = false,
  cleanup: (() => Promise<void>) | undefined
let stopPlayers: (() => void) | undefined
let restoreSetup: (() => void) | undefined
let ownedSystem: IBattleSystem | undefined
const problems = computed(() =>
  players.value.flatMap((player, index) =>
    [...(!player.name.trim() ? ['请输入训练师名称'] : []), ...validateBasicTeam(player.team, data)].map(
      message => `${index === 0 ? '我方' : '对方'}：${message}`,
    ),
  ),
)
async function teamAction(action: 'save' | 'remove' | 'reload') {
  if (!library.value?.files || busy.value) return
  const teamId = library.value.selected.value[side.value]
  if (action === 'remove' && !(await confirmAction('删除队伍', '此队伍及其草稿将被删除。'))) return
  if (action === 'reload' && !(await confirmAction('重新载入项目文件', '当前队伍尚未保存的修改将丢失。'))) return
  if (disposed || busy.value || library.value?.selected.value[side.value] !== teamId) return
  busy.value = true
  operation.value = action === 'save' ? '正在保存队伍…' : '正在更新队伍…'
  moreActions.value = false
  error.value = ''
  try {
    await library.value.files[action](side.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
const renameDraft = ref<{ id: string; name: string; version: string | null }>()
const renameConflict = computed(() => {
  if (!renameDraft.value) return false
  const entry = library.value?.entries.value.find(entry => entry.id === renameDraft.value!.id)
  return !entry || entry.conflict || entry.version !== renameDraft.value.version
})
function renameTeam() {
  const entry = library.value?.current(side.value)
  if (entry) {
    renameDraft.value = { id: entry.id, name: entry.name, version: entry.version }
    moreActions.value = false
    void nextTick(() => {
      renameInput.value?.focus()
      renameInput.value?.select()
    })
  }
}
function saveTeamName() {
  if (!renameDraft.value || !library.value || renameConflict.value) return
  try {
    library.value.rename(renameDraft.value.id, renameDraft.value.name)
    renameDraft.value = undefined
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
function windowReturn() {
  if (window.arcadiaAuthorPreview) window.arcadiaAuthorPreview.returnToEditor()
  else void router.push('/creation')
}
async function discard() {
  await cleanup?.()
  if (ownedSystem && battle.battleInterface === ownedSystem) await battle.resetBattleWithoutSurrender()
}
async function launch(reconfigure = false) {
  if (busy.value || (reconfigure && !environmentReady.value)) return
  if (reconfigure && active.value && !(await confirmAction('重新开始', '当前测试对局将结束。'))) return
  if (disposed || busy.value) return
  operation.value = '正在进入对战…'
  busy.value = true
  error.value = ''
  try {
    if (reconfigure) {
      await loadEnvironments()
      await library.value?.refresh()
      if (disposed) return
      if (!environmentReady.value) throw new Error('所选环境配置已改变，请重新准备后再开始对战。')
      if (problems.value.length) throw new Error(problems.value.join('；'))
    }
    if (reconfigure)
      await configureAuthorPreview(endpoint, players.value, battleOptions(battleConfig.value, timerConfig.value))
    const prepared = await connectAuthorPreview(endpoint, cause => {
      battle.errorMessage = cause.message
    })
    ownedSystem = prepared.system
    const restore = data.useLocalBattleContent(prepared.content, prepared.rules)
    const stop = prepared.system.cleanup.bind(prepared.system)
    prepared.system.cleanup = async () => {
      restore()
      await stop()
    }
    cleanup = prepared.system.cleanup
    if (disposed) {
      await cleanup()
      return
    }
    const state = await prepared.system.getState(undefined, true)
    const player = state.players[0]?.id
    if (!player) throw new Error('试玩队伍为空，请检查项目默认配置。')
    await battle.initBattle(prepared.system, player, () => !disposed || transferred)
    if (battle.isBattleEnd) battle.victor = prepared.outcome?.winner ?? null
    if (disposed) {
      await cleanup()
      return
    }
    transferred = true
    const result = await router.replace({ name: 'Battle', query: { authorPreview: endpoint } })
    if (isNavigationFailure(result)) {
      transferred = false
      throw new Error('无法进入战斗，请重试。')
    }
  } catch (cause) {
    transferred = false
    await discard()
    if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  window.addEventListener('focus', refreshProject)
  stopProjectChanges = window.arcadiaAuthorPreview?.onChanged?.(change => {
    // Saved source changes affect the next launch, never the currently running match.
    if (!change.file || (!change.file.startsWith('debug/teams/') && !change.file.startsWith('debug/environments/')))
      sourceMappingChanged.value = true
    refreshProject()
  })
  try {
    if (!window.arcadiaAuthorPreview) await data.whenReady()
    // Refreshing a running battle reconnects directly; opening a debug window starts at setup.
    if (route.query.resume === 'true') {
      await launch()
      return
    }
    const setup = await loadAuthorPreviewSetup(endpoint)
    if (disposed) return
    restoreSetup = data.useLocalBattleContent(setup.content, setup.rules)
    await loadEnvironments()
    environmentId.value = setup.candidate.environmentId
    preparedEnvironmentId.value = environmentId.value
    preparedEnvironmentInstallation.value = setup.candidate.environmentConfigVersion
    setupWarning.value = setup.warning ?? ''
    active.value = setup.active
    const storage = window.arcadiaAuthorPreview
      ? window.arcadiaAuthorPreview.teams
      : createBrowserTeamStorage(setup.teams, setup.draftKey)
    const project = await createProjectTeamLibrary(storage, setup.players, () =>
      createPreviewPet(data.speciesList[0], data.rules),
    )
    if (disposed) {
      project.dispose()
      return
    }
    library.value = project
    stopPlayers = watch(
      project.players,
      value => {
        players.value = value
      },
      { immediate: true, deep: true },
    )
    delegates.value = project.editors
    loading.value = false
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause)
  }
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('focus', refreshProject)
  stopProjectChanges?.()
  if (refreshTimer) clearTimeout(refreshTimer)
  stopPlayers?.()
  library.value?.dispose()
  restoreSetup?.()
  if (!transferred) void discard()
})
</script>

<template>
  <main v-if="loading" class="preview-loading battle-theme">
    <BattleLoading
      :tasks="[{ id: 'candidate', label: '载入测试环境', state: error ? 'error' : 'loading' }]"
      :progress="0"
      :error="error || null"
      @retry="router.go(0)"
      @exit="windowReturn"
    />
  </main>
  <main v-else class="debug-setup" :aria-busy="busy">
    <header class="debug-controls">
      <div>
        <div class="title-line">
          <h1>测试队伍</h1>
          <span class="project-badge">项目专用</span>
        </div>
        <p>调整队伍即可开局，修改自动暂存。</p>
      </div>
      <div class="debug-actions">
        <span class="launch-hint" role="status">{{
          busy ? operation : !environmentReady ? '请先准备所选环境' : problems.length ? '请完善双方队伍' : '双方已就绪'
        }}</span>
        <button v-if="active" :disabled="busy" @click="launch()">继续当前对局</button>
        <button class="start" :disabled="busy || !!problems.length || !environmentReady" @click="launch(true)">
          {{ active ? '重新开始' : '开始对战' }} <span aria-hidden="true">→</span>
        </button>
      </div>
    </header>
    <div class="setup-body">
      <p v-if="error || library?.error.value" class="notice error" role="alert">{{ error || library?.error.value }}</p>
      <p v-if="setupWarning" class="notice warning" role="status">{{ setupWarning }}</p>
      <div class="configuration-bar">
        <button
          v-if="environments.length"
          class="environment-toggle"
          :aria-expanded="environmentExpanded"
          aria-controls="environment-panel"
          :disabled="busy"
          @click="environmentExpanded = !environmentExpanded"
        >
          <span class="status-dot" :class="{ pending: !environmentReady }" aria-hidden="true" />
          {{ environmentName }} <span class="muted">{{ environmentReady ? '已准备' : '待准备' }}</span>
          <span aria-hidden="true">{{ environmentExpanded ? '⌃' : '⌄' }}</span>
        </button>
        <span v-else class="environment-toggle"
          ><span class="status-dot" aria-hidden="true" />当前测试环境 · 已准备</span
        >
        <details class="battle-options">
          <summary>对战参数</summary>
          <div class="options-panel">
            <BattleOptionsEditor
              v-model:battle-config="battleConfig"
              v-model:timer-config="timerConfig"
              :environment-timer="!!data.rules?.mechanics?.timer"
              :environment-selection="!!data.rules?.mechanics?.teamSelection"
            />
          </div>
        </details>
      </div>
      <section
        v-if="environments.length && environmentExpanded"
        id="environment-panel"
        class="environment-panel"
        aria-label="环境设置"
      >
        <div class="environment-row">
          <ElSelect v-model="environmentId" aria-label="对战环境" filterable :disabled="busy">
            <ElOption v-for="item in environments" :key="item.id" :value="item.id" :label="item.name" />
          </ElSelect>
          <ElButton :disabled="busy || environmentId === 'default'" @click="editEnvironment()">管理环境</ElButton>
          <ElButton :disabled="busy" @click="editEnvironment(true)">新建环境</ElButton>
          <ElButton :disabled="busy" :type="environmentReady ? 'default' : 'primary'" @click="prepareEnvironment"
            >准备所选环境</ElButton
          >
        </div>
        <ElForm
          v-if="managingEnvironment"
          class="environment-form"
          label-position="top"
          :disabled="busy"
          @submit.prevent="saveEnvironment"
        >
          <p v-if="environmentConflict" class="notice warning" role="status">
            环境文件已在外部修改，当前输入保留。请取消后重新打开环境，核对最新配置。
          </p>
          <ElFormItem label="环境名称"><ElInput v-model="environmentDraft.name" required maxlength="80" /></ElFormItem>
          <div v-for="(row, index) in environmentPackages" :key="index" class="environment-package-row">
            <ElFormItem label="包名"><ElInput v-model="row.name" required placeholder="@author/package" /></ElFormItem>
            <ElFormItem label="版本范围"><ElInput v-model="row.version" required placeholder="^1.0.0" /></ElFormItem>
            <ElButton @click="environmentPackages.splice(index, 1)">移除包</ElButton>
          </div>
          <div v-if="environmentDraft.sources.length" class="source-list">
            <ElTag
              v-for="name in environmentDraft.sources"
              :key="name"
              :closable="!busy"
              @close="environmentDraft.sources = environmentDraft.sources.filter(item => item !== name)"
              >{{ name }}</ElTag
            >
          </div>
          <div class="debug-actions">
            <ElButton @click="environmentPackages.push({ name: '', version: '' })">添加 npm 包</ElButton>
            <ElButton @click="addSource">添加本机源码包</ElButton>
            <ElButton native-type="submit" type="primary" :disabled="environmentConflict">保存环境配置</ElButton>
            <ElButton @click="managingEnvironment = false">取消</ElButton>
          </div>
        </ElForm>
      </section>
      <div v-if="library" class="matchup" aria-label="测试双方">
        <section
          v-for="(selector, index) in library.selectors"
          :key="index"
          class="side-card"
          :class="{ selected: side === index }"
        >
          <div class="side-heading">
            <strong
              >{{ index === 0 ? '我方' : '对方' }}
              <span class="side-role">{{ index === 0 ? '手动操作' : 'AI 控制' }}</span></strong
            ><button
              :aria-pressed="side === index"
              :aria-label="index === 0 ? '编辑我方队伍' : '编辑对方队伍'"
              :disabled="busy"
              @click="side = index"
            >
              {{ side === index ? '正在编辑' : '编辑队伍' }}
            </button>
          </div>
          <div class="side-selection" @focusin="side = index">
            <TeamLibrarySelect :delegate="selector" :disabled="busy" :label="index === 0 ? '我方队伍' : '对方队伍'" />
          </div>
        </section>
      </div>
      <p v-if="library && library.selected.value[0] === library.selected.value[1]" class="shared-team-note">
        双方使用同一套队伍，编辑会同步应用到双方。
      </p>
      <ul v-if="problems.length" class="notice error" role="alert">
        <li v-for="problem in problems" :key="problem">{{ problem }}</li>
      </ul>
      <section v-if="library" class="editor-toolbar" aria-label="当前队伍操作">
        <div class="team-identity">
          <h2>{{ currentTeam?.name }}</h2>
          <span class="save-status" :class="{ unsaved: currentTeam?.dirty }" role="status">{{ saveStatus }}</span>
        </div>
        <div class="debug-actions">
          <button
            v-if="library.files"
            class="save-button"
            :disabled="busy || !currentTeam?.dirty"
            @click="teamAction('save')"
          >
            保存队伍
          </button>
          <button :disabled="busy" @click="createTeam()">新建队伍</button>
          <button :disabled="busy" @click="createTeam(true)">复制当前队伍</button>
          <button
            :disabled="busy"
            :aria-expanded="moreActions"
            aria-controls="team-more-actions"
            @click="moreActions = !moreActions"
          >
            更多操作
          </button>
        </div>
      </section>
      <div v-if="moreActions && library" id="team-more-actions" class="more-actions">
        <label
          >训练师名称<ElInput v-model="library.names.value[side]" :disabled="busy" @input="library.persist"
        /></label>
        <button :disabled="busy" @click="renameTeam">重命名</button>
        <button v-if="library.files" :disabled="busy || !currentTeam?.version" @click="teamAction('reload')">
          重新载入项目文件
        </button>
        <button
          v-if="library.files"
          class="danger"
          :disabled="busy || library.entries.value.length <= 1"
          @click="teamAction('remove')"
        >
          删除队伍
        </button>
      </div>
      <form
        v-if="renameDraft"
        class="rename-form"
        @submit.prevent="saveTeamName"
        @keydown.esc="renameDraft = undefined"
      >
        <label
          >队伍名称<ElInput ref="renameInput" v-model="renameDraft.name" required maxlength="80" :disabled="busy"
        /></label>
        <button type="submit" class="save-button" :disabled="busy || renameConflict">确认名称</button>
        <button type="button" @click="renameDraft = undefined">取消</button>
        <p v-if="renameConflict" role="status" class="notice warning">
          队伍文件已在外部修改，输入的名称已保留。请取消后重新打开重命名，核对最新队伍。
        </p>
      </form>
      <p v-if="!library?.files" class="browser-note">浏览器草稿仅保存在本机。要写入项目，请使用本地客户端。</p>
    </div>
    <TeamEditor
      v-if="delegates[side]"
      :key="`${side}:${library?.selected.value[side] ?? side}`"
      :delegate="delegates[side]!"
      compact
    />
  </main>
</template>

<style scoped>
.debug-setup {
  --preview-border: #dce3ec;
  --preview-muted: #64748b;
  --preview-accent: #2467c8;
  min-height: 100%;
  background: #f9fafb;
  color: #243042;
  font-size: 14px;
}
.preview-loading {
  position: relative;
  height: 100%;
  min-height: 30rem;
  background: #09131f;
}
.debug-controls {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--preview-border);
  background: #fff;
}
.title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.debug-controls h1 {
  font-size: 20px;
  font-weight: 650;
  margin: 0 0 4px;
}
.debug-controls p,
.muted,
.launch-hint {
  color: var(--preview-muted);
  font-size: 12px;
}
.project-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 3px 7px;
  border-radius: 4px;
  color: #52647b;
  background: #edf2f7;
}
.setup-body {
  max-width: 1280px;
  margin: auto;
  padding: 0 24px;
}
.debug-actions,
.environment-row,
.more-actions,
.rename-form {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.debug-setup button:not(.el-button) {
  cursor: pointer;
  border: 1px solid var(--preview-border);
  border-radius: 7px;
  padding: 7px 12px;
  background: #fff;
  font-size: 13px;
  line-height: 20px;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.debug-setup button:not(.el-button):hover:not(:disabled) {
  background: #edf3fa;
  border-color: #aabed8;
}
.debug-setup button:disabled {
  cursor: default;
  opacity: 0.45;
}
.debug-setup :is(button, input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--preview-accent);
  outline-offset: 3px;
}
.debug-setup button.start {
  background: var(--preview-accent);
  color: white;
  border-color: var(--preview-accent);
}
.debug-setup button.start:hover:not(:disabled) {
  background: #1c56ab;
}
.debug-controls button.start {
  padding: 10px 20px;
  font-weight: 600;
}
.debug-controls button.start span {
  margin-left: 12px;
}
.debug-setup button.save-button {
  color: #1f59a9;
  background: #edf4ff;
  border-color: #bad2f3;
}
.configuration-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
}
.debug-setup .environment-toggle {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 5px 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  text-align: left;
}
.status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2a8a67;
}
.status-dot.pending {
  background: #cc8b20;
}
.battle-options {
  text-align: right;
}
.battle-options summary {
  cursor: pointer;
  padding: 5px;
  font-size: 12px;
  color: var(--preview-muted);
}
.configuration-bar:has(.battle-options[open]) {
  flex-wrap: wrap;
}
.battle-options[open] {
  width: 100%;
  text-align: left;
}
.options-panel {
  margin-top: 12px;
}
.environment-panel {
  padding: 16px;
  margin-bottom: 16px;
  background: #f0f4f8;
  border: 1px solid var(--preview-border);
  border-radius: 10px;
}
.environment-panel p {
  margin-top: 8px;
}
.environment-form {
  margin-top: 16px;
  border-top: 1px solid var(--preview-border);
  padding-top: 16px;
  display: grid;
  gap: 12px;
}
.environment-row > .el-select {
  width: min(100%, 18rem);
}
.environment-package-row,
.source-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: end;
}
.environment-package-row > .el-form-item {
  flex: 1 1 12rem;
  min-width: 0;
}
.environment-form :deep(.el-form-item) {
  margin-bottom: 0;
}
.environment-panel .el-button + .el-button {
  margin-left: 0;
}
.matchup {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.side-card {
  min-width: 0;
  padding: 12px 16px;
  border: 1px solid var(--preview-border);
  border-radius: 10px;
  background: white;
}
.side-card.selected {
  border-color: #6f9edc;
  box-shadow: inset 3px 0 var(--preview-accent);
  background: #f5f9ff;
}
.side-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.side-heading strong {
  font-size: 13px;
}
.side-role {
  color: var(--preview-muted);
  font-size: 11px;
  font-weight: 400;
  margin-left: 6px;
}
.debug-setup .side-heading button {
  padding: 2px 8px;
  font-size: 11px;
}
.side-heading button[aria-pressed='true'] {
  border-color: transparent;
  color: var(--preview-accent);
  background: #e4efff;
}
.side-selection :deep(.team-library-select) {
  width: 100%;
  font-size: 12px;
}
.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 0 4px;
}
.team-identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.team-identity h2 {
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.save-status {
  font-size: 11px;
  color: var(--preview-muted);
}
.save-status.unsaved {
  color: #9c6516;
}
.more-actions,
.rename-form {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--preview-border);
  background: white;
  border-radius: 8px;
}
.debug-setup label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.debug-setup :is(input, select, textarea) {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 7px 9px;
  background: white;
  min-width: 0;
}
.debug-setup .danger {
  color: #b42318;
  margin-left: auto;
}
.notice {
  padding: 10px 14px;
  border-radius: 8px;
  margin: 12px 0;
  font-size: 13px;
}
.error {
  color: #b42318;
  background: #fff0ee;
  border: 1px solid #f5cdc7;
}
.warning {
  color: #8a5b15;
  background: #fff8e9;
  border: 1px solid #f0deaf;
}
.shared-team-note,
.browser-note {
  font-size: 12px;
  color: var(--preview-muted);
  margin: 10px 0 0;
}
@media (max-width: 700px) {
  .debug-controls {
    padding: 12px 16px;
    flex-wrap: wrap;
  }
  .debug-controls > .debug-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .launch-hint {
    margin-right: auto;
  }
  .setup-body {
    padding: 0 16px;
  }
  .matchup {
    grid-template-columns: 1fr;
  }
  .editor-toolbar > .debug-actions {
    width: 100%;
  }
  .environment-row,
  .more-actions,
  .rename-form {
    align-items: stretch;
  }
  .debug-setup label {
    flex-wrap: wrap;
  }
  .debug-setup label :is(input, select) {
    max-width: 100%;
  }
}
</style>
