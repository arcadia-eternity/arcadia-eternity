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
    return this._instance?.on(event, handler)
  },

  off(event: any, handler?: any) {
    return this._instance?.off(event, handler)
  },

  once(event: any, handler: any) {
    return this._instance?.once(event, handler)
  },
})

// 初始化battleClient（在App.vue中调用）
export function initBattleClient() {
  if (!_battleClient) {
    _battleClient = createBattleClient()
    battleClient._instance = _battleClient
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
