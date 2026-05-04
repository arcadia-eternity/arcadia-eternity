import 'reflect-metadata'
import { injectable } from 'inversify'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import pino from 'pino'
import type { IEmailService, EmailMessage, VerificationEmailData } from '../../interfaces/IEmailService'
import type { HttpErrorLike } from '../../cluster/types'
import { renderVerificationHtml, renderVerificationText, validateTemplates } from '../../utils/templateLoader'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

// 邮件配置接口
export interface EmailConfig {
  provider: 'smtp' | 'sendgrid' | 'ses' | 'console'
  smtp?: {
    host: string
    port: number
    secure: boolean
    auth: {
      user: string
      pass: string
    }
  }
  sendgrid?: {
    apiKey: string
  }
  ses?: {
    region: string
    accessKeyId: string
    secretAccessKey: string
  }
  from: string
  fromName?: string
}

// 重新导出接口类型
export type { EmailMessage, VerificationEmailData } from '../../interfaces/IEmailService'

@injectable()
export class EmailService implements IEmailService {
  private transporter: Transporter | null = null
  private config: EmailConfig

  constructor(config: EmailConfig) {
    this.config = config
    this.initializeTransporter()
    this.validateEmailTemplates()
  }

  private validateEmailTemplates() {
    if (!validateTemplates()) {
      logger.warn('Email templates not found, using fallback templates')
    } else {
      logger.info('Email templates loaded successfully')
    }
  }

