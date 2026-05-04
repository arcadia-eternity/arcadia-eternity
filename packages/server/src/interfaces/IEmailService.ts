import { injectable } from 'inversify'

// 邮件消息接口
export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

// 验证码邮件数据接口
export interface VerificationEmailData {
  email: string
  code: string
  purpose: 'bind' | 'recover'
  playerName?: string
}

// 邮件服务接口
export interface IEmailService {
  /**
   * 发送邮件
   */
  sendEmail(message: EmailMessage): Promise<boolean>

  /**
   * 发送验证码邮件
   */
  sendVerificationCode(data: VerificationEmailData): Promise<boolean>

  /**
   * 验证邮件服务连接
   */
  verifyConnection(): Promise<boolean>
}

// 装饰器标记接口为可注入
export const IEmailService = Symbol.for('IEmailService')
