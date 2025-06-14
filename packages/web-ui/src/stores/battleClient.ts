import { BattleClient } from '@arcadia-eternity/client'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAuthStore } from './auth'
import { usePlayerStore } from './player'

export const useBattleClientStore = defineStore('battleClient', () => {
  // 状态
  const _instance = ref<BattleClient | null>(null)
  const _pendingEventHandlers = ref(new Map<string, Set<(...args: any[]) => void>>())
  const isInitialized = ref(false)

  // 计算属性
  const currentState = computed(() => {
    return _instance.value?.currentState || { status: 'disconnected', matchmaking: 'idle', battle: 'idle' }
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

  // Actions
  const initialize = () => {
    if (isInitialized.value) {
      return
    }

    _instance.value = createBattleClient()
    isInitialized.value = true

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

  const reset = () => {
    if (_instance.value) {
      _instance.value.disconnect()
      _instance.value = null
    }
    _pendingEventHandlers.value.clear()
    isInitialized.value = false
  }

  const joinMatchmaking = (playerData: any) => {
    if (!_instance.value) {
      throw new Error('BattleClient not initialized')
    }
    return _instance.value.joinMatchmaking(playerData)
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
    joinMatchmaking,
    cancelMatchmaking,
    sendplayerSelection,
    on,
    off,
    once,
  }
})
