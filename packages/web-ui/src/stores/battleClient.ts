import {
  BattleClient,
  type CreatePrivateRoomData,
  type JoinPrivateRoomData,
  type JoinSpectatorData,
  type SendPrivateRoomPeerSignalData,
} from '@arcadia-eternity/client'
import type { PrivateRoomBattleStartInfo } from '@arcadia-eternity/protocol'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAuthStore } from './auth'
import { usePlayerStore } from './player'
import { nanoid } from 'nanoid'

// 全局 sessionId 管理（在 store 外部，确保整个应用生命周期中唯一）
const getOrCreateGlobalSessionId = (): string => {
  try {
    // 首先尝试从 sessionStorage 获取（标签页级别）
    let sessionId = sessionStorage.getItem('battle-session-id')

    if (!sessionId) {
      // 直接用 nanoid 生成全局唯一ID
      sessionId = nanoid()
      sessionStorage.setItem('battle-session-id', sessionId)
    }

    return sessionId
  } catch {
    // 如果 sessionStorage 不可用，直接生成
    return nanoid()
  }
}

export const useBattleClientStore = defineStore('battleClient', () => {
  type ServerWarmupState = 'idle' | 'waking' | 'ready' | 'failed'

  // 状态
  const _instance = ref<BattleClient | null>(null)
  const _pendingEventHandlers = ref(new Map<string, Set<(...args: any[]) => void>>())
  const isInitialized = ref(false)
  const serverWarmupState = ref<ServerWarmupState>('idle')
  const serverWarmupError = ref<string | null>(null)

  // 响应式状态触发器
  const _stateUpdateTrigger = ref(0)

  // 计算属性
  const currentState = computed(() => {
    // 依赖触发器确保响应式更新
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
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
        return '服务器唤醒中（通常 5-20 秒）'
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
    wsUrl.pathname = '/ready'
    wsUrl.search = ''
    wsUrl.hash = ''
    return wsUrl.toString()
  }

  const waitForServerReady = async (maxWaitMs = 25000): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    const readyUrl = resolveReadyUrl(import.meta.env.VITE_WS_URL)
    const startedAt = Date.now()
    serverWarmupState.value = 'waking'
    serverWarmupError.value = null

    while (Date.now() - startedAt < maxWaitMs) {
      const controller = new AbortController()
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
      }

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

      if (state === 'draining') {
        serverWarmupState.value = 'failed'
        serverWarmupError.value = '服务器正在重启中，请稍后重试'
        throw new Error(serverWarmupError.value)
      }

      await delay(1000)
    }

    serverWarmupState.value = 'failed'
    serverWarmupError.value = '服务器唤醒超时（超过 25 秒）'
    throw new Error(serverWarmupError.value)
  }

  // 创建battleClient实例的函数
  const createBattleClient = (): BattleClient => {
    const playerStore = usePlayerStore()
    const authStore = useAuthStore()

    return new BattleClient({
      serverUrl: import.meta.env.VITE_WS_URL,
      actionTimeout: 10000,
      sessionId: getOrCreateGlobalSessionId(), // 使用全局 sessionId // 10秒超时，比默认的30秒更快
      auth: {
        getToken: () => {
          // 只有注册用户需要token
          if (playerStore.is_registered && playerStore.requiresAuth) {
            return authStore.getAccessToken()
          }
          return null
        },
        getPlayerId: () => {
          return playerStore.id
        },
        refreshAuth: async () => {
          // 注册用户需要通过邮箱恢复获得token，这里只能尝试刷新现有token
          if (playerStore.is_registered) {
            try {
              await authStore.refreshAccessToken()
            } catch (error) {
              // 触发回退到游客模式
              authStore.fallbackToGuest()
              throw error
            }
          }
        },
      },
    })
  }

  // 战斗重连处理器引用，用于防止重复注册
  let _battleReconnectHandler:
    | ((data: { roomId: string; shouldRedirect: boolean; fullBattleState?: any }) => void)
    | null = null

  // Actions
  const initialize = () => {
    if (isInitialized.value) {
      return
    }

    _instance.value = createBattleClient()
    isInitialized.value = true

    // 设置状态变化监听器 - 当底层client状态变化时触发Vue响应式更新
    const stateUpdateHandler = (state: { status: string; matchmaking: string; battle: string; roomId?: string; opponent?: { id: string; name: string } }) => {
      _stateUpdateTrigger.value++
    }

    // 使用专门的状态变化监听器
    _instance.value.onStateChange(stateUpdateHandler)

    // 设置战斗重连监听器（用于页面刷新后自动跳转）
    // 确保只注册一次
    if (!_battleReconnectHandler) {
      _battleReconnectHandler = async (data: { roomId: string; shouldRedirect: boolean; fullBattleState?: any }) => {
        if (data.shouldRedirect) {
          // 如果服务器提供了完整的战斗状态，说明战斗确实还在进行中
          if (data.fullBattleState) {
            // 更新战斗状态
            // 触发全局事件，让 App.vue 处理路由跳转
            // 传递完整的战斗状态数据，避免额外的 getState 调用
            window.dispatchEvent(new CustomEvent('battleReconnect', { detail: data }))
          } else {
            // 如果服务器没有提供战斗状态，说明可能出现了问题
            console.warn('🔄 Server did not provide battle state, battle may have ended')
            // 不触发跳转事件
          }
        }
      }

      _instance.value.on('battleReconnect', _battleReconnectHandler)
    }

    // 注册之前缓存的事件监听器
    registerPendingHandlers()
  }

  const connect = async () => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    if (_instance.value.currentState.status === 'connected') {
      serverWarmupState.value = 'ready'
      serverWarmupError.value = null
      return
    }
    await waitForServerReady()
    return _instance.value.connect()
  }

  const disconnect = () => {
    if (_instance.value) {
      _instance.value.disconnect()
    }
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
        _instance.value.off('battleReconnect', _battleReconnectHandler)
        _battleReconnectHandler = null
      }
      _instance.value.disconnect()
      _instance.value = null
    }
    _pendingEventHandlers.value.clear()
    isInitialized.value = false
    serverWarmupState.value = 'idle'
    serverWarmupError.value = null
  }

  const joinMatchmaking = (data: any) => {
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

  const sendplayerSelection = (selection: any) => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    return _instance.value.sendplayerSelection(selection)
  }

  const on = (event: any, handler: any) => {
    if (_instance.value) {
      return _instance.value.on(event, handler)
    } else {
      // 如果实例还没准备好，缓存事件监听器
      if (!_pendingEventHandlers.value.has(event)) {
        _pendingEventHandlers.value.set(event, new Set())
      }
      _pendingEventHandlers.value.get(event)!.add(handler)

      // 返回取消监听的函数
      return () => {
        const handlers = _pendingEventHandlers.value.get(event)
        if (handlers) {
          handlers.delete(handler)
          if (handlers.size === 0) {
            _pendingEventHandlers.value.delete(event)
          }
        }
      }
    }
  }

  const off = (event: any, handler?: any) => {
    if (_instance.value) {
      return _instance.value.off(event, handler)
    } else {
      // 从缓存中移除
      if (handler) {
        const handlers = _pendingEventHandlers.value.get(event)
        if (handlers) {
          handlers.delete(handler)
          if (handlers.size === 0) {
            _pendingEventHandlers.value.delete(event)
          }
        }
      } else {
        _pendingEventHandlers.value.delete(event)
      }
    }
  }

  const once = (event: any, handler: any) => {
    if (_instance.value) {
      return _instance.value.once(event, handler)
    } else {
      // 对于once，我们需要包装handler以确保只执行一次
      const wrappedHandler = (...args: any[]) => {
        off(event, wrappedHandler)
        handler(...args)
      }
      return on(event, wrappedHandler)
    }
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

  const toggleRoomReady = async (team?: any[]): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.togglePrivateRoomReady(team)
  }

  const startRoomBattle = async (hostTeam: any[]): Promise<PrivateRoomBattleStartInfo> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.startPrivateRoomBattle(hostTeam)
  }

  const sendPrivateRoomPeerSignal = async (data: SendPrivateRoomPeerSignalData): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.sendPrivateRoomPeerSignal(data)
  }

  const getPrivateRoomInfo = async (roomCode: string): Promise<any> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.getPrivateRoomInfo(roomCode)
  }

  const getCurrentPrivateRoom = async (): Promise<any> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.getCurrentPrivateRoom()
  }

  const updatePrivateRoomRuleSet = async (data: { ruleSetId: string }): Promise<void> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.updatePrivateRoomRuleSet(data)
  }

  const updatePrivateRoomConfig = async (data: {
    ruleSetId?: string
    allowSpectators?: boolean
    maxSpectators?: number
    spectatorMode?: 'free' | 'player1' | 'player2' | 'god'
    isPrivate?: boolean
    password?: string
  }): Promise<void> => {
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

  const switchToPlayer = async (team: any[]): Promise<void> => {
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

  // 内部方法：注册缓存的事件监听器到实际实例
  const registerPendingHandlers = () => {
    if (!_instance.value || _pendingEventHandlers.value.size === 0) {
      return
    }

    const instance = _instance.value
    for (const [event, handlers] of _pendingEventHandlers.value.entries()) {
      for (const handler of handlers) {
        instance.on(event as any, handler)
      }
    }
    _pendingEventHandlers.value.clear()
  }

  return {
    // 状态
    isInitialized,
    currentState,
    isConnected,
    isServerWaking,
    serverWarmupState,
    serverWarmupHint,
    _instance, // 暴露内部实例供特殊情况使用

    // Actions
    initialize,
    connect,
    disconnect,
    reset,
    resetState,
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
