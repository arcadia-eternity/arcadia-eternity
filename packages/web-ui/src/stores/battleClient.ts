import {
  BattleClient,
  type CreatePrivateRoomData,
  type JoinPrivateRoomData,
  type JoinSpectatorData,
} from '@arcadia-eternity/client'
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
      console.log('🆔 Generated new sessionId:', sessionId)
    } else {
      console.log('🆔 Reusing existing sessionId:', sessionId)
    }

    console.log('🆔 Final sessionId to use:', sessionId)
    console.log('🆔 sessionStorage content:', sessionStorage.getItem('battle-session-id'))

    return sessionId
  } catch {
    // 如果 sessionStorage 不可用，直接生成
    const sessionId = nanoid()
    console.log('🆔 Generated fallback sessionId:', sessionId)
    return sessionId
  }
}

export const useBattleClientStore = defineStore('battleClient', () => {
  // 状态
  const _instance = ref<BattleClient | null>(null)
  const _pendingEventHandlers = ref(new Map<string, Set<(...args: any[]) => void>>())
  const isInitialized = ref(false)
  const _stateUpdateTrigger = ref(0) // 用于强制触发响应式更新

  // 计算属性
  const currentState = computed(() => {
    // 依赖触发器确保响应式更新
    _stateUpdateTrigger.value
    const state = _instance.value?.currentState || { status: 'disconnected', matchmaking: 'idle', battle: 'idle' }
    console.log('🔍 battleClientStore currentState computed:', state, 'trigger:', _stateUpdateTrigger.value)
    return state
  })

  const isConnected = computed(() => {
    return currentState.value.status === 'connected'
  })

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
            const token = authStore.getAccessToken()
            console.log('BattleClient getToken:', {
              isRegistered: playerStore.is_registered,
              requiresAuth: playerStore.requiresAuth,
              isAuthenticated: playerStore.isAuthenticated,
              hasToken: !!token,
              tokenPreview: token ? token.substring(0, 20) + '...' : null,
            })
            return token
          }
          console.log('BattleClient getToken: guest user, no token needed')
          return null
        },
        getPlayerId: () => {
          return playerStore.id
        },
        refreshAuth: async () => {
          console.log('BattleClient refreshAuth: 尝试重新获取token')
          // 注册用户需要通过邮箱恢复获得token，这里只能尝试刷新现有token
          if (playerStore.is_registered) {
            try {
              await authStore.refreshAccessToken()
              console.log('BattleClient refreshAuth: token刷新成功')
            } catch (error) {
              console.log('BattleClient refreshAuth: token刷新失败，需要通过邮箱恢复')
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
      console.log('🔄 BattleClient already initialized, skipping')
      return
    }

    _instance.value = createBattleClient()
    isInitialized.value = true

    // 设置状态变化监听器
    // 注意：这里可能需要根据你修改的 client 接口来调整
    console.log('🔄 BattleClient initialized, state change monitoring active')

    // 设置战斗重连监听器（用于页面刷新后自动跳转）
    // 确保只注册一次
    if (!_battleReconnectHandler) {
      _battleReconnectHandler = async (data: { roomId: string; shouldRedirect: boolean; fullBattleState?: any }) => {
        console.log('🔄 Battle reconnect detected:', data)

        if (data.shouldRedirect) {
          // 如果服务器提供了完整的战斗状态，说明战斗确实还在进行中
          if (data.fullBattleState) {
            console.log('🔄 Server provided full battle state, battle is active')

            // 更新客户端状态
            console.log('🔄 Current state before update:', _instance.value?.currentState)

            // 更新战斗状态
            if (_instance.value) {
              console.log('🔄 Updating battle state to active')
            }

            console.log('🔄 Current state after update:', _instance.value?.currentState)

            // 触发状态更新
            _stateUpdateTrigger.value++

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
      console.log('🔄 Battle reconnect handler registered')
    } else {
      console.log('🔄 Battle reconnect handler already exists, skipping registration')
    }

    // 注册之前缓存的事件监听器
    registerPendingHandlers()
  }

  const connect = () => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    return _instance.value.connect()
  }

  const disconnect = () => {
    if (_instance.value) {
      _instance.value.disconnect()
    }
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
        console.log('🔄 Battle reconnect handler cleaned up')
      }
      _instance.value.disconnect()
      _instance.value = null
    }
    _pendingEventHandlers.value.clear()
    isInitialized.value = false
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
    console.log('🔧 battleClientStore.on called:', event, 'instance available:', !!_instance.value)

    if (_instance.value) {
      console.log('🔧 Registering event handler directly to instance')
      const unsubscribe = _instance.value.on(event, handler)
      console.log('🔧 Event handler registered, unsubscribe type:', typeof unsubscribe)
      return unsubscribe
    } else {
      console.log('🔧 Instance not available, caching event handler')
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

  const startRoomBattle = async (hostTeam: any[]): Promise<string> => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }

    return await _instance.value.startPrivateRoomBattle(hostTeam)
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
