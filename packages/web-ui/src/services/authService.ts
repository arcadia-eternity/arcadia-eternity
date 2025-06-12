import axios from 'axios'
import { ElMessage } from 'element-plus'

// API 基础配置
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:8107/api/v1'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 类型定义
export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface PlayerInfo {
  id: string
  name: string
  isRegistered: boolean
  email?: string
  emailVerified?: boolean
  emailBoundAt?: string
  createdAt?: string
}

export interface AuthResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  player: PlayerInfo
}

export interface PlayerStatus {
  playerId: string
  playerName: string
  isRegistered: boolean
  requiresAuth: boolean
  email?: string
  createdAt?: string
}

export class AuthService {
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiry: number | null = null

  constructor() {
    this.loadTokensFromStorage()
    this.setupAxiosInterceptors()
  }

  /**
   * 从localStorage加载token
   */
  private loadTokensFromStorage() {
    try {
      const authData = localStorage.getItem('auth_tokens')
      if (authData) {
        const { accessToken, refreshToken, tokenExpiry } = JSON.parse(authData)
        this.accessToken = accessToken
        this.refreshToken = refreshToken
        this.tokenExpiry = tokenExpiry
      }
    } catch (error) {
      console.error('Failed to load auth tokens:', error)
      this.clearTokens()
    }
  }

  /**
   * 保存token到localStorage
   */
  private saveTokensToStorage() {
    try {
      const authData = {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        tokenExpiry: this.tokenExpiry,
      }
      localStorage.setItem('auth_tokens', JSON.stringify(authData))
    } catch (error) {
      console.error('Failed to save auth tokens:', error)
    }
  }

  /**
   * 清除token
   */
  private clearTokens() {
    this.accessToken = null
    this.refreshToken = null
    this.tokenExpiry = null
    localStorage.removeItem('auth_tokens')
  }

  /**
   * 设置axios拦截器
   */
  private setupAxiosInterceptors() {
    // 请求拦截器 - 自动添加token
    api.interceptors.request.use(
      config => {
        if (this.accessToken && this.isTokenValid()) {
          config.headers.Authorization = `Bearer ${this.accessToken}`
        }
        return config
      },
      error => Promise.reject(error),
    )

    // 响应拦截器 - 处理token过期
    api.interceptors.response.use(
      response => response,
      async error => {
        if (error.response?.status === 401 && this.refreshToken) {
          try {
            await this.refreshAccessToken()
            // 重试原请求
            const originalRequest = error.config
            originalRequest.headers.Authorization = `Bearer ${this.accessToken}`
            return api.request(originalRequest)
          } catch (refreshError) {
            // token和refreshToken都无效，回退到游客模式
            this.fallbackToGuest()
          }
        }
        return Promise.reject(error)
      },
    )
  }

  /**
   * 检查token是否有效
   */
  private isTokenValid(): boolean {
    if (!this.tokenExpiry) return false
    return Date.now() < this.tokenExpiry - 60000 // 提前1分钟刷新
  }

  /**
   * 创建游客玩家
   */
  async createGuest(): Promise<PlayerInfo> {
    try {
      const response = await api.post('/auth/create-guest')
      if (response.data.success) {
        return response.data.data
      }
      throw new Error(response.data.message || '创建游客失败')
    } catch (error: any) {
      console.error('Create guest error:', error)
      throw new Error(error.response?.data?.message || '创建游客失败，请检查网络连接')
    }
  }

  /**
   * 刷新访问令牌
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available')
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
        refreshToken: this.refreshToken,
      })

      if (response.data.success) {
        const authResult = response.data.data
        this.setTokens(authResult)
      } else {
        throw new Error(response.data.message || 'Token refresh failed')
      }
    } catch (error: any) {
      console.error('Token refresh error:', error)
      this.clearTokens()
      throw error
    }
  }

  /**
   * 检查玩家状态
   */
  async checkPlayerStatus(playerId: string): Promise<PlayerStatus> {
    try {
      const response = await api.get(`/auth/check-player/${playerId}`)
      if (response.data.success) {
        return response.data.data
      }
      throw new Error(response.data.message || '检查玩家状态失败')
    } catch (error: any) {
      console.error('Check player status error:', error)
      throw new Error(error.response?.data?.message || '检查玩家状态失败，请检查网络连接')
    }
  }

  /**
   * 验证token有效性
   */
  async verifyToken(): Promise<{ valid: boolean; data?: any }> {
    try {
      const response = await api.get('/auth/verify')
      return response.data
    } catch (error: any) {
      console.error('Token verification error:', error)
      return { valid: false }
    }
  }

  /**
   * 设置认证信息
   */
  setTokens(authResult: AuthResult) {
    this.accessToken = authResult.accessToken
    this.refreshToken = authResult.refreshToken
    this.tokenExpiry = Date.now() + authResult.expiresIn * 1000
    this.saveTokensToStorage()
  }

  /**
   * 登出
   */
  async logout(): Promise<void> {
    try {
      if (this.accessToken) {
        await api.post('/auth/logout')
      }
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      this.clearTokens()
    }
  }

  /**
   * 获取当前访问令牌
   */
  getAccessToken(): string | null {
    return this.isTokenValid() ? this.accessToken : null
  }

  /**
   * 检查是否已登录（有有效token）
   */
  isAuthenticated(): boolean {
    return this.accessToken !== null && this.isTokenValid()
  }

  /**
   * 获取API实例（已配置认证拦截器）
   */
  getApiInstance() {
    return api
  }

  /**
   * 回退到游客模式
   * 当注册用户的token和refreshToken都无效时调用
   */
  fallbackToGuest() {
    this.clearTokens()
    ElMessage.warning('认证已过期，已切换到游客模式。如需恢复注册用户身份，请通过邮箱恢复玩家ID')

    // 触发自定义事件，通知其他组件用户已回退到游客模式
    window.dispatchEvent(new CustomEvent('auth-fallback-to-guest'))
  }
}

// 创建默认实例
export const authService = new AuthService()
