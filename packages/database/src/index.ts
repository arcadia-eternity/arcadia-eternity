import { BattleRepository } from './repositories/battleRepository'
import { PlayerRepository } from './repositories/playerRepository'
import { EmailVerificationRepository } from './repositories/EmailVerificationRepository'

// 导出所有类型
export * from './types'

// 导出客户端
export * from './client'

// 导出仓库
export { PlayerRepository } from './repositories/playerRepository'
export { BattleRepository } from './repositories/battleRepository'
export { EmailVerificationRepository } from './repositories/EmailVerificationRepository'

// 导出数据库服务类
export class DatabaseService {
  public readonly players: PlayerRepository
  public readonly battles: BattleRepository
  public readonly emailVerification: EmailVerificationRepository

  constructor() {
    this.players = new PlayerRepository()
    this.battles = new BattleRepository()
    this.emailVerification = new EmailVerificationRepository()
  }
}

// 创建默认实例
export const databaseService = new DatabaseService()
