import { defineStore } from 'pinia'
import { z } from 'zod'
import { PlayerSchema, type PlayerSchemaType } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import { usePetStorageStore } from './petStorage'
import { authService, type PlayerInfo } from '../services/authService'
import { ElMessage } from 'element-plus'

// 定义状态类型
interface PlayerState {
  id: string
  name: string
  email: string | null
  email_verified: boolean
  email_bound_at: string | null
  is_registered: boolean
  requiresAuth: boolean
  isAuthenticated: boolean
  isInitialized: boolean
}

// 辅助函数：检测是否为网络错误
function isNetworkError(error: any): boolean {
  return (
    error.message?.includes('网络') ||
    error.message?.includes('连接') ||
    error.message?.includes('timeout') ||
    error.code === 'NETWORK_ERROR' ||
    error.code === 'ECONNABORTED' ||
    error.name === 'AxiosError'
  )
}

export const usePlayerStore = defineStore('player', {
  state: (): PlayerState => ({
    id: '',
    name: '',
    email: null,
    email_verified: false,
    email_bound_at: null,
    is_registered: false,
    requiresAuth: false,
    isAuthenticated: false,
    isInitialized: false,
  }),

  persist: {
    // 插件配置
    key: 'player-data',
    pick: ['id', 'name', 'email', 'email_verified', 'email_bound_at', 'is_registered'],
    beforeHydrate: ctx => {
      if (!ctx.store.$state.id) {
        // 只做本地初始化，不调用API（避免在Pinia初始化前调用）
        const newId = nanoid() // 直接使用nanoid
        ctx.store.$patch({
          // @ts-ignore
          id: newId,
          name: `游客-${newId.slice(-4)}`,
          email: null,
          email_verified: false,
          email_bound_at: null,
          is_registered: false,
          requiresAuth: false,
          isAuthenticated: false,
          isInitialized: false, // 标记为未初始化，稍后在initializePlayer中处理
        })
      }
    },
  },

  actions: {
    saveToLocal() {
      try {
        // 确保必要字段有值
        const dataToSave = {
          id: this.id || nanoid(), // 直接使用nanoid，不加前缀
          name: this.name || `游客-${Date.now().toString(36)}`,
        }

        // 使用Zod验证数据格式
        const validated = PlayerSchema.pick({
          id: true,
          name: true,
        }).parse(dataToSave)

        localStorage.setItem('player', JSON.stringify(validated))
      } catch (err) {
        console.error('保存玩家数据失败:', err)
        if (err instanceof z.ZodError) {
          ElMessage.error('玩家数据格式错误，保存失败')
        }
      }
    },

    /**
     * 处理认证回退到游客模式
     */
    handleAuthFallbackToGuest() {
      // 保持当前的玩家ID和名称，但清除注册状态和认证信息
      this.is_registered = false
      this.requiresAuth = false
      this.isAuthenticated = true // 游客模式下认为已认证
      this.email = null
      this.email_verified = false
      this.email_bound_at = null
      this.saveToLocal()
      console.log('Player fallback to guest mode:', { id: this.id, name: this.name })
    },

    /**
     * 设置认证回退监听器
     */
    setupAuthFallbackListener() {
      // 避免重复添加监听器
      if ((window as any).__authFallbackListenerAdded) return

      window.addEventListener('auth-fallback-to-guest', () => {
        this.handleAuthFallbackToGuest()
      })
      ;(window as any).__authFallbackListenerAdded = true
    },

    loadFromLocal() {
      try {
        const saved = localStorage.getItem('player')
        if (!saved) return

        // 解析时进行严格验证
        const parsed = PlayerSchema.pick({
          id: true,
          name: true,
        }).parse(JSON.parse(saved))

        this.id = parsed.id
        this.name = parsed.name
      } catch (err) {
        console.error('读取玩家数据失败:', err)
        localStorage.removeItem('player')
        ElMessage.error('本地玩家数据损坏，已重置')
      }
    },

    async setName(newName: string) {
      if (!newName.trim()) {
        ElMessage.warning('玩家名称不能为空')
        return
      }
      if (newName.length > 30) {
        ElMessage.warning('名称长度不能超过30个字符')
        return
      }

      // 先保存到本地
      this.name = newName
      this.saveToLocal()

      // 尝试同步到服务器
      try {
        const response = await fetch('/api/v1/auth/update-player-name', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(this.isAuthenticated && authService.getAccessToken()
              ? {
                  Authorization: `Bearer ${authService.getAccessToken()}`,
                }
              : {}),
          },
          body: JSON.stringify({
            playerId: this.id,
            name: newName,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          console.warn('Failed to sync name to server:', errorData.message)
          // 不显示错误消息给用户，因为本地已经保存成功
        } else {
          console.log('Name synced to server successfully')
        }
      } catch (error) {
        console.warn('Failed to sync name to server:', error)
        // 不显示错误消息给用户，因为本地已经保存成功
      }
    },

    generateNewId() {
      // 生成新的ID
      const newId = nanoid()

      // 重置玩家状态（但保留宠物数据）
      this.id = newId
      this.name = `游客-${newId.slice(-4)}`
      this.email = null
      this.email_verified = false
      this.email_bound_at = null
      this.is_registered = false
      this.requiresAuth = false
      this.isAuthenticated = false
      this.isInitialized = false

      this.saveToLocal()
      ElMessage.success('已生成新的玩家ID，宠物数据已保留')
    },

    /**
     * 初始化玩家状态 - 检查是否需要认证
     */
    async initializePlayer() {
      if (this.isInitialized) return

      // 设置认证回退监听器
      this.setupAuthFallbackListener()

      // 确保有基本的ID和name
      if (!this.id) {
        this.id = nanoid()
      }
      if (!this.name) {
        this.name = `游客-${this.id.slice(-4)}`
      }

      try {
        // 首先检查当前玩家是否在服务器上存在
        let playerExists = false
        let status: any = null

        try {
          console.log('Checking if player exists on server:', this.id)
          status = await authService.checkPlayerStatus(this.id)
          playerExists = true
          console.log('Player exists on server:', status)
        } catch (error: any) {
          console.log('Player does not exist on server or server error:', error)
          playerExists = false

          // 如果是网络错误且本地有注册用户信息，保留本地状态
          if (this.is_registered && isNetworkError(error)) {
            console.log('Network error detected, preserving local registered user state')
            this.isAuthenticated = authService.isAuthenticated()
            this.isInitialized = true
            this.saveToLocal()
            ElMessage.warning('网络连接异常，使用本地缓存数据')
            return
          }
        }

        if (playerExists && status) {
          // 玩家在服务器上存在，使用服务器数据
          // 优先使用本地名字，只有在本地没有名字时才使用服务器的名字
          if (!this.name && status.playerName) {
            this.name = status.playerName
          }
          this.is_registered = status.isRegistered || false
          this.requiresAuth = status.requiresAuth || false
          this.email = status.email || null

          // 如果是注册用户，检查是否已认证
          if (this.is_registered) {
            this.isAuthenticated = authService.isAuthenticated()

            // 如果没有认证，尝试验证现有token
            if (!this.isAuthenticated) {
              const tokenResult = await authService.verifyToken()
              this.isAuthenticated = tokenResult.valid

              // 如果token验证失败，回退到游客模式
              if (!this.isAuthenticated) {
                console.log('Token验证失败，回退到游客模式')
                this.handleAuthFallbackToGuest()
                ElMessage.warning('认证已过期，已切换到游客模式。如需恢复注册用户身份，请通过邮箱恢复玩家ID')
              }
            }
          } else {
            // 游客用户不需要认证
            this.isAuthenticated = true
          }

          this.isInitialized = true
          this.saveToLocal()
          ElMessage.success(`欢迎${this.is_registered ? '注册用户' : '游客'}: ${this.name}`)
        } else {
          // 玩家在服务器上不存在，需要创建新的游客
          try {
            console.log('Creating new guest on server...')
            const guestPlayer = await authService.createGuest()
            console.log('Server returned guest player:', guestPlayer)

            // 使用服务器返回的玩家信息，但保留本地数据作为备份
            const newId = (guestPlayer as any).playerId || guestPlayer.id
            const newName = (guestPlayer as any).playerName || guestPlayer.name

            // 只有在服务器返回有效数据时才更新
            if (newId && newName) {
              this.id = newId
              this.name = newName
            }

            this.is_registered = false
            this.requiresAuth = false
            this.isAuthenticated = true
            this.isInitialized = true
            this.saveToLocal()
            ElMessage.success(`欢迎新游客: ${this.name}`)
          } catch (error: any) {
            console.warn('Failed to create guest on server, using local ID:', error)
            // 如果创建游客失败，使用本地数据作为离线模式
            // 保留现有的ID和name，不要覆盖
            this.is_registered = false
            this.requiresAuth = false
            this.isAuthenticated = true
            this.isInitialized = true
            this.saveToLocal()

            // 根据错误类型显示不同的消息
            if (isNetworkError(error)) {
              ElMessage.warning('网络连接异常，使用离线模式')
            } else {
              ElMessage.warning('无法连接服务器，使用离线模式')
            }
          }
        }
      } catch (error: any) {
        console.error('Failed to initialize player:', error)

        // 确保总是有一个有效的ID和name（保留现有值）
        if (!this.id) {
          this.id = nanoid()
        }
        if (!this.name) {
          this.name = `游客-${this.id.slice(-4)}`
        }

        console.log('After error handling:', { id: this.id, name: this.name })

        // 如果是注册用户且是网络错误，保留注册状态
        if (this.is_registered && isNetworkError(error)) {
          console.log('Network error for registered user, preserving registration status')
          this.isAuthenticated = authService.isAuthenticated()
          this.isInitialized = true
          this.saveToLocal()
          ElMessage.warning('网络连接异常，已保留本地用户状态')
        } else {
          // 如果服务器检查失败，就当作游客处理
          this.is_registered = false
          this.requiresAuth = false
          this.isAuthenticated = true
          this.isInitialized = true
          this.saveToLocal()
          ElMessage.warning('无法连接服务器，使用离线模式')
        }
      }
    },

    /**
     * 登录注册用户 - 已禁用，只能通过邮箱恢复获得token
     */
    async loginRegisteredUser() {
      if (!this.is_registered) {
        ElMessage.warning('当前是游客用户，无需登录')
        return false
      }

      ElMessage.warning('注册用户需要通过邮箱恢复玩家ID来获得认证令牌')
      return false
    },

    /**
     * 登出
     */
    async logout() {
      try {
        await authService.logout()
        this.isAuthenticated = false
        ElMessage.success('已登出')
      } catch (error) {
        console.error('Logout failed:', error)
        this.isAuthenticated = false
      }
    },

    /**
     * 升级为注册用户（绑定邮箱后）
     */
    upgradeToRegisteredUser(playerInfo: PlayerInfo) {
      this.id = playerInfo.id
      this.name = playerInfo.name
      this.email = playerInfo.email || null
      this.email_verified = playerInfo.emailVerified || false
      this.email_bound_at = playerInfo.emailBoundAt || null
      this.is_registered = true
      this.requiresAuth = true
      this.isAuthenticated = authService.isAuthenticated()
      this.saveToLocal()
      ElMessage.success('已升级为注册用户')
    },

    /**
     * 创建新的游客用户
     */
    async createNewGuest() {
      try {
        const guestPlayer = await authService.createGuest()

        // 使用服务器返回的数据
        this.id = guestPlayer.id
        this.name = guestPlayer.name
        this.email = null
        this.email_verified = false
        this.email_bound_at = null
        this.is_registered = false
        this.requiresAuth = false
        this.isAuthenticated = true
        this.isInitialized = true
        this.saveToLocal()
        ElMessage.success('已创建新的游客账户')
      } catch (error: any) {
        console.error('Failed to create guest:', error)

        // 如果是网络错误，创建本地游客账户
        if (isNetworkError(error)) {
          console.log('Network error, creating local guest account')
          const newId = nanoid()
          this.id = newId
          this.name = `游客-${newId.slice(-4)}`
          this.email = null
          this.email_verified = false
          this.email_bound_at = null
          this.is_registered = false
          this.requiresAuth = false
          this.isAuthenticated = true
          this.isInitialized = true
          this.saveToLocal()
          ElMessage.warning('网络连接异常，已创建本地游客账户')
        } else {
          ElMessage.error(error.message || '创建游客账户失败')
        }
      }
    },
  },

  getters: {
    player: (state): PlayerSchemaType => {
      const petStorage = usePetStorageStore()
      try {
        // 验证队伍数据有效性
        const team = petStorage.getCurrentTeam()
        return PlayerSchema.parse({
          ...state,
          team,
        })
      } catch (err) {
        console.error('玩家数据验证失败:', err)
        ElMessage.error('队伍数据异常，请检查精灵配置')
        return {
          ...state,
          team: [], // 返回空队伍防止崩溃
        }
      }
    },

    /**
     * 是否可以使用功能（已初始化且已认证）
     */
    canUseFeatures: (state): boolean => {
      return state.isInitialized && state.isAuthenticated
    },

    /**
     * 获取认证状态描述
     */
    authStatusText: (state): string => {
      if (!state.isInitialized) return '初始化中...'
      if (state.is_registered) {
        return state.isAuthenticated ? '已登录' : '需要通过邮箱恢复'
      }
      return '游客模式'
    },
  },
})
