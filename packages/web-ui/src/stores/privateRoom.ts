import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleClientStore } from './battleClient'
import { usePlayerStore } from './player'
import { usePetStorageStore } from './petStorage'
import { DEFAULT_TIMER_CONFIG, type TimerConfig, type playerId } from '@arcadia-eternity/const'
import type {
  CreatePrivateRoomRequest,
  PrivateRoomEvent,
  PrivateRoomInfo,
  PrivateRoomPeerSignalEvent,
  PrivateRoomPeerSignalPayload,
} from '@arcadia-eternity/protocol'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { BattleRuleManager } from '@arcadia-eternity/rules'

import { ElMessageBox, ElNotification } from 'element-plus'
import { useBattleStore } from './battle'
import { RemoteBattleSystem } from '@arcadia-eternity/client'
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

type P2PTransportMode = 'auto' | 'webrtc' | 'relay'

const buildRoomPeerTransportId = (roomCode: string, playerId: string): string => {
  const raw = `ae-${roomCode}-${playerId}`
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '')
  return sanitized.length > 0 ? sanitized : `ae-${roomCode}`
}

const resolvePeerBrokerConfig = () => {
  const apiBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_WS_URL || window.location.origin
  const url = new URL(apiBase, window.location.origin)
  const configuredPath = (import.meta.env.VITE_PEERJS_PATH || '/peerjs').trim()
  const peerPath = configuredPath.startsWith('/') ? configuredPath : `/${configuredPath}`
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    path: peerPath,
    secure: url.protocol === 'https:',
  }
}

const resolveP2PTimerConfig = (ruleSetId: string): Partial<TimerConfig> => {
  try {
    const manager = new BattleRuleManager([ruleSetId])
    return {
      ...manager.getRecommendedTimerConfig(),
      enabled: true,
    }
  } catch {
    return {
      ...DEFAULT_TIMER_CONFIG,
      enabled: true,
    }
  }
}

