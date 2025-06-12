import { getSupabaseServiceClient } from '../client'
import {
  type EmailVerificationCode,
  type CreateEmailVerificationCodeInput,
  type VerificationPurpose,
  DatabaseError,
} from '../types'

export class EmailVerificationRepository {
  /**
   * 创建邮箱验证码（先删除同邮箱同用途的旧验证码，确保一一对应）
   */
  async createVerificationCode(input: CreateEmailVerificationCodeInput): Promise<EmailVerificationCode> {
    const supabase = getSupabaseServiceClient()

    // 先删除同邮箱同用途的旧验证码
    await supabase.from('email_verification_codes').delete().eq('email', input.email).eq('purpose', input.purpose)

    const { data, error } = await supabase
      .from('email_verification_codes')
      .insert({
        email: input.email,
        code: input.code,
        player_id: input.player_id,
        purpose: input.purpose,
        expires_at: input.expires_at || new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 默认10分钟过期
      })
      .select()
      .single()

    if (error) {
      throw new DatabaseError(`Failed to create verification code: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 根据邮箱和验证码查找有效的验证码记录
   */
  async findValidCode(
    email: string,
    code: string,
    purpose: VerificationPurpose,
  ): Promise<EmailVerificationCode | null> {
    const supabase = getSupabaseServiceClient()

    const { data, error } = await supabase
      .from('email_verification_codes')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .eq('purpose', purpose)
      .is('used_at', null) // 未使用
      .gt('expires_at', new Date().toISOString()) // 未过期
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw new DatabaseError(`Failed to find verification code: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 标记验证码为已使用
   */
  async markCodeAsUsed(id: string): Promise<EmailVerificationCode> {
    const supabase = getSupabaseServiceClient()

    const { data, error } = await supabase
      .from('email_verification_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      throw new DatabaseError(`Failed to mark code as used: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 清理过期的验证码
   */
  async cleanupExpiredCodes(): Promise<number> {
    const supabase = getSupabaseServiceClient()

    // 先查询要删除的记录数量
    const { count: deleteCount } = await supabase
      .from('email_verification_codes')
      .select('*', { count: 'exact', head: true })
      .lt('expires_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())

    // 执行删除操作
    const { error } = await supabase
      .from('email_verification_codes')
      .delete()
      .lt('expires_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())

    if (error) {
      throw new DatabaseError(`Failed to cleanup expired codes: ${error.message}`, error.code, error)
    }

    return deleteCount || 0
  }

  /**
   * 检查邮箱是否已被其他玩家绑定
   */
  async isEmailBound(email: string, excludePlayerId?: string): Promise<boolean> {
    const supabase = getSupabaseServiceClient()

    let query = supabase
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .eq('email_verified', true)

    if (excludePlayerId) {
      query = query.neq('id', excludePlayerId)
    }

    const { count, error } = await query

    if (error) {
      throw new DatabaseError(`Failed to check email binding: ${error.message}`, error.code, error)
    }

    return (count || 0) > 0
  }

  /**
   * 根据邮箱查找已绑定的玩家
   */
  async findPlayerByEmail(email: string): Promise<{ id: string; name: string } | null> {
    const supabase = getSupabaseServiceClient()

    const { data, error } = await supabase
      .from('players')
      .select('id, name')
      .eq('email', email)
      .eq('email_verified', true)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw new DatabaseError(`Failed to find player by email: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 生成6位数字验证码
   */
  generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
  }

  /**
   * 检查验证码发送频率限制
   */
  async checkRateLimit(email: string, purpose: VerificationPurpose, limitMinutes: number = 1): Promise<boolean> {
    const supabase = getSupabaseServiceClient()

    const { count, error } = await supabase
      .from('email_verification_codes')
      .select('*', { count: 'exact', head: true })
      .eq('email', email)
      .eq('purpose', purpose)
      .gt('created_at', new Date(Date.now() - limitMinutes * 60 * 1000).toISOString())

    if (error) {
      throw new DatabaseError(`Failed to check rate limit: ${error.message}`, error.code, error)
    }

    return (count || 0) === 0 // 返回true表示可以发送，false表示需要等待
  }
}
