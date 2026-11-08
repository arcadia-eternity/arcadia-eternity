import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ErrorResponse } from '@arcadia-eternity/protocol'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { useBattleClientStore } from './battleClient'
import { usePrivateRoomStore } from './privateRoom'

export const useMatchmakingStore = defineStore('matchmaking', () => {
  const client = useBattleClientStore()
  const rooms = usePrivateRoomStore()
  const joining = ref(false)
  const canceling = ref(false)
  const error = ref('')
  const searching = computed(() => client.currentState.matchmaking === 'searching')
  const waiting = computed(() => joining.value || searching.value || canceling.value)
  const blocksOtherBattles = computed(() => waiting.value || !!rooms.currentRoom?.matchmaking)
  const unavailable = computed(
    () => rooms.isSwitchingServer || client.currentState.status !== 'connected' || !!rooms.currentRoom,
  )
  const statusLabel = computed(() => {
    if (canceling.value) return '正在取消匹配…'
    return searching.value ? '正在寻找对手…' : '正在准备匹配…'
  })
  let generation = 0

  async function start(team: PetSchemaType[], environmentId: string) {
    if (waiting.value || unavailable.value) return
    const attempt = ++generation
    joining.value = true
    error.value = ''
    try {
      await rooms.joinMatchmaking(team, environmentId)
    } catch (cause) {
      if (attempt === generation && !canceling.value)
        error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (attempt === generation) joining.value = false
    }
  }

  async function cancel() {
    if (!waiting.value || canceling.value) return
    const attempt = generation
    canceling.value = true
    error.value = ''
    try {
      await rooms.cancelMatchmaking()
      if (attempt !== generation) return
      ++generation
      joining.value = false
      canceling.value = false
    } catch (cause) {
      if (attempt !== generation) return
      canceling.value = false
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  client.on('matchmakingError', (response: ErrorResponse) => {
    if (response.code !== 'MATCHMAKING_CANCELED') error.value = `匹配未完成（${response.code}），请重试`
  })

  watch(
    () => client.serverUrl,
    () => {
      ++generation
      joining.value = false
      canceling.value = false
      error.value = ''
    },
  )
  watch(
    () => [client.currentState.status, searching.value] as const,
    ([status], [previous, wasSearching]) => {
      if (previous !== 'connected' || status === 'connected' || (!wasSearching && !waiting.value)) return
      ++generation
      joining.value = false
      canceling.value = false
      error.value = '连接已断开，请重新连接后匹配'
      void rooms.cancelMatchmaking().catch(() => undefined)
    },
  )

  return { waiting, blocksOtherBattles, canceling, unavailable, statusLabel, error, start, cancel }
})
