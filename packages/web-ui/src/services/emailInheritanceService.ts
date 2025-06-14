import type { Player } from '@arcadia-eternity/database'
import { useAuthStore } from '../stores/auth'

// 使用认证服务的API实例
const getApi = () => useAuthStore().getApiInstance()

// 请求和响应类型
export interface SendVerificationCodeRequest {
  email: string
  playerId?: string
  purpose: 'bind' | 'recover'
}

export interface VerifyCodeRequest {
  email: string
  code: string
  purpose: 'bind' | 'recover'
  playerId?: string
}

export interface BindEmailResponse {
  success: boolean
  player: Player
  message: string
  auth?: {
    accessToken: string
    refreshToken: string
    expiresIn: number
    player: {
      id: string
      isRegistered: boolean
      email?: string
    }
  }
}

export interface RecoverPlayerResponse {
  success: boolean
  player: Player
  message: string
  auth?: {
    accessToken: string
    refreshToken: string
    expiresIn: number
    player: {
      id: string
      isRegistered: boolean
      email?: string
    }
  }
}

export interface SendCodeResponse {
  success: boolean
  message: string
  rateLimitSeconds?: number
}

export interface VerifyCodeResponse {
  success: boolean
  message: string
  valid: boolean
}

export class EmailInheritanceService {
  /**
   * 发送邮箱验证码
   */
  async sendVerificationCode(request: SendVerificationCodeRequest): Promise<SendCodeResponse> {
    try {
      const api = getApi()
      const response = await api.post('/email/send-verification-code', request)
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      throw new Error('发送验证码失败，请检查网络连接')
    }
  }

  /**
   * 验证邮箱验证码
   */
  async verifyCode(request: VerifyCodeRequest): Promise<VerifyCodeResponse> {
    try {
      const api = getApi()
      const response = await api.post('/email/verify-code', request)
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      throw new Error('验证码验证失败，请检查网络连接')
    }
  }

  /**
   * 绑定邮箱到当前玩家ID
   */
  async bindEmail(email: string, code: string, playerId: string): Promise<BindEmailResponse> {
    try {
      const api = getApi()
      const response = await api.post('/email/bind', {
        email,
        code,
        playerId,
      })
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      throw new Error('邮箱绑定失败，请检查网络连接')
    }
  }

  /**
   * 通过邮箱恢复玩家ID
   */
  async recoverPlayer(email: string, code: string): Promise<RecoverPlayerResponse> {
    try {
      const api = getApi()
      const response = await api.post('/email/recover', {
        email,
        code,
      })
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      throw new Error('玩家ID恢复失败，请检查网络连接')
    }
  }

  /**
   * 检查邮箱是否已被绑定
   */
  async checkEmailBinding(email: string): Promise<{ bound: boolean; playerId?: string; playerName?: string }> {
    try {
      const api = getApi()
      const response = await api.get(`/email/check-binding?email=${encodeURIComponent(email)}`)
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      throw new Error('检查邮箱绑定状态失败，请检查网络连接')
    }
  }

  /**
   * 解绑邮箱
   */
  async unbindEmail(playerId: string): Promise<{ success: boolean; message: string }> {
    try {
      const api = getApi()
      const response = await api.post('/email/unbind', { playerId })
      return response.data
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data
      }
      throw new Error('邮箱解绑失败，请检查网络连接')
    }
  }

  /**
   * 验证邮箱格式
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
    return emailRegex.test(email)
  }

  /**
   * 验证验证码格式
   */
  validateCode(code: string): boolean {
    return /^\d{6}$/.test(code)
  }
}

// 创建默认实例
export const emailInheritanceService = new EmailInheritanceService()
