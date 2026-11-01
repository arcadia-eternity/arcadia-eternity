<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { isNavigationFailure, useRoute, useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { useGameDataStore } from '@/stores/gameData'
import { connectAuthorPreview } from '@/services/authorPreview'
import type { IBattleSystem } from '@arcadia-eternity/interface'

const route = useRoute(),
  router = useRouter(),
  battle = useBattleStore(),
  data = useGameDataStore()
const error = ref('')
let disposed = false,
  transferred = false,
  cleanup: (() => Promise<void>) | undefined
let ownedSystem: IBattleSystem | undefined
async function discard() {
  await cleanup?.()
  if (ownedSystem && battle.battleInterface === ownedSystem) await battle.resetBattleWithoutSurrender()
}
onMounted(async () => {
  try {
    await data.whenReady()
    const endpoint = typeof route.query.endpoint === 'string' ? route.query.endpoint : ''
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
    if (!player) throw new Error('试玩队伍为空，请检查 arcadia.config.mjs。')
    await battle.initBattle(prepared.system, player, () => !disposed || transferred)
    if (disposed) {
      await cleanup()
      return
    }
    // The battle store owns cleanup after navigation; preserve the source editor in its own window.
    transferred = true
    const result = await router.replace({ name: 'Battle', query: { authorPreview: endpoint } })
    if (isNavigationFailure(result)) {
      transferred = false
      throw new Error('无法进入战斗界面，请重新打开试玩。')
    }
  } catch (cause) {
    transferred = false
    await discard()
    if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause)
  }
})
onBeforeUnmount(() => {
  disposed = true
  if (!transferred) void discard()
})
</script>

<template>
  <main style="max-width: 42rem; margin: 10vh auto; padding: 2rem">
    <h1>内容包试玩</h1>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else role="status">正在载入本次候选与战斗画面…</p>
    <p v-if="error">回到源项目重新准备试玩。源码和已安装版本会保留。</p>
  </main>
</template>
