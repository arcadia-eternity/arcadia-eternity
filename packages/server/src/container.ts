import 'reflect-metadata'
import { Container } from 'inversify'
import { EmailService, createEmailConfigFromEnv, type EmailConfig } from './emailService'
import { AuthService, createAuthConfigFromEnv } from './authService'
import { EmailVerificationRepository, PlayerRepository } from '@arcadia-eternity/database'
import type { IEmailService } from './interfaces/IEmailService'
import type { IAuthService } from './authService'

// 服务标识符
export const TYPES = {
  EmailService: Symbol.for('EmailService'),
  AuthService: Symbol.for('AuthService'),
  EmailVerificationRepository: Symbol.for('EmailVerificationRepository'),
  PlayerRepository: Symbol.for('PlayerRepository'),
}

// 创建DI容器
export function createContainer(emailConfig?: EmailConfig): Container {
  const container = new Container()

  // 绑定邮件服务
  container
    .bind<IEmailService>(TYPES.EmailService)
    .toDynamicValue(() => {
      const config = emailConfig || createEmailConfigFromEnv()
      return new EmailService(config)
    })
    .inSingletonScope()

  // 绑定认证服务
  container
    .bind<IAuthService>(TYPES.AuthService)
    .toDynamicValue(() => {
      const config = createAuthConfigFromEnv()
      return new AuthService(config)
    })
    .inSingletonScope()

  // 绑定数据库仓库
  container
    .bind<EmailVerificationRepository>(TYPES.EmailVerificationRepository)
    .toDynamicValue(() => new EmailVerificationRepository())
    .inSingletonScope()

  container
    .bind<PlayerRepository>(TYPES.PlayerRepository)
    .toDynamicValue(() => new PlayerRepository())
    .inSingletonScope()

  return container
}

// 全局容器实例
let containerInstance: Container | null = null

export function getContainer(emailConfig?: EmailConfig): Container {
  if (!containerInstance) {
    containerInstance = createContainer(emailConfig)
  }
  return containerInstance
}

export function resetContainer(): void {
  containerInstance = null
}
