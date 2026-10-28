import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleClientStore } from './battleClient'
import { useAuthStore } from './auth'
import { usePlayerStore } from './player'
import { usePetStorageStore } from './petStorage'
import { DEFAULT_TIMER_CONFIG, BattleMessageType, type playerId } from '@arcadia-eternity/const'
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
import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { listServerEnvironments, prepareServerEnvironment } from '@/services/serverEnvironment'
import { useServerStateStore } from '@/stores/serverState'

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
  const serverScope = () => `${battleClientStore.serverUrl}|${authStore.serverGeneration}`
  const assertServerScope = (scope: string) => {
    if (scope !== serverScope()) throw new Error('服务器连接已变化，请重试')
  }
  let preparedEnvironment: { key: string; task: ReturnType<typeof prepareServerEnvironment> } | null = null
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
      environmentCatalogGeneration++
      environments.value = []
      preparedEnvironment = null
      gameDataStore.clearServerEnvironment()
    },
  )
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const selectedTeam = ref<PetSchemaType[]>([]) // 当前选择的队伍
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
    if (
      runtime.coreBuildId !== nativeBuildIdentity.coreBuildId ||
      runtime.registryBuildId !== nativeBuildIdentity.registryBuildId
    )
      throw new Error('网页和服务器的对战版本不同，请刷新网页后重试')
    return runtime
  }

  const refreshEnvironments = async (): Promise<void> => {
    const generation = ++environmentCatalogGeneration
    const scope = serverScope()
    environments.value = []
    preparedEnvironment = null
    const items = await listServerEnvironments(battleClientStore.serverUrl)
    if (generation === environmentCatalogGeneration && scope === serverScope()) environments.value = items
  }

  const prepareMatchmakingEnvironment = async (environmentId?: string) => {
    const generation = ++matchmakingEnvironmentGeneration
    const scope = serverScope()
    const descriptor = environmentId
      ? environments.value.find(item => item.id === environmentId)
      : environments.value.find(item => !item.packages.length)
    if (!descriptor) throw new Error('对战内容不可用，请重新选择')
    const prepared = await prepareServerEnvironment(battleClientStore.serverUrl, descriptor)
    assertServerScope(scope)
    if (generation !== matchmakingEnvironmentGeneration) throw new Error('对战内容已变化，请重新选择')
    if (isSwitchingServer.value) throw new Error('正在切换服务器')
    gameDataStore.applyServerEnvironment(prepared.content)
    return { descriptor, ...prepared }
  }

  const cancelMatchmaking = async () => {
    ++matchmakingGeneration
    ++matchmakingEnvironmentGeneration
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
      await battleClientStore.joinMatchmaking({
        playerSchema: { id: battleClientStore.playerId, name: playerStore.player?.name ?? 'Player', team },
        environmentId: prepared.descriptor.id,
        environment: prepared.acceptance,
      })
      assertServerScope(scope)
    })

  const roomEnvironment = async (): Promise<ServerEnvironmentAcceptance | undefined> => {
    ++matchmakingEnvironmentGeneration
    const room = currentRoom.value
    const descriptor = room?.environment
    if (!room || room.config.battleMode !== 'server' || !descriptor?.packages.length) {
      gameDataStore.clearServerEnvironment()
      return undefined
    }
    const key = `${serverScope()}|${authStore.serverInfo?.bootId ?? ''}|${descriptor.id}|${descriptor.resourceRevision}`
    if (!preparedEnvironment || preparedEnvironment.key !== key)
      preparedEnvironment = { key, task: prepareServerEnvironment(battleClientStore.serverUrl, descriptor) }
    const entry = preparedEnvironment
    let prepared: Awaited<typeof entry.task>
    try {
      prepared = await entry.task
    } catch (error) {
      if (preparedEnvironment === entry) preparedEnvironment = null
      throw error
    }
    const active = currentRoom.value?.environment
    const activeKey =
      active && `${serverScope()}|${authStore.serverInfo?.bootId ?? ''}|${active.id}|${active.resourceRevision}`
    if (activeKey !== key || preparedEnvironment !== entry) throw new Error('房间环境已变化，请重新准备')
    gameDataStore.applyServerEnvironment(prepared.content)
    return prepared.acceptance
  }

  const createRoom = (config: CreatePrivateRoomRequest['config'], environmentId?: string): Promise<string> =>
    admitRoom(async () => {
      const scope = serverScope()
      isLoading.value = true
      error.value = null

      let createdRoomCode: string | undefined
      try {
        const roomCode = await battleClientStore.createPrivateRoom({
          config,
          ...(environmentId && config.battleMode !== 'p2p' ? { environmentId } : {}),
          ...(config.battleMode === 'p2p' ? { expectedRuntime: expectedRuntime() } : {}),
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
    preferredView?: 'player1' | 'player2' | 'god',
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
    const generation = ++serverSwitchGeneration
    ++matchmakingGeneration
    isSwitchingServer.value = true
    try {
      await Promise.allSettled([...roomAdmissions])
      if (generation !== serverSwitchGeneration) return
      if (battleClientStore.currentState.matchmaking === 'searching') await battleClientStore.cancelMatchmaking()
      const hadBattle = currentRoom.value?.status === 'started' || !!battleStartInFlight
      if (currentRoom.value) await leaveRoom()
      if (generation !== serverSwitchGeneration) return
      if (hadBattle) await useBattleStore().resetBattleWithoutSurrender()
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
      const teamToSubmit = myReadyStatus.value ? undefined : selectedTeam.value
      const acceptance = myReadyStatus.value ? undefined : await roomEnvironment()
      assertServerScope(scope)
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
      // 如果房主是玩家，传递房主队伍；如果房主是观战者，传递空数组或undefined
      const hostTeam = isPlayer.value ? selectedTeam.value : []
      const acceptance = await roomEnvironment()
      assertServerScope(scope)
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

        await battleStore.initBattle(new RemoteBattleSystem(client), battleClientStore.playerId)
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

  const getRoomInfo = async (roomCode: string): Promise<void> => {
    const scope = serverScope()
    try {
      const response = await battleClientStore.getPrivateRoomInfo(roomCode)
      assertServerScope(scope)
      currentRoom.value = response
      if (response) await roomEnvironment()
      assertServerScope(scope)
    } catch (err) {
      throw err
    }
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
    battleStore.errorMessage = errorMessage
    markPeerFailed(errorMessage)
    await teardownPeerTransport()
    ElNotification({
      title: '对战中断',
      message: errorMessage,
      type: 'warning',
      duration: 5000,
      position: 'top-right',
    })
    await router.push(`/room/${currentRoom.value.config.roomCode}`)
  }

  const sendPeerSignal = async (
    targetPlayerId: string,
    signal: PrivateRoomPeerSignalPayload,
    targetSessionId?: string,
  ): Promise<void> => {
    if (!currentRoom.value) {
      throw new Error('当前不在私人房间中')
    }

    await battleClientStore.sendPrivateRoomPeerSignal({
      targetPlayerId,
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
        await sendPeerSignal(remotePeer.playerId, signal)
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

  const initializeP2PBattleRuntime = async (isCurrent: () => boolean): Promise<void> => {
    if (!currentRoom.value) {
      throw new Error('当前房间不存在')
    }
    if (!peerBridge || !peerTransport) {
      throw new Error('P2P transport 尚未建立')
    }
    if (peerSession.value.role === 'spectator' || peerSession.value.role === 'none') {
      throw new Error(`当前角色 ${peerSession.value.role} 暂不支持 P2P 对战`)
    }
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
    const battleInterface =
      peerSession.value.role === 'host'
        ? await (() => {
            const [playerA, playerB] = currentRoom.value!.players
            if (!playerA?.team || !playerB?.team) {
              throw new Error('P2P 房间缺少对战队伍数据')
            }
            const timerConfig = { ...DEFAULT_TIMER_CONFIG, ...currentRoom.value!.config.timerConfig }
            return createP2PHostBattleSystem({
              localPlayerId,
              remotePlayerId: remotePlayer.playerId as playerId,
              localPlayerName: playerStore.player.name,
              remotePlayerName: remotePlayer.playerName,
              localTeam: playerA.playerId === localPlayerId ? playerA.team : playerB.team,
              remoteTeam: playerA.playerId === localPlayerId ? playerB.team : playerA.team,
              dataStore: gameDataStore,
              bridge: peerBridge,
              transport: peerTransport,
              battleConfig: {
                allowFaintSwitch: currentRoom.value!.config.allowFaintSwitch ?? true,
                showHidden: currentRoom.value!.config.showHidden ?? false,
                timerConfig,
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
      const battleRoomId = currentRoom.value.battleRoomId
      let reported = false
      peerBattleEndUnsubscribe = battleInterface.BattleEvent(message => {
        if (
          !isCurrent() ||
          message.type !== BattleMessageType.BattleEnd ||
          reported ||
          currentRoom.value?.battleRoomId !== battleRoomId
        )
          return
        reported = true
        void battleClientStore._instance
          ?.finishPrivateRoomBattle({
            winner: message.data.winner ?? null,
            reason: message.data.reason ?? 'completed',
          })
          .catch(error => {
            reported = false
            console.error('Failed to finish P2P room:', error)
          })
      })
    }

    await battleStore.initBattle(battleInterface, localPlayerId, isCurrent)
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
  ): Promise<boolean> => {
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
        peerSession.value = preparePrivateRoomPeerSession(room, battleClientStore.playerId, battleStartInfo)
        await setupPeerTransport()
        if (!isCurrent()) return false

        if (!isSpectator.value) {
          await initializeP2PBattleRuntime(isCurrent)
          if (!isCurrent()) return false
        }

        if (isSwitchingServer.value) return false
        await router.push({
          path: '/battle',
          query: {
            privateRoom: 'true',
            roomCode: currentRoom.value?.config.roomCode,
            p2p: 'true',
            ...(isSpectator.value && { spectate: 'true' }),
          },
        })
        return true
      }

      if (!battleStartInfo.battleRoomId) {
        throw new Error(`battleRoomId missing for private room battle start (${battleStartInfo.battleMode})`)
      }

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
      await battleStore.initBattle(new RemoteBattleSystem(client), battleClientStore.playerId, isCurrent)
      if (!isCurrent()) return false

      if (isSwitchingServer.value) return false
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

      if (isSwitchingServer.value) return false
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

  const handleBattleStarted = async (battleStartInfo: PrivateRoomBattleStartInfo): Promise<void> => {
    if (isSwitchingServer.value || !currentRoom.value) return
    const roomId = battleStartInfo.battleRoomId ?? currentRoom.value?.battleRoomId ?? ''
    if (battleStartInFlight?.roomId === roomId) {
      await battleStartInFlight.task
      return
    }
    if (roomId && initializedBattleRoomId === roomId && useBattleStore().battleInterface) return
    const generation = ++battleStartGeneration
    const scope = serverScope()
    const roomCode = currentRoom.value.config.roomCode
    const isCurrent = () =>
      generation === battleStartGeneration && scope === serverScope() && currentRoom.value?.config.roomCode === roomCode
    const task = initializeBattleStarted(battleStartInfo, isCurrent)
    battleStartInFlight = { roomId, task }
    try {
      if ((await task) && isCurrent() && roomId) initializedBattleRoomId = roomId
    } finally {
      if (battleStartInFlight?.task === task) battleStartInFlight = null
    }
  }

  const resumeActiveBattle = async (): Promise<void> => {
    if (!currentRoom.value || currentRoom.value.status !== 'started') {
      return
    }

    const battleStartInfo = synthesizeBattleStartInfo(currentRoom.value)
    if (!battleStartInfo) {
      return
    }

    const battleStore = useBattleStore()
    const currentRoute = router.currentRoute.value
    if (currentRoute.name === 'Battle' && battleStore.battleInterface) {
      return
    }

    await handleBattleStarted(battleStartInfo)
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
            } catch (error) {
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

      case 'battleFinished':
        // 战斗结束，房间状态将通过 roomUpdate 事件同步
        break

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
        if (event.data.reason === 'MATCH_FINISHED') break
        router.push('/')
        break
    }
  }

  const handlePeerSignal = (event: PrivateRoomPeerSignalEvent): void => {
    if (!currentRoom.value || currentRoom.value.config.roomCode !== event.roomCode) {
      return
    }
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
  const updateSelectedTeam = (team: PetSchemaType[]): void => {
    selectedTeam.value = team
    // 如果已经准备了，更新队伍后自动取消准备
    if (myReadyStatus.value) {
      toggleReady().catch(err => {
        console.error('Failed to cancel ready after team update:', err)
      })
    }
  }

  const initializeSelectedTeam = (): void => {
    // 初始化时使用当前队伍
    selectedTeam.value = petStorageStore.getCurrentTeam()
  }

  // 全局状态检查方法
  const checkCurrentRoom = async (): Promise<PrivateRoomInfo | null> => {
    const scope = serverScope()
    try {
      const roomInfo = await battleClientStore.getCurrentPrivateRoom()
      assertServerScope(scope)
      if (roomInfo) {
        currentRoom.value = roomInfo
        await roomEnvironment()
        assertServerScope(scope)
        startRoomPolling()
        initializeSelectedTeam()
      }
      return roomInfo
    } catch (err) {
      return null
    }
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
    ++matchmakingEnvironmentGeneration
    battleStartGeneration++
    stopRoomPolling()
    void teardownPeerTransport()
    currentRoom.value = null
    preparedEnvironment = null
    environmentCatalogGeneration++
    environments.value = []
    gameDataStore.clearServerEnvironment()
    selectedTeam.value = []
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
    environments,
    selectedTeam,
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
    refreshEnvironments,
    joinMatchmaking,
    cancelMatchmaking,
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
    handlePageLeave,
    cleanup,
    joinSpectateBattle,
  }
})
