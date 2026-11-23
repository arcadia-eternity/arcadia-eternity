import { createMediaPreloader } from '@/services/environmentMedia'
import { useGameSettingStore } from './gameSetting'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'
import { defineStore } from 'pinia'
import { ref, shallowRef, computed, watch, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleClientStore } from './battleClient'
import { useAuthStore } from './auth'
import { usePlayerStore } from './player'
import { usePetStorageStore } from './petStorage'
import {
  resolveEnvironmentMechanics,
  DEFAULT_TIMER_CONFIG,
  resolveEnvironmentBattleOptions,
  BattleMessageType,
  type BattleState,
  type playerId,
} from '@arcadia-eternity/const'
import type {
  CreatePrivateRoomRequest,
  PrivateRoomBattleStartInfo,
  PrivateRoomEvent,
  PrivateRoomInfo,
  UpdatePrivateRoomConfigRequest,
  PrivateRoomPeerSignalEvent,
  PrivateRoomPeerSignalPayload,
  ServerEnvironmentAcceptance,
  ServerEnvironmentDescriptor,
  PersonalEnvironmentReference,
} from '@arcadia-eternity/protocol'
import type { PetSchemaType } from '@arcadia-eternity/schema'

import { ElMessageBox, ElNotification } from 'element-plus'
import { useBattleStore } from './battle'
import { RemoteBattleSystem, type BattleClient } from '@arcadia-eternity/client'
import { useGameDataStore } from './gameData'
import {
  closePrivateRoomPeerSession,
  consumePrivateRoomPeerSignals,
  createInitialPrivateRoomPeerSessionState,
  markPrivateRoomPeerConnected,
  markPrivateRoomPeerFailed,
  markPrivateRoomPeerReady,
  preparePrivateRoomPeerSession,
  pushPrivateRoomPeerSignal,
  type PrivateRoomPeerSessionState,
} from '@/p2p/privateRoomPeerSession'
import { createPrivateRoomSignalBridge, type PrivateRoomSignalBridge } from '@/p2p/privateRoomSignalBridge'
import { WebRTCPeerTransport as BrowserWebRTCPeerTransport } from '@/p2p/webRtcPeerTransport'
import { ServerRelayPeerTransport } from '@/p2p/relayPeerTransport'
import type { PeerTransport } from '@arcadia-eternity/p2p-transport'
import { createP2PHostBattleSystem, P2PPeerBattleSystem } from '@/p2p/p2pBattleSystem'
import { listServerEnvironments, prepareServerEnvironment } from '@/services/serverEnvironment'
import { preparePeerEnvironment } from '@/services/peerEnvironment'
import { validatePersonalEnvironmentTeam, type PreparedPersonalEnvironment } from '@/services/personalEnvironment'
import { validateBasicTeam } from '@/utils/basicTeamValidation'
import { allowsPeerExecution, requireServerExecution } from '@/services/serverEnvironmentPolicy'
import { useServerStateStore } from '@/stores/serverState'
import type { SandboxEnvironment } from '@arcadia-eternity/battle/sandbox'

type P2PTransportMode = 'auto' | 'webrtc' | 'relay'

const buildRoomPeerTransportId = (roomCode: string, playerId: string): string => {
  const raw = `ae-${roomCode}-${playerId}`
  const sanitized = raw
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+$/, '')
  return sanitized.length > 0 ? sanitized : `ae-${roomCode}`
}

