import { BattleMessageType, type BattleMessage } from '@arcadia-eternity/const'
import { databaseService, initializeSupabase, type DatabaseConfig } from '@arcadia-eternity/database'
import type { Logger } from 'pino'

export interface BattleReportConfig {
  database: DatabaseConfig
  enableReporting: boolean
}

/**
 * 战报服务 - 负责保存和管理战斗记录
 */
export class BattleReportService {
  private logger: Logger
  private config: BattleReportConfig
  private activeBattles = new Map<
    string,
    {
      recordId: string
      messages: BattleMessage[]
      startTime: Date
      playerAId: string
      playerBId: string
    }
  >()

  constructor(config: BattleReportConfig, logger: Logger) {
    this.config = config
    this.logger = logger.child({ service: 'BattleReportService' })

    if (config.enableReporting) {
      initializeSupabase(config.database)
      this.logger.info('Battle report service initialized')
    } else {
      this.logger.info('Battle report service disabled')
    }
  }

  /**
   * 开始记录战斗
   */
  async startBattleRecord(
    battleId: string,
    playerAId: string,
    playerAName: string,
    playerBId: string,
    playerBName: string,
  ): Promise<string | null> {
    if (!this.config.enableReporting) {
      this.logger.debug({ battleId }, 'Battle reporting disabled')
      return null
    }

    try {
      this.logger.info(
        {
          battleId,
          playerAId,
          playerAName,
          playerBId,
          playerBName,
        },
        'Creating battle record...',
      )

      // 确保玩家存在
      this.logger.debug({ battleId }, 'Ensuring players exist...')
      await Promise.all([
        databaseService.players.ensurePlayer(playerAId, playerAName),
        databaseService.players.ensurePlayer(playerBId, playerBName),
      ])
      this.logger.debug({ battleId }, 'Players ensured successfully')

      // 创建战报记录
      this.logger.debug({ battleId }, 'Creating battle record in database...')
      const battleRecord = await databaseService.battles.createBattleRecord({
        player_a_id: playerAId,
        player_a_name: playerAName,
        player_b_id: playerBId,
        player_b_name: playerBName,
        metadata: { battleId },
      })
      this.logger.debug({ battleId, recordId: battleRecord.id }, 'Battle record created in database')

      // 记录活跃战斗
      this.activeBattles.set(battleId, {
        recordId: battleRecord.id,
        messages: [],
        startTime: new Date(),
        playerAId,
        playerBId,
      })

      this.logger.info(
        {
          battleId,
          recordId: battleRecord.id,
          playerAId,
          playerBId,
          activeBattlesCount: this.activeBattles.size,
        },
        'Started battle record successfully',
      )

      return battleRecord.id
    } catch (error) {
      this.logger.error({ error, battleId, playerAId, playerBId }, 'Failed to start battle record')
      return null
    }
  }

  /**
   * 记录战斗消息
   */
  recordBattleMessage(battleId: string, message: BattleMessage): void {
    if (!this.config.enableReporting) {
      return
    }

    const battleData = this.activeBattles.get(battleId)
    if (!battleData) {
      this.logger.warn(
        {
          battleId,
          messageType: message.type,
          activeBattles: Array.from(this.activeBattles.keys()),
          activeBattlesCount: this.activeBattles.size,
        },
        'Attempted to record message for unknown battle',
      )
      return
    }

    // 调试：检查消息是否包含 stateDelta
    this.logger.debug(
      {
        battleId,
        messageType: message.type,
        hasStateDelta: !!message.stateDelta,
        stateDeltaType: typeof message.stateDelta,
        messageKeys: Object.keys(message),
      },
      'Recording battle message with stateDelta info',
    )

    battleData.messages.push(message)
    this.logger.debug(
      {
        battleId,
        messageType: message.type,
        messageCount: battleData.messages.length,
      },
      'Recorded battle message',
    )

    // 如果是战斗结束消息，完成战报记录
    if (message.type === BattleMessageType.BattleEnd) {
      this.completeBattleRecord(battleId, message)
    }
  }