export const usePrivateRoomStore = defineStore('privateRoom', () => {
  const router = useRouter()
  const battleClientStore = useBattleClientStore()
  const playerStore = usePlayerStore()
  const petStorageStore = usePetStorageStore()
  const gameDataStore = useGameDataStore()

  // 状态
  const currentRoom = ref<PrivateRoomInfo | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const selectedTeam = ref<PetSchemaType[]>([]) // 当前选择的队伍
  const peerSignals = ref<PrivateRoomPeerSignalEvent[]>([])
  const peerSession = ref<PrivateRoomPeerSessionState>(createInitialPrivateRoomPeerSessionState())
  let peerTransport: PeerTransport | null = null
  let peerBridge: PrivateRoomSignalBridge | null = null
  let peerBattleSnapshotUnsubscribe: (() => void) | null = null
  let roomPollTimer: ReturnType<typeof setInterval> | null = null
  let resumeBattleInFlight: Promise<void> | null = null
  let lastResumeAttemptAt = 0
  let lastP2PInitErrorMessage: string | null = null
  let lastP2PInitErrorAt = 0

  // 计算属性
  const players = computed(() => currentRoom.value?.players || [])
  const spectators = computed(() => currentRoom.value?.spectators || [])
  const isHost = computed(() => currentRoom.value?.config.hostPlayerId === playerStore.player.id)
  const isPlayer = computed(() => players.value.some(p => p.playerId === playerStore.player.id))
  const isSpectator = computed(() => spectators.value.some(s => s.playerId === playerStore.player.id))
  const myReadyStatus = computed(() => {
    const me = players.value.find(p => p.playerId === playerStore.player.id)
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

    if (import.meta.env.MODE === 'test' || navigator.webdriver) {
      return 'relay'
    }

    return 'webrtc'
  }

  // 方法
  const createRoom = async (config: CreatePrivateRoomRequest['config']): Promise<string> => {
    isLoading.value = true
    error.value = null

    try {
      const roomCode = await battleClientStore.createPrivateRoom({
        config,
      })

      // 获取房间信息
      await getRoomInfo(roomCode)
      startRoomPolling()
      return roomCode
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const joinRoom = async (roomCode: string, password?: string): Promise<void> => {
    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.joinPrivateRoom({
        roomCode,
        password,
      })

      // 获取房间信息
      await getRoomInfo(roomCode)
      startRoomPolling()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const joinAsSpectator = async (roomCode: string, preferredView?: 'player1' | 'player2' | 'god'): Promise<void> => {
    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.joinPrivateRoomAsSpectator({
        roomCode,
      })

      // 获取房间信息
      await getRoomInfo(roomCode)
      startRoomPolling()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const leaveRoom = async (): Promise<void> => {
    if (!currentRoom.value) return

    isLoading.value = true
    error.value = null

    try {
      await battleClientStore.leavePrivateRoom()
      cleanup()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      error.value = errorMessage
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const toggleReady = async (): Promise<void> => {
    if (!currentRoom.value || !isPlayer.value) return

    isLoading.value = true
    error.value = null

    try {
      // 如果要准备，使用当前选择的队伍；如果取消准备，不传队伍
      const teamToSubmit = myReadyStatus.value ? undefined : selectedTeam.value
      await battleClientStore.toggleRoomReady(teamToSubmit)
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
      // 发送开始战斗请求
      // 如果房主是玩家，传递房主队伍；如果房主是观战者，传递空数组或undefined
      const hostTeam = isPlayer.value ? selectedTeam.value : []
      await battleClientStore.startRoomBattle(hostTeam)

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

  const updateRoomConfig = async (configUpdates: {
    ruleSetId?: string
    isPrivate?: boolean
    password?: string
  }): Promise<void> => {
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
        battleStore.battleInterface && battleClientStore._instance && battleStore.playerId === playerStore.player.id

      if (!hasValidBattleConnection) {
        // 只有在没有有效连接时才重新建立连接
        await battleClientStore.joinSpectateBattle(currentRoom.value.battleRoomId)

        if (!battleClientStore._instance) {
          throw new Error('BattleClient 实例尚未初始化')
        }

        await battleStore.initBattle(new RemoteBattleSystem(battleClientStore._instance as any), playerStore.player.id)
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

  const switchToPlayer = async (team: any[]): Promise<void> => {
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
    try {
      const response = await battleClientStore.getPrivateRoomInfo(roomCode)
      currentRoom.value = response
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

    if (currentRoom.value.config.battleMode === 'p2p' && currentRoom.value.status === 'started') {
      try {
        currentRoom.value = await battleClientStore.getPrivateRoomInfo(currentRoom.value.config.roomCode)
      } catch (error) {
        console.warn('Failed to refresh room info before sending peer signal:', error)
      }
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
    if (!peerBridge) return
    const queuedSignals = consumePeerSignals()
    for (const event of queuedSignals) {
      await peerBridge.handleSignal(event)
    }
  }

  const teardownPeerTransport = async (): Promise<void> => {
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
            localPeerId: buildRoomPeerTransportId(currentRoom.value.config.roomCode, playerStore.player.id),
            broker: resolvePeerBrokerConfig(),
          })
    transport.onStateChange(state => {
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
        await sendPeerSignal(remotePeer.playerId, signal)
      },
    })

    peerTransport = transport
    peerBridge = bridge

    try {
      await bridge.connect(
        peerSession.value.role === 'host' ? 'host' : 'peer',
        transportMode === 'relay'
          ? remotePeer.playerId
          : buildRoomPeerTransportId(currentRoom.value.config.roomCode, remotePeer.playerId),
      )
      await flushQueuedPeerSignals()
    } catch (error) {
      peerBridge = null
      peerTransport = null
      markPeerFailed(error instanceof Error ? error.message : 'Failed to connect peer transport')
      throw error
    }
  }

  const initializeP2PBattleRuntime = async (): Promise<void> => {
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
      gameDataStore.gameDataLoaded = true
    }

    const battleStore = useBattleStore()
    const localPlayerId = playerStore.player.id as playerId
    const remotePlayer = currentRoom.value.players.find(player => player.playerId !== localPlayerId)
    if (!remotePlayer) {
      throw new Error('P2P 房间中未找到对手')
    }
    const battleInterface =
      peerSession.value.role === 'host'
        ? (() => {
            const [playerA, playerB] = currentRoom.value!.players
            if (!playerA?.team || !playerB?.team) {
              throw new Error('P2P 房间缺少对战队伍数据')
            }
            const timerConfig = resolveP2PTimerConfig(currentRoom.value!.config.ruleSetId)
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
                allowFaintSwitch: true,
                showHidden: false,
                timerConfig,
              },
            })
          })()
        : new P2PPeerBattleSystem(localPlayerId, peerBridge, peerTransport)

    if (battleInterface instanceof P2PPeerBattleSystem) {
      const battleStore = useBattleStore()
      peerBattleSnapshotUnsubscribe = battleInterface.onSnapshot(({ battleState, availableSelections }) => {
        battleStore.replaceP2PPeerState(battleState, availableSelections)
      })
    }

    await battleStore.initBattle(battleInterface, localPlayerId)

    if (peerSession.value.role === 'host') {
      await battleStore.ready()
    }

    if (battleInterface instanceof P2PPeerBattleSystem) {
      void (async () => {
        const recoveryDeadline = Date.now() + 15_000
        while (
          battleStore.availableActions.length === 0 &&
          battleStore.battleState?.status === 'On' &&
          Date.now() < recoveryDeadline
        ) {
          const [battleState, availableSelections] = await Promise.all([
            battleInterface.getState(),
            battleInterface.getAvailableSelection(localPlayerId),
          ])

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

  const handleBattleStarted = async (battleStartInfo: PrivateRoomBattleStartInfo): Promise<void> => {
    try {
      if (currentRoom.value && battleStartInfo.battleMode === 'p2p') {
        const roomCode = currentRoom.value.config.roomCode
        const latestRoom = await battleClientStore.getPrivateRoomInfo(roomCode)
        if (latestRoom) {
          currentRoom.value = latestRoom
        }

        await teardownPeerTransport()
        peerSession.value = preparePrivateRoomPeerSession(currentRoom.value, playerStore.player.id, battleStartInfo)
        await setupPeerTransport()

        if (!isSpectator.value) {
          await initializeP2PBattleRuntime()
        }

        router.push({
          path: '/battle',
          query: {
            privateRoom: 'true',
            roomCode: currentRoom.value?.config.roomCode,
            p2p: 'true',
            ...(isSpectator.value && { spectate: 'true' }),
          },
        })
        return
      }

      if (!battleStartInfo.battleRoomId) {
        throw new Error(`battleRoomId missing for private room battle start (${battleStartInfo.battleMode})`)
      }

      if (!battleClientStore._instance) {
        throw new Error('BattleClient instance not available')
      }

      const clientInstance = battleClientStore._instance as any
      if (clientInstance && clientInstance.state) {
        clientInstance.state = {
          ...clientInstance.state,
          matchmaking: 'matched',
          battle: 'active',
          roomId: battleStartInfo.battleRoomId,
        }
      }

      const battleStore = useBattleStore()
      await battleStore.initBattle(new RemoteBattleSystem(battleClientStore._instance as any), playerStore.player.id)

      router.push({
        path: '/battle',
        query: {
          roomId: battleStartInfo.battleRoomId,
          privateRoom: 'true',
          roomCode: currentRoom.value?.config.roomCode,
          ...(isSpectator.value && { spectate: 'true' }),
        },
      })
    } catch (battleStartError) {
      console.error('❌ Failed to initialize battle for private room:', battleStartError)
      if (battleStartInfo.battleMode === 'p2p') {
        await teardownPeerTransport()
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
        return
      }

      router.push({
        path: '/battle',
        query: {
          roomId: battleStartInfo.battleRoomId,
          privateRoom: 'true',
          roomCode: currentRoom.value?.config.roomCode,
          ...(isSpectator.value && { spectate: 'true' }),
        },
      })
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
        const latestRoom = await battleClientStore.getPrivateRoomInfo(roomCode)
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
          if (event.data.playerId === playerStore.player.id) {
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
    if (peerBridge) {
      void peerBridge.handleSignal(event).catch(error => {
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
    try {
      const roomInfo = await battleClientStore.getCurrentPrivateRoom()
      if (roomInfo) {
        currentRoom.value = roomInfo
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
    // 如果已准备，自动取消准备
    if (myReadyStatus.value) {
      try {
        await toggleReady()
      } catch (err) {
        console.error('Failed to cancel ready on page leave:', err)
      }
    }
  }

  // 完全清理房间状态（只在真正离开房间时使用）
  const cleanup = (): void => {
    stopRoomPolling()
    void teardownPeerTransport()
    currentRoom.value = null
    selectedTeam.value = []
    peerSignals.value = []
    peerSession.value = closePrivateRoomPeerSession()
    error.value = null
    isLoading.value = false
    resumeBattleInFlight = null
    lastResumeAttemptAt = 0
    lastP2PInitErrorMessage = null
    lastP2PInitErrorAt = 0
  }

  // 在 store 创建时设置事件监听器。
  // battleClient 的真实初始化必须等 playerStore 完成身份初始化后再做，
  // 否则会带着本地临时 guest id 提前建连，导致 socket middleware 判定 PLAYER_NOT_FOUND。
  battleClientStore.on('privateRoomEvent', handleRoomEvent)
  battleClientStore.on('privateRoomPeerSignal', handlePeerSignal)

  return {
    // 状态
    currentRoom,
    selectedTeam,
    peerSignals,
    peerSession,
    isLoading,
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
    joinRoom,
    joinAsSpectator,
    leaveRoom,
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
