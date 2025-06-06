import { BattleRepository } from './repositories/battleRepository'
import { PlayerRepository } from './repositories/playerRepository'

// 导出所有类型
export * from './types'

// 导出客户端
export * from './client'

// 导出仓库
export { PlayerRepository } from './repositories/playerRepository'
export { BattleRepository } from './repositories/battleRepository'

// 导出数据库服务类
export class DatabaseService {
  public readonly players: PlayerRepository
  public readonly battles: BattleRepository

  constructor() {
    this.players = new PlayerRepository()
    this.battles = new BattleRepository()
  }
}

// 创建默认实例
export const databaseService = new DatabaseService()
