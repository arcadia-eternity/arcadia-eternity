import {
  BattleClient,
  type CreatePrivateRoomData,
  type JoinPrivateRoomData,
  type JoinSpectatorData,
  type SendPrivateRoomPeerSignalData,
} from '@arcadia-eternity/client'
import type {
  PetSchemaType,
  PlayerSchemaType,
  PlayerSelectionSchemaType,
  PrivateRoomBattleStartInfo,
  PrivateRoomInfo,
  UpdatePrivateRoomConfigRequest,
  ServerEnvironmentAcceptance,
} from '@arcadia-eternity/protocol'
import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { useAuthStore } from './auth'
import { usePlayerStore } from './player'
const defaultServerUrl =
  import.meta.env.VITE_WS_URL ||
  import.meta.env.VITE_API_BASE_URL?.replace(/\/api\/v1\/?$/, '') ||
  'http://localhost:8102'

export const useBattleClientStore = defineStore('battleClient', () => {
  const authStore = useAuthStore()
  const playerId = computed(() => authStore.session?.seatId ?? '')

  type ServerWarmupState = 'idle' | 'waking' | 'ready' | 'failed'

  // 状态
  const _instance = shallowRef<BattleClient | null>(null)
  const selectedServerUrl = ref(authStore.hasSelectedServer ? authStore.serverUrl : defaultServerUrl)
  const serverUrl = computed(() => _instance.value?.serverUrl ?? selectedServerUrl.value)
  const _pendingEventHandlers = ref(new Map<string, Set<(...args: unknown[]) => void>>())
  let connectionGeneration = 0
  let handlersAttached = false
  let attachmentGeneration = 0
  const attachedHandlers = new Map<string, Map<(...args: unknown[]) => void, () => void>>()
  const warmupControllers = new Set<AbortController>()
  const isInitialized = ref(false)
  const serverWarmupState = ref<ServerWarmupState>('idle')
  const serverWarmupError = ref<string | null>(null)
  const initComplete = ref(false)

  // 响应式状态触发器
  const _stateUpdateTrigger = ref(0)

  // 计算属性
  const currentState = computed(() => {
    // 依赖触发器确保响应式更新

    _stateUpdateTrigger.value // 触发依赖追踪
    const state = _instance.value?.currentState || { status: 'disconnected', matchmaking: 'idle', battle: 'idle' }
    return state
  })

  const isConnected = computed(() => {
    return currentState.value.status === 'connected'
  })

  const isServerWaking = computed(() => {
    return serverWarmupState.value === 'waking'
  })

  const serverWarmupHint = computed(() => {
    switch (serverWarmupState.value) {
      case 'waking':
        return '服务器唤醒中（通常 5-10 秒）'
      case 'failed':
        return serverWarmupError.value || '服务器唤醒超时，请稍后再试'
      case 'ready':
        return '服务器已就绪'
      case 'idle':
      default:
        return ''
    }
  })

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  const resolveReadyUrl = (serverUrl: string): string => {
    const wsUrl = new URL(serverUrl, window.location.origin)
    if (wsUrl.protocol === 'ws:') wsUrl.protocol = 'http:'
    if (wsUrl.protocol === 'wss:') wsUrl.protocol = 'https:'
    wsUrl.pathname = `${wsUrl.pathname.replace(/\/+$/, '')}/health`
    wsUrl.search = ''
    wsUrl.hash = ''
    return wsUrl.toString()
  }

  const waitForServerReady = async (instance: BattleClient, generation: number, maxWaitMs = 10000): Promise<void> => {
    const assertCurrent = () => {
      if (_instance.value !== instance || connectionGeneration !== generation) throw new Error('连接已取消')
    }
    const readyUrl = resolveReadyUrl(instance.serverUrl)
    const startedAt = Date.now()
    serverWarmupState.value = 'waking'
    serverWarmupError.value = null

    while (Date.now() - startedAt < maxWaitMs) {
      assertCurrent()
      const controller = new AbortController()
      warmupControllers.add(controller)
      const timeout = setTimeout(() => controller.abort(), 3000)
      let response: Response | null = null

      try {
        response = await fetch(readyUrl, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        })
      } catch {
        // ignore network errors while server is warming up
      } finally {
        clearTimeout(timeout)
        warmupControllers.delete(controller)
      }
      assertCurrent()

      if (!response) {
        await delay(1000)
        continue
      }

      if (response.ok) {
        serverWarmupState.value = 'ready'
        serverWarmupError.value = null
        return
      }

      let state = 'starting'
      try {
        const body = await response.json()
        state = body?.state || state
      } catch {
        // ignore invalid json
      }
      assertCurrent()

      if (state === 'draining') {
        serverWarmupState.value = 'failed'
        serverWarmupError.value = '服务器正在重启中，请稍后重试'
        throw new Error(serverWarmupError.value)
      }

      await delay(1000)
    }

    assertCurrent()
    serverWarmupState.value = 'failed'
    serverWarmupError.value = '服务器唤醒超时（超过 10 秒）'
    throw new Error(serverWarmupError.value)
  }

  // 创建battleClient实例的函数
  const createBattleClient = (): BattleClient => {
    const playerStore = usePlayerStore()
    const authStore = useAuthStore()
    const authGeneration = authStore.serverGeneration
    const isCurrentAuth = () => authStore.serverGeneration === authGeneration

    return new BattleClient({
      serverUrl: serverUrl.value,
      socketPath: import.meta.env.VITE_SOCKET_IO_PATH || '/socket.io',
      actionTimeout: 10000,
      auth: {
        getToken: () => (isCurrentAuth() ? authStore.getAccessToken() : null),
        getPlayerId: () => (isCurrentAuth() ? (authStore.session?.seatId ?? '') : ''),
        getSessionId: () => (isCurrentAuth() ? (authStore.session?.sessionId ?? null) : null),
        refreshAuth: async () => {
          if (!isCurrentAuth()) throw new Error('连接已取消')
          await authStore.ensureSession({ id: playerStore.id, name: playerStore.name })
          if (!isCurrentAuth()) throw new Error('连接已取消')
        },
      },
    })
  }

  // 战斗重连处理器引用，用于防止重复注册
  type BattleReconnectData = {
    roomId: string
    shouldRedirect: boolean
    battleState: string
    fullBattleState?: Record<string, unknown>
  }
  let _battleReconnectHandler: ((data: BattleReconnectData) => void) | null = null

  // Actions
  const initialize = () => {
    if (isInitialized.value) {
      return
    }

    const instance = createBattleClient()
    _instance.value = instance
    isInitialized.value = true

    // 注册之前缓存的事件监听器
    registerPendingHandlers()
  }

  const connect = async () => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    const instance = _instance.value
    const generation = connectionGeneration
    const authGeneration = authStore.serverGeneration
    const assertCurrent = () => {
      if (
        _instance.value !== instance ||
        connectionGeneration !== generation ||
        authStore.serverGeneration !== authGeneration
      )
        throw new Error('连接已取消')
    }
    if (instance.currentState.status === 'connected') {
      serverWarmupState.value = 'ready'
      serverWarmupError.value = null
      return
    }
    await waitForServerReady(instance, generation)
    assertCurrent()
    const profile = usePlayerStore()
    await authStore.ensureSession({ id: profile.id, name: profile.name })
    assertCurrent()
    if (!handlersAttached) registerPendingHandlers()
    await instance.connect()
    assertCurrent()
  }

  const disconnect = () => {
    connectionGeneration++
    for (const controller of warmupControllers) controller.abort()
    warmupControllers.clear()
    for (const handlers of attachedHandlers.values()) for (const unsubscribe of handlers.values()) unsubscribe()
    if (_instance.value) {
      _instance.value.disconnect()
    }
    handlersAttached = false
    attachmentGeneration++
    attachedHandlers.clear()
    _stateUpdateTrigger.value++
    serverWarmupState.value = 'idle'
    serverWarmupError.value = null
  }

  const resetState = () => {
    if (_instance.value) {
      _instance.value.resetState()
    }
  }

  const reset = () => {
    if (_instance.value) {
      // 清理战斗重连监听器
      if (_battleReconnectHandler) {
        ;(_instance.value.off as (event: string, handler: (data: BattleReconnectData) => void) => void)(
          'battleReconnect',
          _battleReconnectHandler,
        )
        _battleReconnectHandler = null
      }
      disconnect()
      _instance.value = null
    }
    _pendingEventHandlers.value.clear()
    isInitialized.value = false
    serverWarmupState.value = 'idle'
    serverWarmupError.value = null
  }

  /** Replace the socket after the old room and auth scope have been released. */
  const replaceServer = (url: string) => {
    disconnect()
    _instance.value = null
    isInitialized.value = false
    selectedServerUrl.value = url
    _stateUpdateTrigger.value++
    initialize()
  }

  const markInitComplete = () => {
    initComplete.value = true
  }

  const joinMatchmaking = (data: PlayerSchemaType | { playerSchema: PlayerSchemaType; ruleSetId?: string }) => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    return _instance.value.joinMatchmaking(data)
  }

  const cancelMatchmaking = () => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    return _instance.value.cancelMatchmaking()
  }

  const sendplayerSelection = (selection: PlayerSelectionSchemaType) => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    return _instance.value.sendplayerSelection(selection)
  }

  const bindHandler = (instance: BattleClient, event: string, handler: (...args: unknown[]) => void) => {
    let bound = attachedHandlers.get(event)
    if (!bound) attachedHandlers.set(event, (bound = new Map()))
    if (bound.has(handler)) return
    const generation = attachmentGeneration
    const unsubscribe = (instance.on as (event: string, handler: (...args: unknown[]) => void) => () => void)(
      event,
      (...args) => {
        if (
          _instance.value === instance &&
          generation === attachmentGeneration &&
          _pendingEventHandlers.value.get(event)?.has(handler)
        )
          handler(...args)
      },
    )
    bound.set(handler, unsubscribe)
  }

  const on = (event: string, handler: unknown): (() => void) => {
    const fn = handler as (...args: unknown[]) => void
    if (!_pendingEventHandlers.value.has(event)) _pendingEventHandlers.value.set(event, new Set())
    _pendingEventHandlers.value.get(event)!.add(fn)
    if (_instance.value && handlersAttached) bindHandler(_instance.value, event, fn)
    return () => off(event, fn)
  }

  const off = (event: string, handler?: unknown) => {
    const handlers = _pendingEventHandlers.value.get(event)
    if (!handlers) return
    const bound = attachedHandlers.get(event)
    if (handler) {
      const fn = handler as (...args: unknown[]) => void
      handlers.delete(fn)
      bound?.get(fn)?.()
      bound?.delete(fn)
    } else {
      handlers.clear()
      for (const unsubscribe of bound?.values() ?? []) unsubscribe()
      bound?.clear()
    }
    if (!bound?.size) attachedHandlers.delete(event)
    if (!handlers.size) _pendingEventHandlers.value.delete(event)
  }

  const once = (event: string, handler: unknown) => {
    const fn = handler as (...args: unknown[]) => void
    const wrapped = (...args: unknown[]) => {
      off(event, wrapped)
      fn(...args)
    }
    return on(event, wrapped)
  }

  // 私人房间相关方法
  const createPrivateRoom = async (data: CreatePrivateRoomData): Promise<string> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.createPrivateRoom(data)
  }

  const joinPrivateRoom = async (data: JoinPrivateRoomData): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.joinPrivateRoom(data)
  }

  const leavePrivateRoom = async (): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.leavePrivateRoom()
  }

  const joinPrivateRoomAsSpectator = async (data: JoinSpectatorData): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.joinPrivateRoomAsSpectator(data)
  }

  const toggleRoomReady = async (team?: PetSchemaType[], environment?: ServerEnvironmentAcceptance): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.togglePrivateRoomReady(team, environment)
  }

  const startRoomBattle = async (
    hostTeam: PetSchemaType[],
    environment?: ServerEnvironmentAcceptance,
  ): Promise<PrivateRoomBattleStartInfo> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.startPrivateRoomBattle(hostTeam, environment)
  }

  const sendPrivateRoomPeerSignal = async (data: SendPrivateRoomPeerSignalData): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.sendPrivateRoomPeerSignal(data)
  }

  const getPrivateRoomInfo = async (roomCode: string): Promise<PrivateRoomInfo | null> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return (await _instance.value.getPrivateRoomInfo(roomCode)) as PrivateRoomInfo | null
  }

  const getCurrentPrivateRoom = async (): Promise<PrivateRoomInfo | null> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return (await _instance.value.getCurrentPrivateRoom()) as PrivateRoomInfo | null
  }

  const updatePrivateRoomRuleSet = async (data: { ruleSetId: string }): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.updatePrivateRoomRuleSet(data)
  }

  const updatePrivateRoomConfig = async (data: UpdatePrivateRoomConfigRequest): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.updatePrivateRoomConfig(data)
  }

  const transferPrivateRoomHost = async (targetPlayerId: string): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.transferPrivateRoomHost(targetPlayerId)
  }

  const kickPlayerFromPrivateRoom = async (targetPlayerId: string): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.kickPlayerFromPrivateRoom(targetPlayerId)
  }

  const switchToSpectator = async (): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.switchToSpectator()
  }

  const switchToPlayer = async (team: PetSchemaType[]): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.switchToPlayer(team)
  }

  const joinSpectateBattle = async (battleRoomId: string): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    return await _instance.value.joinSpectateBattle(battleRoomId)
  }

  const leaveSpectateBattle = async (): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    return await _instance.value.leaveSpectateBattle()
  }

  // Keep subscriptions across socket replacement; wrappers ignore events from detached sockets.
  const registerPendingHandlers = () => {
    const instance = _instance.value
    if (!instance || handlersAttached) return
    const generation = attachmentGeneration
    instance.onStateChange(() => {
      if (_instance.value === instance && generation === attachmentGeneration) _stateUpdateTrigger.value++
    })
    _battleReconnectHandler = data => {
      if (_instance.value !== instance || generation !== attachmentGeneration || !data.shouldRedirect) return
      if (data.fullBattleState) window.dispatchEvent(new CustomEvent('battleReconnect', { detail: data }))
      else console.warn('Server did not provide battle state; the battle may have ended')
    }
    ;(instance.on as (event: string, handler: (data: BattleReconnectData) => void) => void)(
      'battleReconnect',
      _battleReconnectHandler,
    )
    handlersAttached = true
    for (const [event, handlers] of _pendingEventHandlers.value.entries())
      for (const handler of handlers) bindHandler(instance, event, handler)
  }

  return {
    // 状态
    playerId,
    isInitialized,
    initComplete,
    currentState,
    isConnected,
    isServerWaking,
    serverWarmupState,
    serverWarmupHint,
    _instance, // 暴露内部实例供特殊情况使用
    serverUrl,

    // Actions
    initialize,
    connect,
    disconnect,
    reset,
    replaceServer,
    resetState,
    markInitComplete,
    joinMatchmaking,
    cancelMatchmaking,
    sendplayerSelection,
    on,
    off,
    once,

    // 私人房间方法
    createPrivateRoom,
    joinPrivateRoom,
    joinPrivateRoomAsSpectator,
    leavePrivateRoom,
    toggleRoomReady,
    startRoomBattle,
    sendPrivateRoomPeerSignal,
    switchToSpectator,
    switchToPlayer,
    getPrivateRoomInfo,
    getCurrentPrivateRoom,
    updatePrivateRoomRuleSet,
    updatePrivateRoomConfig,
    transferPrivateRoomHost,
    kickPlayerFromPrivateRoom,
    joinSpectateBattle,
    leaveSpectateBattle,
  }
})
