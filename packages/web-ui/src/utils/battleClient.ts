import { BattleClient } from '@arcadia-eternity/client'
import { reactive } from 'vue'
import { authService } from '../services/authService'
import { usePlayerStore } from '../stores/player'

// 全局battleClient实例
let _battleClient: BattleClient | null = null

// 创建battleClient实例的函数
export function createBattleClient(): BattleClient {
  const playerStore = usePlayerStore()

  return new BattleClient({
    serverUrl: import.meta.env.VITE_WS_URL,
    auth: {
      getToken: () => {
        // 只有注册用户需要token
        if (playerStore.is_registered && playerStore.requiresAuth) {
          const token = authService.getAccessToken()
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
            await authService.refreshAccessToken()
            console.log('BattleClient refreshAuth: token刷新成功')
          } catch (error) {
            console.log('BattleClient refreshAuth: token刷新失败，需要通过邮箱恢复')
            // 触发回退到游客模式
            authService.fallbackToGuest()
            throw error
          }
        }
      },
    },
  })
}

// reactive包装的battleClient
export const battleClient = reactive({
  _instance: null as BattleClient | null,
  _pendingEventHandlers: new Map<string, Set<(...args: any[]) => void>>(),

  get currentState() {
    return this._instance?.currentState || { status: 'disconnected', matchmaking: 'idle', battle: 'idle' }
  },

  connect() {
    return this._instance?.connect()
  },

  disconnect() {
    return this._instance?.disconnect()
  },

  joinMatchmaking(playerData: any) {
    return this._instance?.joinMatchmaking(playerData)
  },

  cancelMatchmaking() {
    return this._instance?.cancelMatchmaking()
  },

  sendplayerSelection(selection: any) {
    return this._instance?.sendplayerSelection(selection)
  },

  on(event: any, handler: any) {
    if (this._instance) {
      return this._instance.on(event, handler)
    } else {
      // 如果实例还没准备好，缓存事件监听器
      if (!this._pendingEventHandlers.has(event)) {
        this._pendingEventHandlers.set(event, new Set())
      }
      this._pendingEventHandlers.get(event)!.add(handler)

      // 返回取消监听的函数
      return () => {
        const handlers = this._pendingEventHandlers.get(event)
        if (handlers) {
          handlers.delete(handler)
          if (handlers.size === 0) {
            this._pendingEventHandlers.delete(event)
          }
        }
      }
    }
  },

  off(event: any, handler?: any) {
    if (this._instance) {
      return this._instance.off(event, handler)
    } else {
      // 从缓存中移除
      if (handler) {
        const handlers = this._pendingEventHandlers.get(event)
        if (handlers) {
          handlers.delete(handler)
          if (handlers.size === 0) {
            this._pendingEventHandlers.delete(event)
          }
        }
      } else {
        this._pendingEventHandlers.delete(event)
      }
    }
  },

  once(event: any, handler: any) {
    if (this._instance) {
      return this._instance.once(event, handler)
    } else {
      // 对于once，我们需要包装handler以确保只执行一次
      const wrappedHandler = (...args: any[]) => {
        this.off(event, wrappedHandler)
        handler(...args)
      }
      return this.on(event, wrappedHandler)
    }
  },

  // 内部方法：注册缓存的事件监听器到实际实例
  _registerPendingHandlers() {
    if (this._instance && this._pendingEventHandlers.size > 0) {
      for (const [event, handlers] of this._pendingEventHandlers.entries()) {
        for (const handler of handlers) {
          this._instance.on(event as any, handler)
        }
      }
      this._pendingEventHandlers.clear()
    }
  },
})

// 初始化battleClient（在App.vue中调用）
export function initBattleClient() {
  if (!_battleClient) {
    _battleClient = createBattleClient()
    battleClient._instance = _battleClient
    // 注册之前缓存的事件监听器
    battleClient._registerPendingHandlers()
  }
}

// 重置battleClient
export function resetBattleClient() {
  if (_battleClient) {
    _battleClient.disconnect()
    _battleClient = null
    battleClient._instance = null
  }
}
