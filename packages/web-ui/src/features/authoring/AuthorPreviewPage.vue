<script setup lang="ts">
import BattleLoading from '@/components/battle/BattleLoading.vue'
import TeamEditor from '@/components/team/TeamEditor.vue'
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
import { createPreviewTeamDelegate } from './previewTeamDelegate'
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
  // This window has a candidate-specific, in-memory Electron partition.
  if (window.arcadiaAuthorPreview && players.value.length === 2)
    localStorage.setItem(storageKey, JSON.stringify(players.value))
}
watch(players, persist, { deep: true, flush: 'sync' })
function resetTeams() {
  players.value = JSON.parse(JSON.stringify(defaults))
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
  if (busy.value) return
  if (reconfigure && active.value && !window.confirm('重新开始会结束当前测试对局，使用这里的队伍配置。继续吗？')) return
  busy.value = true
  error.value = ''
  try {
    if (reconfigure) await configureAuthorPreview(endpoint, players.value)
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
    defaults = setup.players
    active.value = setup.active
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
        <p>本次调试专用，与个人编队分开。第一只精灵为首发，对方由 AI 操作。</p>
      </div>
      <div class="debug-actions">
        <button :disabled="busy" @click="resetTeams">恢复项目默认</button>
        <button v-if="active" :disabled="busy" @click="launch()">继续当前对局</button>
        <button class="start" :disabled="busy || !!problems.length" @click="launch(true)">
          {{ busy ? '正在准备…' : active ? '按当前配置重新开始' : '开始对战' }}
        </button>
      </div>
    </header>
    <p v-if="error" class="debug-error" role="alert">{{ error }}</p>
    <ul v-if="problems.length" class="debug-error" role="alert">
      <li v-for="problem in problems" :key="problem">{{ problem }}</li>
    </ul>
    <nav class="team-sides" aria-label="测试双方">
      <button v-for="(player, index) in players" :key="player.id" :aria-pressed="side === index" @click="side = index">
        {{ index === 0 ? '我方' : '对方（AI）' }} · {{ player.team.length }} 只
      </button>
      <label>训练师名称<input v-model="players[side]!.name" /></label>
    </nav>
    <TeamEditor v-if="delegates[side]" :key="side" :delegate="delegates[side]!" compact />
  </main>
</template>

<style scoped>
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
