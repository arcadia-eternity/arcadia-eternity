import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ErrorResponse } from '@arcadia-eternity/protocol'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { useBattleClientStore } from './battleClient'
import { usePrivateRoomStore } from './privateRoom'

export function matchmakingErrorMessage(cause: unknown, fallback = '匹配未完成，请重试'): string {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  const code = message.split(':', 1)[0]
  switch (code) {
    case 'ENVIRONMENT_MATCHMAKING_DISABLED':
      return '这个环境未开放匹配，请选择其他环境'
    case 'ENVIRONMENT_NOT_FOUND':
    case 'ENVIRONMENT_NOT_PUBLISHED':
    case 'ENVIRONMENT_RETIRED':
    case 'CLIENT_ENVIRONMENT_MISMATCH':
    case 'CLIENT_PEER_ENVIRONMENT_MISMATCH':
      return '对战环境已变更，请重新选择'
    case 'ENVIRONMENT_TEAM_REJECTED':
    case 'INVALID_TEAM':
      return '队伍不符合这个环境的规则，请调整队伍后再匹配'
    case 'SERVER_DRAINING':
    case 'SERVER_STOPPED':
      return '服务器已停止接收新的匹配'
    case 'ROOM_CAPACITY':
    case 'BATTLE_QUEUE_TIMEOUT':
      return '服务器繁忙，请稍后重试'
    case 'ALREADY_IN_ROOM':
      return '请先退出当前房间'
    case 'Matchmaking timeout':
      return '匹配请求超时，请稍后重试'
    default:
      return /^\p{Script=Han}/u.test(message) && !/\b[A-Z]+(?:_[A-Z0-9]+)+\b/.test(message) ? message : fallback
  }
}

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
      if (attempt === generation && !canceling.value) error.value = matchmakingErrorMessage(cause)
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
      error.value = matchmakingErrorMessage(cause)
    }
  }

  client.on('matchmakingError', (response: ErrorResponse) => {
    if (response.code !== 'MATCHMAKING_CANCELED') error.value = matchmakingErrorMessage(response.code)
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
