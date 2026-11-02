<script setup lang="ts">
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
import { onMounted, onBeforeUnmount, ref, shallowRef, computed, watch } from 'vue'
import { isNavigationFailure, useRoute, useRouter } from 'vue-router'
import { PlayerSchema, PetSchema, parseWithErrors, type PlayerSchemaType } from '@arcadia-eternity/schema'
import { Type } from '@sinclair/typebox'
import { useBattleStore } from '@/stores/battle'
import { useGameDataStore } from '@/stores/gameData'
import { connectAuthorPreview, loadAuthorPreviewSetup, configureAuthorPreview } from '@/services/authorPreview'
import { validateBasicTeam } from '@/utils/basicTeamValidation'
import { createPreviewTeamDelegate, createPreviewPet } from './previewTeamDelegate'
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
let defaults: PlayerSchemaType[] = []

const environments = ref<DebugEnvironment[]>([])
const environmentId = ref('default')
const preparedEnvironmentId = ref('default')
const preparedEnvironmentVersion = ref<string | null>(null)
const sourceMappingChanged = ref(false)
const setupWarning = ref('')
const environmentReady = computed(
  () =>
    environmentId.value === preparedEnvironmentId.value &&
    !sourceMappingChanged.value &&
    (environments.value.find(item => item.id === environmentId.value)?.version ?? null) ===
      preparedEnvironmentVersion.value,
)
const battleConfig = ref(createBattleConfiguration())
const timerConfig = ref({ ...DEFAULT_TIMER_CONFIG, enabled: false })
const managingEnvironment = ref(false)
const environmentDraft = ref<DebugEnvironment>({
  schemaVersion: 1,
  id: '',
  name: '',
  packages: {},
  sources: [],
  version: null,
})
const packageText = ref('')
async function loadEnvironments() {
  if (window.arcadiaAuthorPreview?.environment)
    environments.value = await window.arcadiaAuthorPreview.environment('list')
}
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
  packageText.value = Object.entries(environmentDraft.value.packages)
    .map(([name, spec]) => `${name}=${spec}`)
    .join('\n')
  managingEnvironment.value = true
}
async function saveEnvironment() {
  try {
    const packages: Record<string, string> = {}
    for (const line of packageText.value
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)) {
      const index = line.indexOf('=')
      if (index < 1) throw new Error('额外包请每行填写 包名=版本')
      const name = line.slice(0, index).trim()
      if (Object.hasOwn(packages, name)) throw new Error('额外包重复')
      packages[name] = line.slice(index + 1).trim()
    }
    const { version, ...document } = environmentDraft.value
    await window.arcadiaAuthorPreview!.environment!(
      'save',
      JSON.parse(JSON.stringify({ document: { ...document, packages }, expectedVersion: version })),
    )
    await loadEnvironments()
    environmentId.value = document.id
    managingEnvironment.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
async function addSource() {
  try {
    const source = await window.arcadiaAuthorPreview!.environment!('add-source')
    if (source?.changed) sourceMappingChanged.value = true
    if (source && !environmentDraft.value.sources.includes(source.name))
      environmentDraft.value.sources.push(source.name)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
async function prepareEnvironment() {
  busy.value = true
  try {
    await library.value?.flush()
    await window.arcadiaAuthorPreview!.environment!('prepare', { environmentId: environmentId.value })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    busy.value = false
  }
}
const library = shallowRef<Awaited<ReturnType<typeof createProjectTeamLibrary>>>()
const storageKey = 'author-preview-test-teams'
// Empty teams and names are valid editing states; battle admission remains stricter.
const draftPlayerSchema = Type.Object({
  id: PlayerSchema.properties.id,
  name: Type.String(),
  team: Type.Array(PetSchema, { maxItems: 6 }),
})
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
function persist() {
  if (library.value) return
  // Browser-only legacy previews have no project filesystem capabilities.
  if (window.arcadiaAuthorPreview && players.value.length === 2)
    localStorage.setItem(storageKey, JSON.stringify(players.value))
}
watch(players, persist, { deep: true, flush: 'sync' })
function resetTeams() {
  players.value = JSON.parse(JSON.stringify(defaults))
}
async function teamAction(action: 'save' | 'remove' | 'reload') {
  if (!library.value || busy.value) return
  if (action === 'remove' && !window.confirm('删除此队伍及其草稿？')) return
  if (action === 'reload' && !window.confirm('丢弃这套队伍的草稿，重新载入项目文件？')) return
  busy.value = true
  error.value = ''
  try {
    await library.value[action](side.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
function renameTeam() {
  const name = window.prompt('队伍名称', library.value?.current(side.value).name)
  if (name?.trim()) library.value?.rename(side.value, name.trim())
}
function windowReturn() {
  if (window.arcadiaAuthorPreview) window.arcadiaAuthorPreview.returnToEditor()
  else void router.push('/content')
}
async function discard() {
  await cleanup?.()
  if (ownedSystem && battle.battleInterface === ownedSystem) await battle.resetBattleWithoutSurrender()
}
async function launch(reconfigure = false) {
  if (busy.value || (reconfigure && !environmentReady.value)) return
  if (reconfigure && active.value && !window.confirm('重新开始会结束当前测试对局，使用这里的队伍配置。继续吗？')) return
  busy.value = true
  error.value = ''
  try {
    if (reconfigure)
      await configureAuthorPreview(endpoint, players.value, battleOptions(battleConfig.value, timerConfig.value))
    const prepared = await connectAuthorPreview(endpoint, cause => {
      battle.errorMessage = cause.message
    })
    ownedSystem = prepared.system
    const restore = data.useLocalBattleContent(prepared.content)
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
  try {
    if (!window.arcadiaAuthorPreview) await data.whenReady()
    // Refreshing a running battle reconnects directly; opening a debug window starts at setup.
    if (route.query.resume === 'true') {
      await launch()
      return
    }
    const setup = await loadAuthorPreviewSetup(endpoint)
    if (disposed) return
    restoreSetup = data.useLocalBattleContent(setup.content)
    await loadEnvironments()
    environmentId.value = setup.candidate?.environmentId ?? 'default'
    preparedEnvironmentId.value = environmentId.value
    preparedEnvironmentVersion.value = setup.candidate?.environmentConfigVersion ?? null
    setupWarning.value = setup.warning ?? ''
    defaults = setup.players
    active.value = setup.active
    if (window.arcadiaAuthorPreview?.teams) {
      const project = await createProjectTeamLibrary(window.arcadiaAuthorPreview.teams, defaults, () =>
        createPreviewPet(data.speciesList[0]),
      )
      if (disposed) return
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
      return
    }
    let saved: PlayerSchemaType[] | undefined
    if (window.arcadiaAuthorPreview) {
      try {
        const value = JSON.parse(localStorage.getItem(storageKey) || 'null')
        if (Array.isArray(value) && value.length === 2)
          saved = value.map(player => parseWithErrors(draftPlayerSchema, player))
      } catch {
        /* An incomplete draft falls back to the project's defaults. */
      }
    }
    players.value = saved ?? JSON.parse(JSON.stringify(defaults))
    delegates.value = [0, 1].map(index => createPreviewTeamDelegate(players, index, defaults, persist))
    loading.value = false
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause)
  }
})
onBeforeUnmount(() => {
  disposed = true
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
  <main v-else class="debug-setup">
    <header class="debug-controls">
      <div>
        <h1>测试队伍</h1>
        <p>项目测试队伍与个人编队分开。修改自动暂存为本机草稿，保存队伍后才写入项目。</p>
      </div>
      <div class="debug-actions">
        <button v-if="!library" :disabled="busy" @click="resetTeams">恢复项目默认</button>
        <button v-if="active" :disabled="busy" @click="launch()">继续当前对局</button>
        <button class="start" :disabled="busy || !!problems.length || !environmentReady" @click="launch(true)">
          {{ busy ? '正在准备…' : active ? '按当前配置重新开始' : '开始对战' }}
        </button>
      </div>
    </header>
    <p v-if="error || library?.error.value" class="debug-error" role="alert">{{ error || library?.error.value }}</p>
    <p v-if="setupWarning" class="team-sides" role="status">{{ setupWarning }}</p>
    <p v-if="!environmentReady" class="team-sides" role="status">所选环境尚未准备或配置已改变，请先准备所选环境。</p>
    <ul v-if="problems.length" class="debug-error" role="alert">
      <li v-for="problem in problems" :key="problem">{{ problem }}</li>
    </ul>
    <div v-if="environments.length" class="team-sides">
      <label
        >对战环境<select v-model="environmentId">
          <option v-for="item in environments" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select></label
      >
      <button :disabled="busy" @click="editEnvironment()">管理环境</button>
      <button :disabled="busy" @click="editEnvironment(true)">新建环境</button>
      <button :disabled="busy" @click="prepareEnvironment">准备所选环境</button>
      <p>
        已准备：{{
          environments.find(item => item.id === preparedEnvironmentId)?.name
        }}。环境或内容变化需重新准备；队伍修改只需重新开局。
      </p>
    </div>
    <form v-if="managingEnvironment" class="team-sides" @submit.prevent="saveEnvironment">
      <label>环境名称<input v-model="environmentDraft.name" required maxlength="80" /></label>
      <label>额外 npm 包（每行 包名=版本）<textarea v-model="packageText" rows="3" /></label>
      <span v-for="name in environmentDraft.sources" :key="name"
        >{{ name }}
        <button
          type="button"
          @click="environmentDraft.sources = environmentDraft.sources.filter(item => item !== name)"
        >
          移除
        </button></span
      >
      <button type="button" @click="addSource">添加本机源码包</button>
      <button type="submit">保存环境配置</button>
      <button type="button" @click="managingEnvironment = false">关闭</button>
    </form>
    <div v-if="library" class="team-sides">
      <TeamLibrarySelect
        v-for="(selector, index) in library.selectors"
        :key="index"
        :delegate="selector"
        :label="index === 0 ? '我方队伍' : '对方队伍'"
      />
    </div>
    <div v-if="library" class="team-sides">
      <button :disabled="busy" @click="library.create(side)">新建</button>
      <button :disabled="busy" @click="library.create(side, true)">复制当前队伍</button>
      <button :disabled="busy" @click="renameTeam">重命名</button>
      <button :disabled="busy" @click="teamAction('save')">保存队伍</button>
      <button :disabled="busy" @click="teamAction('remove')">删除队伍</button>
      <button :disabled="busy" @click="teamAction('reload')">重新载入项目文件</button>
    </div>
    <details class="battle-options">
      <summary>对战参数</summary>
      <BattleOptionsEditor v-model:battle-config="battleConfig" v-model:timer-config="timerConfig" />
    </details>
    <nav class="team-sides" aria-label="测试双方">
      <button v-for="(player, index) in players" :key="player.id" :aria-pressed="side === index" @click="side = index">
        {{ index === 0 ? '我方' : '对方（AI）' }} · {{ player.team.length }} 只
      </button>
      <label v-if="library">训练师名称<input v-model="library.names.value[side]" @input="library.persist" /></label>
      <label v-else>训练师名称<input v-model="players[side]!.name" /></label>
    </nav>
    <TeamEditor
      v-if="delegates[side]"
      :key="`${side}:${library?.selected.value[side] ?? side}`"
      :delegate="delegates[side]!"
      compact
    />
  </main>
</template>

<style scoped>
.battle-options {
  padding: 14px 24px;
}
.preview-loading {
  position: relative;
  height: 100%;
  min-height: 30rem;
  background: #09131f;
}
.debug-setup {
  min-height: 100%;
  background: #f5f7fa;
  color: #243042;
}
.debug-controls {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid #dce2ea;
  background: white;
}
.debug-controls h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 6px;
}
.debug-controls p {
  color: #647184;
  font-size: 13px;
}
.debug-actions,
.team-sides {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.debug-setup button {
  cursor: pointer;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 14px;
  background: white;
}
.debug-setup button:disabled {
  cursor: default;
  opacity: 0.5;
}
.debug-setup button.start {
  background: #2467c8;
  color: white;
  border-color: #2467c8;
}
.team-sides {
  padding: 14px 24px;
}
.team-sides button[aria-pressed='true'] {
  color: #2467c8;
  border-color: #2467c8;
  background: #edf2f8;
}
.team-sides label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.team-sides input {
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 6px;
}
.debug-error {
  color: #b42318;
  padding: 10px 24px;
}
</style>