  /**
   * 完成战报记录
   */
  private async completeBattleRecord(battleId: string, endMessage: BattleMessage): Promise<void> {
    const battleData = this.activeBattles.get(battleId)
    if (!battleData) {
      return
    }

    try {
      // 确定胜者和战斗结果
      const endData = endMessage.data as any
      const winnerId = endData.winner
      let battleResult: string
      let endReason: string

      if (winnerId === null) {
        battleResult = 'draw'
        endReason = endData.reason || 'all_pet_fainted'
      } else if (winnerId === battleData.playerAId) {
        battleResult = 'player_a_wins'
        endReason = endData.reason || 'all_pet_fainted'
      } else if (winnerId === battleData.playerBId) {
        battleResult = 'player_b_wins'
        endReason = endData.reason || 'all_pet_fainted'
      } else {
        battleResult = 'abandoned'
        endReason = 'disconnect'
      }

      // 获取最终状态
      const finalState = endMessage.stateDelta || {}

      // 调试：检查保存前的消息
      this.logger.debug(
        {
          battleId,
          messageCount: battleData.messages.length,
          firstMessageHasStateDelta: !!battleData.messages[0]?.stateDelta,
          sampleMessage: battleData.messages[0]
            ? {
                type: battleData.messages[0].type,
                hasStateDelta: !!battleData.messages[0].stateDelta,
                stateDeltaKeys: battleData.messages[0].stateDelta
                  ? Object.keys(battleData.messages[0].stateDelta)
                  : null,
              }
            : null,
        },
        'Saving battle messages to database',
      )

      // 更新战报记录
      await databaseService.battles.completeBattleRecord(
        battleData.recordId,
        winnerId,
        battleResult,
        endReason,
        battleData.messages,
        finalState,
      )

      this.logger.info(
        {
          battleId,
          recordId: battleData.recordId,
          winnerId,
          battleResult,
          messageCount: battleData.messages.length,
        },
        'Completed battle record',
      )
    } catch (error) {
      this.logger.error({ error, battleId }, 'Failed to complete battle record')
    } finally {
      // 清理活跃战斗记录
      this.activeBattles.delete(battleId)
    }
  }

  /**
   * 强制完成战报（用于异常情况）
   */
  async forceBattleComplete(battleId: string, reason: 'timeout' | 'disconnect' = 'disconnect'): Promise<void> {
    if (!this.config.enableReporting) {
      return
    }

    const battleData = this.activeBattles.get(battleId)
    if (!battleData) {
      return
    }

    try {
      await databaseService.battles.updateBattleRecord(battleData.recordId, {
        ended_at: new Date().toISOString(),
        battle_result: 'abandoned',
        end_reason: reason,
        battle_messages: battleData.messages,
        final_state: {}, // 空对象作为默认最终状态
      })

      this.logger.info(
        {
          battleId,
          recordId: battleData.recordId,
          reason,
        },
        'Force completed battle record',
      )
    } catch (error) {
      this.logger.error({ error, battleId }, 'Failed to force complete battle record')
    } finally {
      this.activeBattles.delete(battleId)
    }
  }

  /**
   * 获取活跃战斗数量
   */
  getActiveBattleCount(): number {
    return this.activeBattles.size
  }

  /**
   * 清理所有活跃战斗（服务器关闭时调用）
   */
  async cleanup(): Promise<void> {
    if (!this.config.enableReporting) {
      return
    }

    const activeBattleIds = Array.from(this.activeBattles.keys())

    await Promise.all(activeBattleIds.map(battleId => this.forceBattleComplete(battleId, 'disconnect')))

    this.logger.info(
      {
        cleanedBattles: activeBattleIds.length,
      },
      'Cleaned up active battles',
    )
  }

  /**
   * 定期清理废弃的战报
   */
  async cleanupAbandonedBattles(): Promise<number> {
    if (!this.config.enableReporting) {
      return 0
    }

    try {
      const cleanedCount = await databaseService.battles.cleanupAbandonedBattles(24)

      if (cleanedCount > 0) {
        this.logger.info({ cleanedCount }, 'Cleaned up abandoned battles')
      }

      return cleanedCount
    } catch (error) {
      this.logger.error({ error }, 'Failed to cleanup abandoned battles')
      return 0
    }
  }
}