  private initializeTransporter() {
    try {
      switch (this.config.provider) {
        case 'smtp':
          if (!this.config.smtp) {
            throw new Error('SMTP configuration is required')
          }
          this.transporter = nodemailer.createTransport({
            host: this.config.smtp.host,
            port: this.config.smtp.port,
            secure: this.config.smtp.secure,
            auth: {
              user: this.config.smtp.auth.user,
              pass: this.config.smtp.auth.pass,
            },
          })
          break

        case 'sendgrid':
          if (!this.config.sendgrid) {
            throw new Error('SendGrid configuration is required')
          }
          this.transporter = nodemailer.createTransport({
            service: 'SendGrid',
            auth: {
              user: 'apikey',
              pass: this.config.sendgrid.apiKey,
            },
          })
          break

        case 'ses': {
          if (!this.config.ses) {
            throw new Error('AWS SES configuration is required')
          }
          // 创建 SESv2 客户端
          const sesClient = new SESv2Client({
            region: this.config.ses.region,
            credentials: {
              accessKeyId: this.config.ses.accessKeyId,
              secretAccessKey: this.config.ses.secretAccessKey,
            },
          })
          this.transporter = nodemailer.createTransport({
            SES: { sesClient, SendEmailCommand },
          })
          break
        }

        case 'console':
          // 开发环境：输出到控制台
          this.transporter = nodemailer.createTransport({
            streamTransport: true,
            newline: 'unix',
            buffer: true,
          })
          break

        default:
          throw new Error(`Unsupported email provider: ${this.config.provider}`)
      }

      logger.info(`Email service initialized with provider: ${this.config.provider}`)
    } catch (error) {
      logger.error(
        {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                  code: (error as HttpErrorLike).code,
                  statusCode: (error as HttpErrorLike).statusCode,
                  response: (error as HttpErrorLike).response,
                }
              : error,
          provider: this.config.provider,
          config:
            this.config.provider === 'ses'
              ? {
                  region: this.config.ses?.region,
                  hasAccessKey: !!this.config.ses?.accessKeyId,
                  hasSecretKey: !!this.config.ses?.secretAccessKey,
                }
              : undefined,
        },
        'Failed to initialize email service',
      )
      throw error
    }
  }

  /**
   * 发送邮件
   */
  async sendEmail(message: EmailMessage): Promise<boolean> {
    if (!this.transporter) {
      throw new Error('Email transporter not initialized')
    }

    try {
      const mailOptions = {
        from: this.config.fromName ? `${this.config.fromName} <${this.config.from}>` : this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }

      if (this.config.provider === 'console') {
        // 开发环境：输出到控制台
        logger.info('📧 邮件发送 (开发模式):')
        logger.info(`收件人: ${message.to}`)
        logger.info(`主题: ${message.subject}`)
        logger.info(`内容: ${message.text}`)
        return true
      }

      const result = await this.transporter.sendMail(mailOptions)
      logger.info({ msg: `Email sent successfully to ${message.to}`, messageId: result.messageId })
      return true
    } catch (error) {
      logger.error(
        {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                  code: (error as HttpErrorLike).code,
                  statusCode: (error as HttpErrorLike).statusCode,
                  response: (error as HttpErrorLike).response,
                }
              : error,
          recipient: message.to,
          provider: this.config.provider,
        },
        `Failed to send email to ${message.to}`,
      )
      return false
    }
  }

  /**
   * 发送验证码邮件
   */
  async sendVerificationCode(data: VerificationEmailData): Promise<boolean> {
    const { email, code, purpose, playerName } = data

    const subject = purpose === 'bind' ? '绑定邮箱验证码 - 阿卡迪亚永恒' : '恢复玩家ID验证码 - 阿卡迪亚永恒'
    const purposeText = purpose === 'bind' ? '绑定邮箱' : '恢复玩家ID'

    const templateData = {
      code,
      purposeText,
      playerName,
      subject,
    }

    let text: string
    let html: string

    try {
      // Try to use external templates
      text = renderVerificationText(templateData)
      html = renderVerificationHtml(templateData)
    } catch (error) {
      logger.warn({ msg: 'Failed to render external templates, using fallback', error })
      // Fallback to simple templates
      text = this.generateFallbackText(templateData)
      html = this.generateFallbackHtml(templateData)
    }

    return this.sendEmail({
      to: email,
      subject,
      text,
      html,
    })
  }

  /**
   * Generate fallback text template
   */
  private generateFallbackText(data: { code: string; purposeText: string; playerName?: string }): string {
    const { code, purposeText, playerName } = data
    const playerText = playerName ? `玩家：${playerName}` : ''

    return `
您好！

您正在进行${purposeText}操作。
${playerText}

您的验证码是：${code}

验证码有效期为10分钟，请及时使用。
如果这不是您的操作，请忽略此邮件。

---
阿卡迪亚永恒团队
    `.trim()
  }

  /**
   * Generate fallback HTML template
   */
  private generateFallbackHtml(data: {
    code: string
    purposeText: string
    playerName?: string
    subject: string
  }): string {
    const { code, purposeText, playerName } = data
    const playerText = playerName ? `玩家：${playerName}` : ''

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>验证码邮件</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
        .code { background: #1f2937; color: #f3f4f6; padding: 15px; font-size: 24px; font-weight: bold; text-align: center; border-radius: 6px; margin: 20px 0; letter-spacing: 3px; }
        .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 14px; color: #6b7280; }
        .warning { background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 6px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎮 阿卡迪亚永恒</h1>
            <p>${purposeText}验证码</p>
        </div>
        <div class="content">
            <p>您好！</p>
            <p>您正在进行<strong>${purposeText}</strong>操作。</p>
            ${playerText ? `<p>玩家：<strong>${playerText}</strong></p>` : ''}

            <p>您的验证码是：</p>
            <div class="code">${code}</div>

            <div class="warning">
                <p><strong>⚠️ 重要提醒：</strong></p>
                <ul>
                    <li>验证码有效期为 <strong>10分钟</strong></li>
                    <li>请勿将验证码告诉他人</li>
                    <li>如果这不是您的操作，请忽略此邮件</li>
                </ul>
            </div>

            <div class="footer">
                <p>此邮件由系统自动发送，请勿回复。</p>
                <p>如有疑问，请联系客服。</p>
                <p>---<br>阿卡迪亚永恒团队</p>
            </div>
        </div>
    </div>
</body>
</html>
    `.trim()
  }

  /**
   * 验证邮件服务连接
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false
    }

    if (this.config.provider === 'console') {
      return true
    }

    try {
      await this.transporter.verify()
      logger.info('Email service connection verified')
      return true
    } catch (error) {
      logger.error(
        {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                  code: (error as HttpErrorLike).code,
                  statusCode: (error as HttpErrorLike).statusCode,
                  response: (error as HttpErrorLike).response,
                }
              : error,
          provider: this.config.provider,
        },
        'Email service connection failed',
      )
      return false
    }
  }
}

// 命令行参数接口
export interface EmailCliOptions {
  emailProvider?: string
  emailFrom?: string
  emailFromName?: string
  smtpHost?: string
  smtpPort?: string
  smtpSecure?: boolean
  smtpUser?: string
  smtpPass?: string
  sendgridApiKey?: string
  awsSesRegion?: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
}

/**
 * 从环境变量创建邮件配置
 */
export function createEmailConfigFromEnv(): EmailConfig {
  const provider = (process.env.EMAIL_PROVIDER || 'console') as EmailConfig['provider']

  const config: EmailConfig = {
    provider,
    from: process.env.EMAIL_FROM || 'noreply@yuuinih.com',
    fromName: process.env.EMAIL_FROM_NAME || '阿卡迪亚永恒',
  }

  switch (provider) {
    case 'smtp':
      config.smtp = {
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      }
      break

    case 'sendgrid':
      config.sendgrid = {
        apiKey: process.env.SENDGRID_API_KEY || '',
      }
      break

    case 'ses':
      config.ses = {
        region: process.env.AWS_SES_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      }
      break

    case 'console':
      // 开发环境，无需额外配置
      break
  }

  return config
}

/**
 * 从命令行参数创建邮件配置（优先级：命令行参数 > 环境变量 > 默认值）
 */
export function createEmailConfigFromCli(cliOptions: EmailCliOptions): EmailConfig {
  const provider = (cliOptions.emailProvider || process.env.EMAIL_PROVIDER || 'console') as EmailConfig['provider']

  const config: EmailConfig = {
    provider,
    from: cliOptions.emailFrom || process.env.EMAIL_FROM || 'noreply@yuuinih.com',
    fromName: cliOptions.emailFromName || process.env.EMAIL_FROM_NAME || '阿卡迪亚永恒',
  }

  switch (provider) {
    case 'smtp':
      config.smtp = {
        host: cliOptions.smtpHost || process.env.SMTP_HOST || '',
        port: parseInt(cliOptions.smtpPort || process.env.SMTP_PORT || '587'),
        secure: cliOptions.smtpSecure !== undefined ? cliOptions.smtpSecure : process.env.SMTP_SECURE === 'true',
        auth: {
          user: cliOptions.smtpUser || process.env.SMTP_USER || '',
          pass: cliOptions.smtpPass || process.env.SMTP_PASS || '',
        },
      }
      break

    case 'sendgrid':
      config.sendgrid = {
        apiKey: cliOptions.sendgridApiKey || process.env.SENDGRID_API_KEY || '',
      }
      break

    case 'ses':
      config.ses = {
        region: cliOptions.awsSesRegion || process.env.AWS_SES_REGION || 'us-east-1',
        accessKeyId: cliOptions.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: cliOptions.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '',
      }
      break

    case 'console':
      // 开发环境，无需额外配置
      break
  }

  return config
}

// 创建默认邮件服务实例
let emailServiceInstance: EmailService | null = null

export function getEmailService(): EmailService {
  if (!emailServiceInstance) {
    const config = createEmailConfigFromEnv()
    emailServiceInstance = new EmailService(config)
  }
  return emailServiceInstance
}