export const usePrivateRoomStore = defineStore('privateRoom', () => {
  const router = useRouter()
  const battleClientStore = useBattleClientStore()
  const authStore = useAuthStore()
  const playerStore = usePlayerStore()
  const petStorageStore = usePetStorageStore()
  const gameDataStore = useGameDataStore()

  // 状态
  const currentRoom = ref<PrivateRoomInfo | null>(null)
  const environments = ref<ServerEnvironmentDescriptor[]>([])
  const isSwitchingServer = ref(false)
  let serverSwitchGeneration = 0
  let battleStartGeneration = 0
  let battleStartController: AbortController | undefined
  let leaveInFlight: Promise<void> | undefined
  const roomAdmissions = new Set<Promise<unknown>>()
  const admitRoom = <T>(operation: () => Promise<T>): Promise<T> => {
    if (isSwitchingServer.value) return Promise.reject(new Error('正在切换服务器'))
    const pending = operation()
    roomAdmissions.add(pending)
    void pending.then(
      () => roomAdmissions.delete(pending),
      () => roomAdmissions.delete(pending),
    )
    return pending
  }
  const serverScope = () =>
    `${battleClientStore.serverUrl}|${authStore.serverGeneration}|${authStore.serverInfo?.serverId ?? ''}|${authStore.serverInfo?.bootId ?? ''}`
  const assertServerScope = (scope: string) => {
    if (scope !== serverScope()) throw new Error('服务器连接已变化，请重试')
  }
  let preparedEnvironment: {
    key: string
    controller: AbortController
    task: ReturnType<typeof prepareServerEnvironment> | ReturnType<typeof preparePeerEnvironment>
  } | null = null
  let editorCatalog:
    { key: string; controller: AbortController; task: ReturnType<typeof prepareServerEnvironment> } | undefined
  const clearEditorCatalog = () => {
    editorCatalog?.controller.abort()
    editorCatalog = undefined
  }
  let preparedPeerEnvironment: SandboxEnvironment | undefined
  const personalEnvironment = shallowRef<PreparedPersonalEnvironment>()
  const personalEnvironmentReady = computed(
    () =>
      !!personalEnvironment.value &&
      (!currentRoom.value ||
        currentRoom.value.personalEnvironment?.descriptor.id === personalEnvironment.value.reference.descriptor.id),
  )
  let catalogController: AbortController | undefined
  const queueMedia = createMediaPreloader('匹配队列')
  const roomMedia = createMediaPreloader('房间队伍')
  const roomCatalog = shallowRef<{ id: string; content: ServerEnvironmentContent }>()
  const settings = useGameSettingStore()
  let matchmakingController: AbortController | undefined
  const roomCreationControllers = new Set<AbortController>()
  const cancelEnvironmentRequests = () => {
    queueMedia.stop()
    roomMedia.stop()
    roomCatalog.value = undefined
    clearEditorCatalog()
    preparedEnvironment?.controller.abort()
    catalogController?.abort()
    matchmakingController?.abort()
    for (const controller of roomCreationControllers) controller.abort()
    preparedEnvironment = null
    preparedPeerEnvironment = undefined
    personalEnvironment.value?.release()
    personalEnvironment.value = undefined
  }
  let matchmakingGeneration = 0
  let matchmakingEnvironmentGeneration = 0
  let environmentCatalogGeneration = 0
  watch(
    () => [
      battleClientStore.serverUrl,
      authStore.serverGeneration,
      authStore.serverInfo?.serverId,
      authStore.serverInfo?.bootId,
    ],
    () => {
      cancelPendingBattleStart()
      environmentCatalogGeneration++
      environments.value = []
      cancelEnvironmentRequests()
      gameDataStore.clearServerEnvironment()
    },
  )
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const selectedTeam = ref<PetSchemaType[]>([]) // 当前选择的队伍
  const selectedTeamName = ref('')
  const selectedTeamId = ref<string>()
  const roomSeatKey = computed(() =>
    currentRoom.value ? JSON.stringify([serverScope(), currentRoom.value.id, battleClientStore.playerId]) : undefined,
  )
  const roomEditorKey = computed(() => {
    const room = currentRoom.value
    if (!room?.environment) return undefined
    return JSON.stringify([roomSeatKey.value, room.environment.id, room.environment.gameplayRevision])
  })
  watchEffect(() => {
    const room = currentRoom.value
    const catalog = roomCatalog.value
    if (!catalog || room?.environment?.id !== catalog.id) return roomMedia.stop()
    const team = [...selectedTeam.value, ...room.players.flatMap(player => player.team ?? [])]
    roomMedia.update(catalog.content, team, settings)
    queueMedia.stop()
  })
  const roomTeamDraft = ref<{ key: string; roomId: string; version: string; name: string; pets: PetSchemaType[] }>()
  let roomEditorRequest = 0
  watch(
    roomSeatKey,
    (_, previous) => {
      if (!previous) return
      clearEditorCatalog()
      roomTeamDraft.value = undefined
      selectedTeam.value = []
      selectedTeamName.value = ''
      selectedTeamId.value = undefined
    },
    { flush: 'sync' },
  )
  const copyTeam = (pets: PetSchemaType[]): PetSchemaType[] => JSON.parse(JSON.stringify(pets))
  const peerSignals = ref<PrivateRoomPeerSignalEvent[]>([])
  const peerSession = ref<PrivateRoomPeerSessionState>(createInitialPrivateRoomPeerSessionState())
  let peerTransport: PeerTransport | null = null
  let peerBridge: PrivateRoomSignalBridge | null = null
  let peerBridgeReady = false
  let peerSignalDrain: Promise<void> | null = null
  let peerBattleSnapshotUnsubscribe: (() => void) | null = null
  let peerBattleEndUnsubscribe: (() => void) | null = null
  let roomPollTimer: ReturnType<typeof setInterval> | null = null
  let resumeBattleInFlight: Promise<void> | null = null
  let battleStartInFlight: { roomId: string; task: Promise<boolean> } | null = null
  function cancelPendingBattleStart(): void {
    if (!battleStartController) return
    battleStartGeneration++
    battleStartController.abort()
    battleStartController = undefined
    battleStartInFlight = null
  }
  let initializedBattleRoomId: string | null = null
  let lastResumeAttemptAt = 0
  let lastP2PInitErrorMessage: string | null = null
  let lastP2PInitErrorAt = 0

  // 计算属性
  const players = computed(() => currentRoom.value?.players || [])
  const spectators = computed(() => currentRoom.value?.spectators || [])
  const isHost = computed(() => currentRoom.value?.config.hostPlayerId === battleClientStore.playerId)
  const isPlayer = computed(() => players.value.some(p => p.playerId === battleClientStore.playerId))
  const isSpectator = computed(() => spectators.value.some(s => s.playerId === battleClientStore.playerId))
  const myReadyStatus = computed(() => {
    const me = players.value.find(p => p.playerId === battleClientStore.playerId)
    return me?.isReady || false
  })
  const canStartBattle = computed(() => {
    if (!isHost.value || !currentRoom.value) return false
    if (players.value.length < 2) return false

    // 如果房主是玩家，需要选择队伍
    if (isPlayer.value && (!selectedTeam.value || selectedTeam.value.length === 0)) {
      return false
    }

    // 检查所有非房主玩家是否已准备
    const nonHostPlayers = players.value.filter(p => p.playerId !== currentRoom.value?.config.hostPlayerId)
    return nonHostPlayers.every(p => p.isReady)
  })
  const isBattleInProgress = computed(() => currentRoom.value?.status === 'started')
  const isP2PBattle = computed(() => currentRoom.value?.config.battleMode === 'p2p')

  const resolveP2PTransportMode = (): P2PTransportMode => {
    const configuredMode = currentRoom.value?.config.p2pTransport ?? 'auto'
    if (configuredMode !== 'auto') {
      return configuredMode
    }

    const envMode = import.meta.env.VITE_P2P_TRANSPORT as P2PTransportMode | undefined
    if (envMode === 'webrtc' || envMode === 'relay') {
      return envMode
    }

    // Auto uses the server relay until ICE/TURN fallback is available.
    // The host still owns the battle; the server only forwards messages.
    return 'relay'
  }

  // 方法
  const expectedRuntime = () => {
    const runtime = authStore.serverInfo?.runtime
    if (!runtime || runtime.kind !== 'native-v4') throw new Error('服务器没有提供可用的原生对战版本')
    return runtime
  }

  const refreshEnvironments = async (): Promise<void> => {
    const generation = ++environmentCatalogGeneration
    const scope = serverScope()
    environments.value = []
    preparedEnvironment?.controller.abort()
    preparedEnvironment = null
    catalogController?.abort()
    catalogController = new AbortController()
    const items = await listServerEnvironments(battleClientStore.serverUrl, fetch, catalogController.signal)
    if (generation === environmentCatalogGeneration && scope === serverScope()) environments.value = items
  }

  const defaultEnvironment = computed(() => environments.value.find(item => item.isDefault))

  const prepareMatchmakingEnvironment = async (environmentId?: string) => {
    const generation = ++matchmakingEnvironmentGeneration
    const scope = serverScope()
    const descriptor = environmentId
      ? environments.value.find(item => item.id === environmentId)
      : defaultEnvironment.value
    if (!descriptor) throw new Error('对战内容不可用，请重新选择')
    if (descriptor.matchmakingEnabled === false) throw new Error('这个环境未开放匹配，请选择其他环境')
    matchmakingController?.abort()
    matchmakingController = new AbortController()
    const prepare = descriptor.executionPolicy === 'peer' ? preparePeerEnvironment : prepareServerEnvironment
    const prepared = await prepare(battleClientStore.serverUrl, descriptor, fetch, matchmakingController.signal)
    assertServerScope(scope)
    if (generation !== matchmakingEnvironmentGeneration) throw new Error('对战内容已变化，请重新选择')
    if (isSwitchingServer.value) throw new Error('正在切换服务器')
    return { descriptor, ...prepared }
  }

  const cancelMatchmakingPreparation = () => {
    queueMedia.stop()
    ++matchmakingEnvironmentGeneration
    matchmakingController?.abort()
  }

  const cancelMatchmaking = async () => {
    ++matchmakingGeneration
    cancelMatchmakingPreparation()
    if (battleClientStore.currentState.matchmaking === 'searching') await battleClientStore.cancelMatchmaking()
  }

  const joinMatchmaking = (team: PetSchemaType[], environmentId?: string): Promise<void> =>
    admitRoom(async () => {
      const scope = serverScope()
      const generation = ++matchmakingGeneration
      // A result screen may still retain its automatically paired room for a few seconds.
      if (currentRoom.value?.matchmaking && currentRoom.value.status === 'ended') await leaveRoom()
      if (currentRoom.value) throw new Error('请先离开当前房间')
      await refreshEnvironments()
      assertServerScope(scope)
      if (generation !== matchmakingGeneration) throw new Error('匹配已取消')
      const prepared = await prepareMatchmakingEnvironment(environmentId)
      assertServerScope(scope)
      if (generation !== matchmakingGeneration) throw new Error('匹配已取消')
      if (isSwitchingServer.value) throw new Error('正在切换服务器')
      queueMedia.update(prepared.content, team, settings)
      try {
        await battleClientStore.joinMatchmaking({
          playerSchema: { id: battleClientStore.playerId, name: playerStore.player?.name ?? 'Player', team },
          environmentId: prepared.descriptor.id,
          environment: prepared.acceptance,
        })
      } catch (cause) {
        if (generation === matchmakingGeneration) queueMedia.stop()
        throw cause
      }
      assertServerScope(scope)
    })

  const roomEnvironment = async (
    isCurrent: () => boolean = () => true,
  ): Promise<ServerEnvironmentAcceptance | undefined> => {
    if (!isCurrent()) throw new DOMException('Room recovery cancelled', 'AbortError')
    ++matchmakingEnvironmentGeneration
    const room = currentRoom.value
    const descriptor = room?.environment
    if (!room || !descriptor) {
      preparedPeerEnvironment = undefined
      gameDataStore.clearServerEnvironment()
      return undefined
    }
    if (room.personalEnvironment) {
      const personal = personalEnvironment.value
      if (!personal || personal.reference.descriptor.id !== descriptor.id)
        throw new Error('请先导入房主分享的环境，确认后再准备')
      preparedPeerEnvironment = personal.environment
      gameDataStore.applyServerEnvironment(personal.content, {
        environmentId: descriptor.environmentId ?? descriptor.id,
        rules: personal.reference.rules,
      })
      roomCatalog.value = { id: descriptor.id, content: personal.content }
      return { ...personal.acceptance, challengeGeneration: room.challengeGeneration }
    }
    const environmentKey = () => {
      const activeRoom = currentRoom.value
      const active = activeRoom?.environment
      return (
        active &&
        `${roomEditorKey.value}|${activeRoom.config.roomCode}|${activeRoom.config.battleMode}|${active.id}|${active.resourceRevision}|${active.gameplayRevision ?? ''}|${active.peerRevision ?? ''}`
      )
    }
    const key = environmentKey()!
    if (!preparedEnvironment || preparedEnvironment.key !== key) {
      preparedEnvironment?.controller.abort()
      preparedPeerEnvironment = undefined
      const controller = new AbortController()
      const prepare = room.config.battleMode === 'p2p' ? preparePeerEnvironment : prepareServerEnvironment
      preparedEnvironment = {
        key,
        controller,
        task: prepare(battleClientStore.serverUrl, descriptor, fetch, controller.signal),
      }
    }
    const entry = preparedEnvironment
    let prepared: Awaited<typeof entry.task>
    try {
      prepared = await entry.task
    } catch (error) {
      if (preparedEnvironment === entry) preparedEnvironment = null
      throw error
    }
    if (environmentKey() !== key || preparedEnvironment !== entry) throw new Error('房间环境已变化，请重新准备')
    if (!isCurrent()) throw new DOMException('Room recovery cancelled', 'AbortError')
    preparedPeerEnvironment = 'environment' in prepared ? prepared.environment : undefined
    gameDataStore.applyServerEnvironment(prepared.content, {
      environmentId: descriptor.environmentId ?? descriptor.id,
      rules: descriptor.rules,
    })
    roomCatalog.value = { id: descriptor.id, content: prepared.content }
    return prepared.acceptance
  }

  const showRoomContent = async (isCurrent: () => boolean = () => true) => {
    const room = currentRoom.value
    if (!room?.environment || room.personalEnvironment || room.config.battleMode !== 'p2p') {
      await roomEnvironment(isCurrent)
      return
    }
    const key = roomEditorKey.value!
    if (editorCatalog?.key !== key) {
      clearEditorCatalog()
      const controller = new AbortController()
      editorCatalog = {
        key,
        controller,
        task: prepareServerEnvironment(battleClientStore.serverUrl, room.environment, fetch, controller.signal),
      }
    }
    const entry = editorCatalog
    let catalog: Awaited<typeof entry.task>
    try {
      catalog = await entry.task
    } catch (error) {
      if (editorCatalog === entry) clearEditorCatalog()
      throw error
    }
    if (!isCurrent() || editorCatalog !== entry || roomEditorKey.value !== key)
      throw new DOMException('Room preview closed', 'AbortError')
    gameDataStore.applyServerEnvironment(catalog.content, {
      environmentId: room.environment.environmentId ?? room.environment.id,
      rules: room.environment.rules,
    })
    roomCatalog.value = { id: room.environment.id, content: catalog.content }
  }

  const createRoom = (
    config: CreatePrivateRoomRequest['config'],
    environmentId?: string,
    personal?: PersonalEnvironmentReference,
  ): Promise<string> =>
    admitRoom(async () => {
      const scope = serverScope()
      isLoading.value = true
      error.value = null

      let createdRoomCode: string | undefined
      let preparation: AbortController | undefined
      try {
        if (
          personal &&
          (environmentId ||
            config.battleMode !== 'p2p' ||
            personalEnvironment.value?.reference.descriptor.id !== personal.descriptor.id)
        )
          throw new Error('请先准备个人环境，并选择由玩家主机运行')
        const descriptor = environmentId ? environments.value.find(item => item.id === environmentId) : undefined
        if (environmentId && !descriptor) throw new Error('对战内容不可用，请重新选择')
        if (descriptor && config.battleMode !== 'p2p') requireServerExecution(descriptor)
        if (descriptor && config.battleMode === 'p2p') {
          if (!allowsPeerExecution(descriptor)) throw new Error('此服务器环境需要由服务器运行，请重新选择对战方式')
          preparation = new AbortController()
          roomCreationControllers.add(preparation)
          await preparePeerEnvironment(battleClientStore.serverUrl, descriptor, fetch, preparation.signal)
          assertServerScope(scope)
          if (isSwitchingServer.value) throw new Error('正在切换服务器')
        }
        const roomCode = await battleClientStore.createPrivateRoom({
          config,
          ...(personal ? { personalEnvironment: personal } : {}),
          ...(environmentId ? { environmentId } : {}),
          ...(config.battleMode === 'p2p'
            ? { expectedRuntime: personal?.descriptor.runtime ?? descriptor?.runtime ?? expectedRuntime() }
            : {}),
        })
        createdRoomCode = roomCode
        assertServerScope(scope)

        // 获取房间信息
        await getRoomInfo(roomCode)
        assertServerScope(scope)
        startRoomPolling()
        return roomCode
      } catch (err) {
        if (createdRoomCode && scope === serverScope()) {
          await battleClientStore.leavePrivateRoom().catch(() => undefined)
          cleanup()
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        if (scope === serverScope()) error.value = errorMessage
        throw err
      } finally {
        if (preparation) roomCreationControllers.delete(preparation)
        if (scope === serverScope()) isLoading.value = false
      }
    })

  const joinRoom = (roomCode: string, password?: string): Promise<void> =>
    admitRoom(async () => {
      const scope = serverScope()
      isLoading.value = true
      error.value = null

      let joined = false
      try {
        await battleClientStore.joinPrivateRoom({
          roomCode,
          password,
        })
        joined = true
        assertServerScope(scope)

        // 获取房间信息
        await getRoomInfo(roomCode)
        assertServerScope(scope)
        if (currentRoom.value?.config.battleMode === 'p2p') expectedRuntime()
        startRoomPolling()
      } catch (err) {
        if (joined && scope === serverScope()) {
          await battleClientStore.leavePrivateRoom().catch(() => undefined)
          cleanup()
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        if (scope === serverScope()) error.value = errorMessage
        throw err
      } finally {
        if (scope === serverScope()) isLoading.value = false
      }
    })

  const joinAsSpectator = async (
    roomCode: string,
    _preferredView?: 'player1' | 'player2' | 'god',
    password?: string,
  ): Promise<void> =>
    admitRoom(async () => {
      const scope = serverScope()
      isLoading.value = true
      error.value = null

      let joined = false
      try {
        await battleClientStore.joinPrivateRoomAsSpectator({
          roomCode,
          password,
        })
        joined = true
        assertServerScope(scope)

        // 获取房间信息
        await getRoomInfo(roomCode)
        assertServerScope(scope)
        if (currentRoom.value?.config.battleMode === 'p2p') expectedRuntime()
        startRoomPolling()
      } catch (err) {
        if (joined && scope === serverScope()) {
          await battleClientStore.leavePrivateRoom().catch(() => undefined)
          cleanup()
        }
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        if (scope === serverScope()) error.value = errorMessage
        throw err
      } finally {
        if (scope === serverScope()) isLoading.value = false
      }
    })

  const leaveRoom = (): Promise<void> => {
    if (leaveInFlight) return leaveInFlight
    if (!currentRoom.value) return Promise.resolve()
    cancelPendingBattleStart()
    const scope = serverScope()
    isLoading.value = true
    error.value = null
    const task = (async () => {
      try {
        await battleClientStore.leavePrivateRoom()
        assertServerScope(scope)
        cleanup()
      } catch (err) {
        if (scope === serverScope()) error.value = err instanceof Error ? err.message : 'Unknown error'
        throw err
      } finally {
        if (scope === serverScope()) isLoading.value = false
      }
    })()
    leaveInFlight = task
    void task.then(
      () => {
        if (leaveInFlight === task) leaveInFlight = undefined
      },
      () => {
        if (leaveInFlight === task) leaveInFlight = undefined
      },
    )
    return task
  }

  /** Leave the old room before retiring its credentials and connecting to another authority. */
  const switchServer = async (address: string): Promise<void> => {
    const target = authStore.checkServerUrl(address)
    const hadPendingBattleStart = !!battleStartInFlight
    cancelPendingBattleStart()
    const generation = ++serverSwitchGeneration
    ++matchmakingGeneration
    isSwitchingServer.value = true
    for (const controller of roomCreationControllers) controller.abort()
    try {
      await Promise.allSettled([...roomAdmissions])
      if (generation !== serverSwitchGeneration) return
      if (battleClientStore.currentState.matchmaking === 'searching') await battleClientStore.cancelMatchmaking()
      const hadBattle = currentRoom.value?.status === 'started' || hadPendingBattleStart || !!battleStartInFlight
      if (currentRoom.value) await leaveRoom()
      if (generation !== serverSwitchGeneration) return
      if (hadBattle && !useBattleStore().isOfflineBattle) await useBattleStore().resetBattleWithoutSurrender()
      if (generation !== serverSwitchGeneration) return
      cleanup()
      const oldSocket = battleClientStore.serverUrl
      const oldAuthGeneration = authStore.serverGeneration
      battleClientStore.disconnect()
      try {
        authStore.setServerUrl(target)
      } catch (error) {
        if (authStore.serverGeneration === oldAuthGeneration) {
          battleClientStore.replaceServer(oldSocket)
          await battleClientStore.connect().catch(() => undefined)
        } else {
          battleClientStore.replaceServer(authStore.serverUrl)
        }
        throw error
      }
      battleClientStore.replaceServer(target)
      useServerStateStore().updateServerState({ onlinePlayers: 0, matchmakingQueue: 0, rooms: 0, playersInRooms: 0 })
      try {
        await battleClientStore.connect()
      } catch (error) {
        throw new Error(
          `旧服务器连接已终止，无法连接新服务器：${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      if (generation !== serverSwitchGeneration) return
    } catch (error) {
      if (generation === serverSwitchGeneration) throw error
    } finally {
      if (generation === serverSwitchGeneration) isSwitchingServer.value = false
    }
  }

  const toggleReady = async (): Promise<void> => {
    if (!currentRoom.value || !isPlayer.value) return

    isLoading.value = true
    error.value = null

    try {
      const scope = serverScope()
      // 如果要准备，使用当前选择的队伍；如果取消准备，不传队伍
      const preparedFor = roomEditorKey.value
      const challengeGeneration = currentRoom.value?.challengeGeneration
      const teamToSubmit = myReadyStatus.value ? undefined : selectedTeam.value
      const acceptance = myReadyStatus.value ? undefined : await roomEnvironment()
      if (!myReadyStatus.value && currentRoom.value?.personalEnvironment && personalEnvironment.value)
        validatePersonalEnvironmentTeam(personalEnvironment.value, teamToSubmit)
      if (!myReadyStatus.value && currentRoom.value?.config.battleMode === 'p2p' && !preparedPeerEnvironment)
        throw new Error('P2P 对战环境尚未准备完成')
      assertServerScope(scope)
      if (roomEditorKey.value !== preparedFor || currentRoom.value?.challengeGeneration !== challengeGeneration)
        throw new Error('房间或环境已变化，请重新准备')
      await battleClientStore.toggleRoomReady(teamToSubmit, acceptance)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const startBattle = async (): Promise<void> => {
    if (!currentRoom.value || !isHost.value) return

    // 如果房主是玩家，检查是否选择了队伍
    if (isPlayer.value && (!selectedTeam.value || selectedTeam.value.length === 0)) {
      throw new Error('请先选择队伍')
    }

    isLoading.value = true
    error.value = null

    try {
      const scope = serverScope()
      // 发送开始战斗请求
      const preparedFor = roomEditorKey.value
      const challengeGeneration = currentRoom.value?.challengeGeneration
      const hostTeam = isPlayer.value ? selectedTeam.value : undefined
      const acceptance = await roomEnvironment()
      if (hostTeam && currentRoom.value?.personalEnvironment && personalEnvironment.value)
        validatePersonalEnvironmentTeam(personalEnvironment.value, hostTeam)
      if (currentRoom.value?.config.battleMode === 'p2p' && !preparedPeerEnvironment)
        throw new Error('P2P 对战环境尚未准备完成')
      assertServerScope(scope)
      if (roomEditorKey.value !== preparedFor || currentRoom.value?.challengeGeneration !== challengeGeneration)
        throw new Error('房间或环境已变化，请重新准备')
      await battleClientStore.startRoomBattle(hostTeam, acceptance)

      // 注意：不在这里跳转页面，而是等待 battleStarted 事件
      // 事件处理在 handleRoomEvent 中的 'battleStarted' case
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const updateRuleSet = async (ruleSetId: string): Promise<void> => {
    if (!currentRoom.value || !isHost.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.updatePrivateRoomRuleSet({ ruleSetId })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const updateRoomConfig = async (configUpdates: UpdatePrivateRoomConfigRequest): Promise<void> => {
    if (!currentRoom.value || !isHost.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.updatePrivateRoomConfig(configUpdates)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const transferHost = async (targetPlayerId: string): Promise<void> => {
    if (!currentRoom.value || !isHost.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.transferPrivateRoomHost(targetPlayerId)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const kickPlayer = async (targetPlayerId: string): Promise<void> => {
    if (!currentRoom.value || !isHost.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.kickPlayerFromPrivateRoom(targetPlayerId)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const joinSpectateBattle = async (): Promise<void> => {
    if (isP2PBattle.value) {
      throw new Error('P2P 私人房间暂不支持观战')
    }

    if (!currentRoom.value?.battleRoomId) {
      throw new Error('当前没有正在进行的战斗')
    }

    isLoading.value = true
    error.value = null

    try {
      // 检查当前是否已经在正确的观战页面
      const currentRoute = router.currentRoute.value
      const isCorrectSpectatorPage =
        currentRoute.path === '/battle' &&
        currentRoute.query.roomId === currentRoom.value.battleRoomId &&
        currentRoute.query.spectate === 'true'

      if (isCorrectSpectatorPage) {
        return
      }

      // 检查战斗系统状态
      const battleStore = useBattleStore()
      const hasValidBattleConnection =
        battleStore.battleInterface &&
        battleClientStore._instance &&
        battleStore.playerId === battleClientStore.playerId

      if (!hasValidBattleConnection) {
        // 只有在没有有效连接时才重新建立连接
        await battleClientStore.joinSpectateBattle(currentRoom.value.battleRoomId)

        const client = battleClientStore._instance as unknown as BattleClient
        if (!client) {
          throw new Error('BattleClient 实例尚未初始化')
        }

        await battleStore.initBattle(new RemoteBattleSystem(client), battleClientStore.playerId, 'online')
      } else {
        // 如果已有连接，只需要确保后端知道当前session在观战
        await battleClientStore.joinSpectateBattle(currentRoom.value.battleRoomId)
      }

      // 3. 导航到战斗页面
      router.push({
        path: '/battle',
        query: {
          roomId: currentRoom.value.battleRoomId,
          privateRoom: 'true',
          roomCode: currentRoom.value.config.roomCode,
          spectate: 'true', // 添加一个观战标记
        },
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 房间配置表单状态
  const roomConfigForm = ref({
    ruleSetId: '',
    isPrivate: false,
    password: '',
    p2pTransport: 'auto' as P2PTransportMode,
  })

  // 初始化房间配置表单
  const initializeRoomConfigForm = (): void => {
    if (currentRoom.value) {
      roomConfigForm.value = {
        ruleSetId: currentRoom.value.config.ruleSetId,
        isPrivate: currentRoom.value.config.isPrivate,
        password: currentRoom.value.config.password || '',
        p2pTransport: currentRoom.value.config.p2pTransport ?? 'auto',
      }
    }
  }

  const switchToSpectator = async (): Promise<void> => {
    if (!currentRoom.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.switchToSpectator()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const switchToPlayer = async (team: PetSchemaType[]): Promise<void> => {
    if (!currentRoom.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.switchToPlayer(team)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const getRoomInfo = async (roomCode: string, isCurrent: () => boolean = () => true): Promise<void> => {
    const scope = serverScope()
    try {
      const response = await battleClientStore.getPrivateRoomInfo(roomCode)
      assertServerScope(scope)
      if (!isCurrent()) throw new Error('房间或环境已变化，请重新准备')
      currentRoom.value = response
      if (response && (!response.personalEnvironment || personalEnvironmentReady.value))
        await showRoomContent(isCurrent)
      assertServerScope(scope)
    } catch (err) {
      throw err
    }
  }

  /** Takes ownership of imported materials; they remain private to this connection and room. */
  const setPersonalEnvironment = async (prepared: PreparedPersonalEnvironment): Promise<void> => {
    const room = currentRoom.value
    if (room && (!room.personalEnvironment || room.status === 'started')) {
      if (personalEnvironment.value !== prepared) prepared.release()
      throw new Error('当前房间无法更换个人环境')
    }
    if (room && room.personalEnvironment!.descriptor.id !== prepared.reference.descriptor.id) {
      prepared.release()
      throw new Error('导入的环境与建房时锁定的版本不一致')
    }
    if (personalEnvironment.value !== prepared) {
      personalEnvironment.value?.release()
      personalEnvironment.value = prepared
    }
    preparedEnvironment?.controller.abort()
    preparedEnvironment = null
    preparedPeerEnvironment = undefined
    if (room) await roomEnvironment()
  }

  const stopRoomPolling = (): void => {
    if (roomPollTimer) {
      clearInterval(roomPollTimer)
      roomPollTimer = null
    }
  }

  const isOnPrivateBattleRoute = (): boolean => {
    const route = router.currentRoute.value
    return route.path === '/battle' && route.query.privateRoom === 'true'
  }

  const synthesizeBattleStartInfo = (room: PrivateRoomInfo): PrivateRoomBattleStartInfo | null => {
    const battleHostPlayerId = room.battleHost?.playerId ?? room.config.hostPlayerId
    const battleHostSessionId =
      room.battleHost?.sessionId ??
      room.players.find(player => player.playerId === battleHostPlayerId)?.sessionId ??
      room.spectators.find(spectator => spectator.playerId === battleHostPlayerId)?.sessionId

    if (!battleHostSessionId) {
      return null
    }

    return {
      battleMode: room.config.battleMode,
      battleRoomId: room.battleRoomId,
      battleHost: {
        playerId: battleHostPlayerId,
        sessionId: battleHostSessionId,
      },
    }
  }

  const ensureP2PBattleHostAvailable = async (): Promise<void> => {
    if (!currentRoom.value || currentRoom.value.config.battleMode !== 'p2p' || currentRoom.value.status !== 'started') {
      return
    }
    if (peerSession.value.role !== 'peer' || !peerSession.value.battleHost) {
      return
    }

    const hostStillPresent = [...currentRoom.value.players, ...currentRoom.value.spectators].some(
      participant => participant.playerId === peerSession.value.battleHost?.playerId,
    )

    if (hostStillPresent) {
      return
    }

    const battleStore = useBattleStore()
    const errorMessage = 'P2P 房主已断开连接，对战已中断'
    const room = currentRoom.value
    markPeerFailed(errorMessage)
    await teardownPeerTransport()
    if (battleStore.isOfflineBattle || currentRoom.value?.id !== room.id) return
    battleStore.errorMessage = errorMessage
    ElNotification({
      title: '对战中断',
      message: errorMessage,
      type: 'warning',
      duration: 5000,
      position: 'top-right',
    })
    await router.push(`/room/${room.config.roomCode}`)
  }

  const sendPeerSignal = async (
    targetPlayerId: string,
    signal: PrivateRoomPeerSignalPayload,
    targetSessionId?: string,
    battleRoomId = currentRoom.value?.battleRoomId,
  ): Promise<void> => {
    if (!currentRoom.value) {
      throw new Error('当前不在私人房间中')
    }

    await battleClientStore.sendPrivateRoomPeerSignal({
      ...(battleRoomId ? { battleRoomId } : {}),
      targetPlayerId,
      ...(targetSessionId ? { targetSessionId } : {}),
      signal,
    })

    peerSession.value = markPrivateRoomPeerReady(peerSession.value, signal.transport)
  }

  const consumePeerSignals = (): PrivateRoomPeerSignalEvent[] => {
    const queuedSignals = [...peerSignals.value]
    peerSignals.value = []
    consumePrivateRoomPeerSignals(peerSession.value)
    return queuedSignals
  }

  const markPeerConnected = (): void => {
    peerSession.value = markPrivateRoomPeerConnected(peerSession.value)
  }

  const markPeerFailed = (reason: string): void => {
    cancelPendingBattleStart()
    peerSession.value = markPrivateRoomPeerFailed(peerSession.value, reason)
  }

  const flushQueuedPeerSignals = async (): Promise<void> => {
    if (!peerBridge || !peerBridgeReady) return
    if (peerSignalDrain) return peerSignalDrain
    const bridge = peerBridge
    const task = (async () => {
      while (peerBridge === bridge && peerSignals.value.length > 0) {
        // SDP and ICE must reach one RTCPeerConnection in signaling order.
        for (const event of consumePeerSignals()) {
          if (peerBridge !== bridge) return
          await bridge.handleSignal(event)
        }
      }
    })()
    peerSignalDrain = task
    try {
      await task
    } finally {
      if (peerSignalDrain === task) peerSignalDrain = null
    }
    if (peerBridge === bridge && peerSignals.value.length > 0) await flushQueuedPeerSignals()
  }

  const teardownPeerTransport = async (): Promise<void> => {
    peerBridgeReady = false
    peerSignalDrain = null
    peerBattleEndUnsubscribe?.()
    peerBattleEndUnsubscribe = null
    if (peerBattleSnapshotUnsubscribe) {
      peerBattleSnapshotUnsubscribe()
      peerBattleSnapshotUnsubscribe = null
    }
    const bridge = peerBridge
    peerBridge = null
    peerTransport = null
    if (bridge) {
      try {
        await bridge.close()
      } catch (error) {
        console.error('Failed to close peer bridge:', error)
      }
    }
  }

  const setupPeerTransport = async (): Promise<void> => {
    if (!currentRoom.value || !isP2PBattle.value) return
    if (peerBridge || peerSession.value.role === 'spectator' || peerSession.value.role === 'none') return
    const remotePeer = peerSession.value.remotePeer
    if (!remotePeer) return
    const battleRoomId = currentRoom.value.battleRoomId

    const transportMode = resolveP2PTransportMode()
    const transport =
      transportMode === 'relay'
        ? new ServerRelayPeerTransport()
        : new BrowserWebRTCPeerTransport({
            localPeerId: buildRoomPeerTransportId(currentRoom.value.config.roomCode, battleClientStore.playerId),
          })
    transport.onStateChange(state => {
      if (peerTransport !== transport) return
      if (state === 'connected') {
        markPeerConnected()
        return
      }
      if (state === 'failed') {
        markPeerFailed('P2P transport failed')
        return
      }
      if (state === 'closed') {
        markPeerFailed('P2P transport closed')
      }
    })

    const bridge = createPrivateRoomSignalBridge({
      transport,
      signalTransport: transportMode === 'relay' ? 'relay' : 'webrtc',
      onOutgoingSignal: async signal => {
        if (peerBridge !== bridge) return
        if (currentRoom.value?.battleRoomId !== battleRoomId) return
        await sendPeerSignal(remotePeer.playerId, signal, remotePeer.sessionId, battleRoomId)
      },
    })

    peerTransport = transport
    peerBridge = bridge
    peerBridgeReady = false

    try {
      await bridge.connect(
        peerSession.value.role === 'host' ? 'host' : 'peer',
        transportMode === 'relay'
          ? remotePeer.playerId
          : buildRoomPeerTransportId(currentRoom.value.config.roomCode, remotePeer.playerId),
      )
      if (peerBridge !== bridge) return
      peerBridgeReady = true
      await flushQueuedPeerSignals()
    } catch (error) {
      if (peerBridge !== bridge) return
      peerBridgeReady = false
      peerBridge = null
      peerTransport = null
      markPeerFailed(error instanceof Error ? error.message : 'Failed to connect peer transport')
      throw error
    }
  }

  const initializeP2PBattleRuntime = async (isCurrent: () => boolean, signal: AbortSignal): Promise<void> => {
    if (!currentRoom.value) {
      throw new Error('当前房间不存在')
    }
    if (!peerBridge || !peerTransport) {
      throw new Error('P2P transport 尚未建立')
    }
    if (peerSession.value.role === 'spectator' || peerSession.value.role === 'none') {
      throw new Error(`当前角色 ${peerSession.value.role} 暂不支持 P2P 对战`)
    }
    await roomEnvironment(isCurrent)
    if (!isCurrent()) return
    const environment = preparedPeerEnvironment
    if (!environment || environment.revision !== currentRoom.value.environment?.peerRevision)
      throw new Error('P2P 对战环境尚未准备完成')
    if (!gameDataStore.loaded && !gameDataStore.gameDataLoaded) {
      await gameDataStore.initialize()
      if (!isCurrent()) return
      gameDataStore.gameDataLoaded = true
    }

    const battleStore = useBattleStore()
    const localPlayerId = battleClientStore.playerId as playerId
    const remotePlayer = currentRoom.value.players.find(player => player.playerId !== localPlayerId)
    if (!remotePlayer) {
      throw new Error('P2P 房间中未找到对手')
    }
    const battleRoomId = currentRoom.value.battleRoomId
    let reported = false
    function reportResult(winner: string | null, reason: string) {
      if (!isCurrent() || !battleRoomId || currentRoom.value?.battleRoomId !== battleRoomId || reported) return
      reported = true
      void battleClientStore._instance?.finishPrivateRoomBattle({ battleRoomId, winner, reason }).catch(error => {
        reported = false
        console.error('Failed to finish P2P room:', error)
      })
    }
    const battleInterface =
      peerSession.value.role === 'host'
        ? await (() => {
            const [playerA, playerB] = currentRoom.value!.players
            if (!playerA?.team || !playerB?.team) {
              throw new Error('P2P 房间缺少对战队伍数据')
            }
            if (currentRoom.value!.personalEnvironment && personalEnvironment.value) {
              validatePersonalEnvironmentTeam(personalEnvironment.value, playerA.team)
              validatePersonalEnvironmentTeam(personalEnvironment.value, playerB.team)
            }
            const rules = currentRoom.value!.personalEnvironment?.rules ?? currentRoom.value!.environment?.rules
            const mechanics = resolveEnvironmentMechanics(rules)
            return createP2PHostBattleSystem({
              localPlayerId,
              remotePlayerId: remotePlayer.playerId as playerId,
              localPlayerName: playerStore.player.name,
              remotePlayerName: remotePlayer.playerName,
              localTeam: playerA.playerId === localPlayerId ? playerA.team : playerB.team,
              remoteTeam: playerA.playerId === localPlayerId ? playerB.team : playerA.team,
              dataStore: gameDataStore,
              signal,
              onFault: () => reportResult(null, 'environment_runtime_failed'),
              bridge: peerBridge,
              transport: peerTransport,
              battleConfig: {
                environment,
                skillParameters: JSON.parse(JSON.stringify(rules?.skillParameters ?? null)) ?? undefined,
                matchups: JSON.parse(JSON.stringify(rules?.matchups ?? {})),
                individualValueMax: mechanics.individualValues.max,
                enhancementActive: mechanics.enhancement.mode === 'active',
                allowFaintSwitch: currentRoom.value!.config.allowFaintSwitch ?? true,
                showHidden: currentRoom.value!.config.showHidden ?? false,
                timerConfig: { ...DEFAULT_TIMER_CONFIG, ...currentRoom.value!.config.timerConfig },
                ...resolveEnvironmentBattleOptions(rules),
              },
            })
          })()
        : new P2PPeerBattleSystem(localPlayerId, peerBridge, peerTransport)

    if (!isCurrent()) {
      await battleInterface.cleanup()
      return
    }
    if (battleInterface instanceof P2PPeerBattleSystem) {
      const battleStore = useBattleStore()
      peerBattleSnapshotUnsubscribe = battleInterface.onSnapshot(({ battleState, availableSelections }) => {
        if (!isCurrent()) return
        battleStore.replaceP2PPeerState(battleState, availableSelections)
      })
    }

    if (peerSession.value.role === 'host') {
      peerBattleEndUnsubscribe = battleInterface.BattleEvent(message => {
        if (message.type === BattleMessageType.BattleEnd)
          reportResult(message.data.winner ?? null, message.data.reason ?? 'completed')
      })
    }

    await battleStore.initBattle(battleInterface, localPlayerId, 'online', isCurrent)
    if (!isCurrent()) return

    if (peerSession.value.role === 'host') {
      await battleStore.ready()
      if (!isCurrent()) return
      // The host starts before the battle page mounts. Its initial snapshot was
      // read while still Unstarted, so replace it with the live state before
      // the page waits for the first turn.
      const liveState = await battleInterface.getState(localPlayerId, false)
      if (!isCurrent()) return
      battleStore.battleState = liveState
      battleStore.lastProcessedSequenceId = liveState.sequenceId ?? battleStore.lastProcessedSequenceId
      const actions = await battleStore.fetchAvailableSelection(isCurrent)
      if (isCurrent()) battleStore.availableActions = actions
    }

    if (battleInterface instanceof P2PPeerBattleSystem) {
      void (async () => {
        const recoveryDeadline = Date.now() + 15_000
        while (
          isCurrent() &&
          battleStore.availableActions.length === 0 &&
          battleStore.battleState?.status === 'On' &&
          Date.now() < recoveryDeadline
        ) {
          const [battleState, availableSelections] = await Promise.all([
            battleInterface.getState(),
            battleInterface.getAvailableSelection(),
          ])

          if (!isCurrent()) return
          if (availableSelections.length > 0) {
            battleStore.replaceP2PPeerState(battleState, availableSelections)
            return
          }

          await new Promise(resolve => setTimeout(resolve, 500))
        }
      })().catch(error => {
        console.warn('Failed to recover peer battle actions after initialization:', error)
      })
    }
  }

  const initializeBattleStarted = async (
    battleStartInfo: PrivateRoomBattleStartInfo,
    isCurrent: () => boolean,
    signal: AbortSignal,
    recoveredState?: BattleState,
  ): Promise<boolean> => {
    let environmentReady = false
    try {
      if (currentRoom.value && battleStartInfo.battleMode === 'p2p') {
        const roomCode = currentRoom.value.config.roomCode
        const latestRoom = await battleClientStore.getPrivateRoomInfo(roomCode)
        if (!isCurrent()) return false
        if (latestRoom) {
          currentRoom.value = latestRoom
        }
        const room = currentRoom.value
        if (!room) {
          throw new Error('房间信息丢失，无法初始化 P2P 对战')
        }

        await teardownPeerTransport()
        if (!isCurrent()) return false
        if (isSpectator.value) return false
        peerSession.value = preparePrivateRoomPeerSession(room, battleClientStore.playerId, battleStartInfo)
        await setupPeerTransport()
        if (!isCurrent()) return false

        await initializeP2PBattleRuntime(isCurrent, signal)
        if (!isCurrent()) return false

        if (isSwitchingServer.value) return false
        await router.push({
          path: '/battle',
          query: {
            privateRoom: 'true',
            roomCode: currentRoom.value?.config.roomCode,
            p2p: 'true',
          },
        })
        return true
      }

      if (!battleStartInfo.battleRoomId) {
        throw new Error(`battleRoomId missing for private room battle start (${battleStartInfo.battleMode})`)
      }

      await roomEnvironment(isCurrent)
      if (!isCurrent()) return false
      environmentReady = true

      const client = battleClientStore._instance as unknown as BattleClient
      if (!client) {
        throw new Error('BattleClient instance not available')
      }

      // Mutate internal client state for routing (state is private on BattleClient)
      const mutableClient = client as unknown as { state?: Record<string, unknown> }
      if (mutableClient.state) {
        mutableClient.state = {
          ...mutableClient.state,
          matchmaking: 'matched',
          battle: 'active',
          roomId: battleStartInfo.battleRoomId,
        }
      }

      const battleStore = useBattleStore()
      if (recoveredState)
        await battleStore.initBattleWithState(
          new RemoteBattleSystem(client),
          battleClientStore.playerId,
          recoveredState,
          isCurrent,
        )
      else await battleStore.initBattle(new RemoteBattleSystem(client), battleClientStore.playerId, 'online', isCurrent)
      if (!isCurrent()) return false

      if (isSwitchingServer.value || !environmentReady) return false
      await router.push({
        path: '/battle',
        query: {
          roomId: battleStartInfo.battleRoomId,
          privateRoom: 'true',
          roomCode: currentRoom.value?.config.roomCode,
          ...(currentRoom.value?.matchmaking && { matchmaking: 'true' }),
          ...(isSpectator.value && { spectate: 'true' }),
        },
      })
      return true
    } catch (battleStartError) {
      if (!isCurrent()) return false
      console.error('❌ Failed to initialize battle for private room:', battleStartError)
      if (battleStartInfo.battleMode === 'p2p') {
        await teardownPeerTransport()
        if (!isCurrent()) return false
        const errorMessage = battleStartError instanceof Error ? battleStartError.message : 'P2P 对战初始化失败'
        error.value = errorMessage
        const now = Date.now()
        if (errorMessage !== lastP2PInitErrorMessage || now - lastP2PInitErrorAt > 10_000) {
          ElNotification({
            title: 'P2P 对战启动失败',
            message: errorMessage,
            type: 'error',
            duration: 5000,
            position: 'top-right',
          })
          lastP2PInitErrorMessage = errorMessage
          lastP2PInitErrorAt = now
        }
        return false
      }

      if (isSwitchingServer.value || !environmentReady) return false
      await router.push({
        path: '/battle',
        query: {
          roomId: battleStartInfo.battleRoomId,
          privateRoom: 'true',
          roomCode: currentRoom.value?.config.roomCode,
          ...(isSpectator.value && { spectate: 'true' }),
        },
      })
      return false
    }
  }

  const handleBattleStarted = async (
    battleStartInfo: PrivateRoomBattleStartInfo,
    recoveredState?: BattleState,
    shouldResume: () => boolean = () => true,
  ): Promise<void> => {
    const battle = useBattleStore()
    if (battle.isOfflineBattle) return
    if (isSwitchingServer.value || !currentRoom.value || (battleStartInfo.battleMode === 'p2p' && isSpectator.value))
      return
    const roomId = battleStartInfo.battleRoomId ?? currentRoom.value?.battleRoomId ?? ''
    if (battleStartInFlight?.roomId === roomId) {
      await battleStartInFlight.task
      return
    }
    if (roomId && initializedBattleRoomId === roomId && battle.battleInterface) return
    cancelPendingBattleStart()
    const controller = new AbortController()
    battleStartController = controller
    const generation = ++battleStartGeneration
    const scope = serverScope()
    const roomCode = currentRoom.value.config.roomCode
    const isCurrent = () =>
      !controller.signal.aborted &&
      !battle.isOfflineBattle &&
      generation === battleStartGeneration &&
      scope === serverScope() &&
      currentRoom.value?.config.roomCode === roomCode &&
      shouldResume()
    const task = initializeBattleStarted(battleStartInfo, isCurrent, controller.signal, recoveredState)
    battleStartInFlight = { roomId, task }
    try {
      if ((await task) && isCurrent() && roomId) initializedBattleRoomId = roomId
    } finally {
      if (battleStartController === controller) battleStartController = undefined
      if (battleStartInFlight?.task === task) battleStartInFlight = null
    }
  }

  const resumeActiveBattle = async (
    recoveredState?: BattleState,
    shouldResume: () => boolean = () => true,
  ): Promise<void> => {
    if (!currentRoom.value || currentRoom.value.status !== 'started') {
      return
    }

    const battleStartInfo = synthesizeBattleStartInfo(currentRoom.value)
    if (!battleStartInfo) {
      return
    }

    const battleStore = useBattleStore()
    if (battleStore.isOfflineBattle) return
    const currentRoute = router.currentRoute.value
    if (currentRoute.name === 'Battle' && battleStore.battleInterface) {
      const scope = serverScope(),
        roomCode = currentRoom.value.config.roomCode
      const battleInterface = battleStore.battleInterface
      const generation = battleStore._initializationGeneration
      const isCurrent = () =>
        shouldResume() &&
        scope === serverScope() &&
        currentRoom.value?.config.roomCode === roomCode &&
        battleStore.battleInterface === battleInterface &&
        battleStore._initializationGeneration === generation
      await roomEnvironment(isCurrent)
      if (!isCurrent()) return
      if (recoveredState) {
        battleStore.battleState = recoveredState
        battleStore.lastProcessedSequenceId = recoveredState.sequenceId ?? -1
        if (recoveredState.status === 'Ended' || !battleStore.playerId) {
          battleStore.availableActions = []
          battleStore.waitingForResponse = false
          return
        }
        try {
          const availableActions = await battleStore.fetchAvailableSelection(isCurrent)
          if (!isCurrent()) return
          battleStore.availableActions = availableActions
          battleStore.waitingForResponse = false
          battleStore.errorMessage = null
        } catch (error) {
          if (!isCurrent()) return
          console.warn('Failed to refresh available actions after reconnect:', error)
        }
        const client = battleClientStore._instance as unknown as BattleClient
        try {
          await client.refreshTimerSnapshotsFromServer?.()
        } catch (error) {
          if (isCurrent()) console.warn('Failed to refresh timer snapshots after reconnect:', error)
        }
      }
      return
    }

    await handleBattleStarted(battleStartInfo, recoveredState, shouldResume)
  }

  const maybeResumeActiveBattle = async (throttleMs = 3000): Promise<void> => {
    if (!currentRoom.value || currentRoom.value.status !== 'started') {
      return
    }
    if (isOnPrivateBattleRoute()) {
      return
    }
    if (resumeBattleInFlight) {
      return
    }

    const now = Date.now()
    if (now - lastResumeAttemptAt < throttleMs) {
      return
    }

    lastResumeAttemptAt = now
    resumeBattleInFlight = resumeActiveBattle()
      .catch(error => {
        console.warn('Failed to resume active private-room battle:', error)
      })
      .finally(() => {
        resumeBattleInFlight = null
      })

    await resumeBattleInFlight
  }

  const startRoomPolling = (): void => {
    stopRoomPolling()
    roomPollTimer = setInterval(async () => {
      const roomCode = currentRoom.value?.config.roomCode
      if (!roomCode) {
        stopRoomPolling()
        return
      }

      try {
        const scope = serverScope()
        const latestRoom = await battleClientStore.getPrivateRoomInfo(roomCode)
        assertServerScope(scope)
        if (currentRoom.value?.config.roomCode !== roomCode) return
        if (!latestRoom) {
          stopRoomPolling()
          cleanup()
          return
        }
        const previousStatus = currentRoom.value?.status
        currentRoom.value = latestRoom
        await ensureP2PBattleHostAvailable()

        if (latestRoom.status === 'started' && previousStatus !== 'started') {
          const battleStartInfo = synthesizeBattleStartInfo(latestRoom)
          if (battleStartInfo) {
            await handleBattleStarted(battleStartInfo)
          }
        } else if (latestRoom.status === 'started') {
          await maybeResumeActiveBattle()
        }
      } catch (pollError) {
        console.warn('Failed to poll private room info:', pollError)
      }
    }, 1500)
  }

  const handleRoomEvent = async (event: PrivateRoomEvent): Promise<void> => {
    switch (event.type) {
      case 'playerJoined':
        if (currentRoom.value) {
          currentRoom.value.players.push(event.data)
        }
        break

      case 'playerLeft':
        if (currentRoom.value) {
          currentRoom.value.players = currentRoom.value.players.filter(p => p.playerId !== event.data.playerId)
          await ensureP2PBattleHostAvailable()
        }
        break

      case 'playerKicked':
        if (currentRoom.value) {
          // 移除被踢的玩家或观战者
          currentRoom.value.players = currentRoom.value.players.filter(p => p.playerId !== event.data.playerId)
          currentRoom.value.spectators = currentRoom.value.spectators.filter(s => s.playerId !== event.data.playerId)

          // 如果被踢的是当前用户，显示消息并跳转到大厅
          if (event.data.playerId === battleClientStore.playerId) {
            // 显示通知提示
            ElNotification({
              title: '被踢出房间',
              message: '您已被房主踢出房间',
              type: 'error',
              duration: 5000,
              position: 'top-right',
            })

            try {
              await ElMessageBox.alert('您已被房主踢出房间，将返回匹配大厅', '被踢出房间', {
                confirmButtonText: '确定',
                type: 'error',
                showClose: false,
              })
            } catch {
              // 用户可能直接关闭了对话框，继续执行后续逻辑
            }

            // 清理房间状态
            cleanup()

            // 检查当前页面是否在房间内，如果是则导航回大厅
            const currentRoute = router.currentRoute.value
            if (currentRoute.name === 'PrivateRoom' || currentRoute.path.startsWith('/room/')) {
              router.push({ name: 'Lobby' })
            }
          }
        }
        break

      case 'playerReady':
        if (currentRoom.value) {
          const player = currentRoom.value.players.find(p => p.playerId === event.data.playerId)
          if (player) {
            player.isReady = event.data.isReady
          }
        }
        break

      case 'spectatorJoined':
        if (currentRoom.value) {
          currentRoom.value.spectators.push(event.data)
        }
        break

      case 'spectatorLeft':
        if (currentRoom.value) {
          currentRoom.value.spectators = currentRoom.value.spectators.filter(s => s.playerId !== event.data.playerId)
        }
        break

      case 'roomUpdate':
        currentRoom.value = event.data
        await ensureP2PBattleHostAvailable()
        if (event.data.status === 'started') {
          await maybeResumeActiveBattle()
        }
        break

      case 'battleStarted':
        await handleBattleStarted(event.data)
        break

      case 'peerSignal':
        handlePeerSignal(event.data)
        break

      case 'battleFinished': {
        const result = event.data.battleResult
        const room = currentRoom.value
        if (
          !room ||
          room.config.battleMode !== 'p2p' ||
          room.battleRoomId !== result.battleRoomId ||
          result.reason !== 'environment_runtime_failed'
        )
          break
        cancelPendingBattleStart()
        const battle = useBattleStore()
        if (battle.isOfflineBattle) {
          await teardownPeerTransport()
          break
        }
        await Promise.all([battle.resetBattleWithoutSurrender(), teardownPeerTransport()])
        if (
          currentRoom.value?.id !== room.id ||
          (currentRoom.value.battleRoomId && currentRoom.value.battleRoomId !== result.battleRoomId)
        )
          break
        ElNotification({ title: '本场对战中止', message: '对战环境执行失败，可以返回房间重新准备。', type: 'warning' })
        await router.push('/room/' + encodeURIComponent(room.config.roomCode))
        break
      }

      case 'playerSwitchedToSpectator':
        // 房间状态会通过后续的 roomUpdate 事件更新
        break

      case 'spectatorSwitchedToPlayer':
        break

      case 'ruleSetChanged':
        break

      case 'roomConfigChanged':
        // 房间信息会通过 roomUpdate 事件更新，同时更新本地配置表单
        initializeRoomConfigForm()
        break

      case 'roomClosed':
        cleanup()
        if (event.data.reason === 'MATCH_FINISHED' || useBattleStore().isOfflineBattle) break
        if (event.data.reason === 'ADMIN_TERMINATED')
          ElNotification({ title: '对战已中断', message: '服务器管理员终止了这场对战，不计胜负。', type: 'info' })
        router.push('/')
        break
    }
  }

  const handlePeerSignal = (event: PrivateRoomPeerSignalEvent): void => {
    if (!currentRoom.value || currentRoom.value.config.roomCode !== event.roomCode) {
      return
    }
    if (event.battleRoomId !== undefined && event.battleRoomId !== currentRoom.value.battleRoomId) return
    peerSignals.value.push(event)
    peerSession.value = pushPrivateRoomPeerSignal(peerSession.value, event)
    if (event.signal.kind === 'ready') {
      peerSession.value = markPrivateRoomPeerReady(peerSession.value, event.signal.transport)
    }
    if (peerBridgeReady) {
      const bridge = peerBridge
      void flushQueuedPeerSignals().catch(error => {
        if (peerBridge !== bridge) return
        markPeerFailed(error instanceof Error ? error.message : 'Failed to handle peer signal')
      })
    }
  }

  // 队伍管理方法
  const updateSelectedTeam = (team: PetSchemaType[], name = '', id?: string): void => {
    roomTeamDraft.value = undefined
    selectedTeam.value = copyTeam(team)
    selectedTeamName.value = name
    selectedTeamId.value = id
    // 如果已经准备了，更新队伍后自动取消准备
    if (myReadyStatus.value) {
      toggleReady().catch(err => {
        console.error('Failed to cancel ready after team update:', err)
      })
    }
  }

  /** Check seat membership before using a route's room code to resolve its immutable editor context. */
  const openRoomTeamEditor = async (code: string, isCurrent: () => boolean) => {
    const request = ++roomEditorRequest
    const scope = serverScope()
    const seat = battleClientStore.playerId
    const previousRoom = currentRoom.value?.id
    const live = () =>
      request === roomEditorRequest && isCurrent() && seat === battleClientStore.playerId && scope === serverScope()
    const room = await battleClientStore.getCurrentPrivateRoom()
    if (!live() || (currentRoom.value?.id !== previousRoom && currentRoom.value?.id !== room?.id))
      throw new DOMException('Room editor closed', 'AbortError')
    const player = room?.players.find(member => member.playerId === seat)
    if (!room || room.config.roomCode !== code || !player) throw new Error('你已不在这个房间的参战席位')
    if (!room.environment || room.status === 'started') throw new Error('当前房间无法编辑队伍')
    currentRoom.value = room
    const key = roomEditorKey.value!
    const current = () =>
      live() && roomEditorKey.value === key && isPlayer.value && currentRoom.value?.status !== 'started'
    if (roomTeamDraft.value?.key !== key) {
      const pets = selectedTeamName.value ? selectedTeam.value : (player.team ?? petStorageStore.getCurrentTeam())
      roomTeamDraft.value = {
        key,
        roomId: room.id,
        version: room.environment.gameplayRevision ?? room.environment.id,
        name: selectedTeamName.value || '本场队伍',
        pets: copyTeam(pets),
      }
    }
    await showRoomContent(current)
    if (!current()) throw new DOMException('Room editor closed', 'AbortError')
    startRoomPolling()
    return key
  }

  const applyRoomTeamDraft = async () => {
    const draft = roomTeamDraft.value
    const scope = serverScope()
    const current = () =>
      !!draft &&
      roomTeamDraft.value === draft &&
      draft.key === roomEditorKey.value &&
      currentRoom.value?.status !== 'started' &&
      isPlayer.value
    if (!draft || !current()) throw new Error('房间或队伍已变化，请重新打开')
    const pets = copyTeam(draft.pets)
    const environment = await roomEnvironment(current)
    if (!current() || !environment) throw new Error('房间已变化，请重新打开')
    const issues = validateBasicTeam(pets, gameDataStore)
    if (issues.length) throw new Error(issues.join('、'))
    if (personalEnvironment.value && currentRoom.value?.personalEnvironment)
      validatePersonalEnvironmentTeam(personalEnvironment.value, pets)
    await battleClientStore.submitRoomTeam({
      roomId: draft.roomId,
      seatId: battleClientStore.playerId,
      environment,
      team: pets,
    })
    assertServerScope(scope)
    if (!current()) throw new Error('房间已变化，请重新打开')
    selectedTeam.value = pets
    selectedTeamName.value = draft.name
    selectedTeamId.value = undefined
  }

  const initializeSelectedTeam = (): void => {
    const accepted = currentRoom.value?.players.find(player => player.playerId === battleClientStore.playerId)?.team
    if (accepted) {
      selectedTeam.value = copyTeam(accepted)
      selectedTeamName.value = '本场队伍'
      selectedTeamId.value = undefined
    } else {
      selectedTeam.value = petStorageStore.getCurrentTeam()
    }
  }

  // 全局状态检查方法
  const checkCurrentRoom = async (isCurrent: () => boolean = () => true): Promise<PrivateRoomInfo | null> => {
    const scope = serverScope()
    try {
      const roomInfo = await battleClientStore.getCurrentPrivateRoom()
      assertServerScope(scope)
      if (roomInfo && isCurrent()) {
        currentRoom.value = roomInfo
        if (!roomInfo.personalEnvironment || personalEnvironmentReady.value) await showRoomContent(isCurrent)
        assertServerScope(scope)
        startRoomPolling()
        if (!selectedTeamName.value) initializeSelectedTeam()
      }
      return roomInfo
    } catch {
      return null
    }
  }

  const restoreServerBattle = async (
    roomId: string,
    recoveredState: BattleState,
    shouldResume: () => boolean,
  ): Promise<boolean> => {
    const scope = serverScope()
    const room = currentRoom.value ?? (await checkCurrentRoom(shouldResume))
    if (!shouldResume() || scope !== serverScope()) return true
    if (!room) return false
    if (room.battleRoomId !== roomId || room.status !== 'started') return true
    await resumeActiveBattle(recoveredState, shouldResume)
    return true
  }

  // 页面离开时的清理
  const handlePageLeave = async (): Promise<void> => {
    if (isOnPrivateBattleRoute()) return
    // 如果已准备，自动取消准备
    if (myReadyStatus.value && (currentRoom.value?.status === 'waiting' || currentRoom.value?.status === 'ready')) {
      try {
        await toggleReady()
      } catch (err) {
        console.error('Failed to cancel ready on page leave:', err)
      }
    }
  }

  // 完全清理房间状态（只在真正离开房间时使用）
  const cleanup = (): void => {
    ++roomEditorRequest
    ++matchmakingEnvironmentGeneration
    cancelPendingBattleStart()
    battleStartGeneration++
    stopRoomPolling()
    void teardownPeerTransport()
    currentRoom.value = null
    cancelEnvironmentRequests()
    environmentCatalogGeneration++
    environments.value = []
    gameDataStore.clearServerEnvironment()
    selectedTeam.value = []
    selectedTeamName.value = ''
    selectedTeamId.value = undefined
    roomTeamDraft.value = undefined
    peerSignals.value = []
    peerSession.value = closePrivateRoomPeerSession()
    error.value = null
    isLoading.value = false
    resumeBattleInFlight = null
    battleStartInFlight = null
    initializedBattleRoomId = null
    lastResumeAttemptAt = 0
    lastP2PInitErrorMessage = null
    lastP2PInitErrorAt = 0
  }

  // Event handlers can be registered before the authenticated socket is connected.
  battleClientStore.on('privateRoomEvent', handleRoomEvent)
  battleClientStore.on('privateRoomPeerSignal', handlePeerSignal)

  return {
    // 状态
    currentRoom,
    personalEnvironment,
    personalEnvironmentReady,
    environments,
    defaultEnvironment,
    selectedTeam,
    selectedTeamName,
    selectedTeamId,
    roomTeamDraft,
    roomEditorKey,
    openRoomTeamEditor,
    applyRoomTeamDraft,
    peerSignals,
    peerSession,
    isLoading,
    isSwitchingServer,
    error,
    roomConfigForm,

    // 计算属性
    players,
    spectators,
    isHost,
    isPlayer,
    isSpectator,
    myReadyStatus,
    canStartBattle,
    isBattleInProgress,
    isP2PBattle,

    // 方法
    createRoom,
    setPersonalEnvironment,
    refreshEnvironments,
    stopQueueMedia: queueMedia.stop,
    joinMatchmaking,
    cancelMatchmaking,
    cancelMatchmakingPreparation,
    prepareMatchmakingEnvironment,
    joinRoom,
    joinAsSpectator,
    leaveRoom,
    switchServer,
    toggleReady,
    startBattle,
    updateRuleSet,
    updateRoomConfig,
    transferHost,
    kickPlayer,
    initializeRoomConfigForm,
    switchToSpectator,
    switchToPlayer,
    getRoomInfo,
    sendPeerSignal,
    consumePeerSignals,
    markPeerConnected,
    markPeerFailed,
    updateSelectedTeam,
    initializeSelectedTeam,
    checkCurrentRoom,
    resumeActiveBattle,
    restoreServerBattle,
    handlePageLeave,
    cleanup,
    joinSpectateBattle,
  }
})
