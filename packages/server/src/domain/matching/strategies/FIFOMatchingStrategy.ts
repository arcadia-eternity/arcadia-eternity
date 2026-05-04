import { AbstractMatchingStrategy, type MatchingConfig, type MatchQuality } from './MatchingStrategy'
import type { MatchmakingEntry } from '../../../cluster/types'
import pino from 'pino'

const logger = pino({ name: 'FIFOMatchingStrategy' })

/**
 * FIFO (先进先出) 匹配策略
 * 简单地按照加入队列的顺序进行匹配
 */
export class FIFOMatchingStrategy extends AbstractMatchingStrategy {
  readonly name = 'FIFO'

  async findMatch(
    queue: MatchmakingEntry[],
    config: MatchingConfig,
  ): Promise<{
    player1: MatchmakingEntry
    player2: MatchmakingEntry
    quality: MatchQuality
  } | null> {
    if (queue.length < 2) {
      return null
    }

    // 按加入时间排序，确保FIFO顺序
    const sortedQueue = [...queue].sort((a, b) => a.joinTime - b.joinTime)

    // 取前两个玩家
    const player1 = sortedQueue[0]
    const player2 = sortedQueue[1]

    logger.debug(
      {
        player1: {
          id: player1.playerId,
          joinTime: player1.joinTime,
          waitTime: this.getWaitTimeSeconds(player1),
        },
        player2: {
          id: player2.playerId,
          joinTime: player2.joinTime,
          waitTime: this.getWaitTimeSeconds(player2),
        },
      },
      'FIFO match found',
    )

    const quality = await this.evaluateMatch(player1, player2, config)

    return {
      player1,
      player2,
      quality,
    }
  }

  async evaluateMatch(
    player1: MatchmakingEntry,
    player2: MatchmakingEntry,
    config: MatchingConfig,
  ): Promise<MatchQuality> {
    const waitTimeDifference = this.getWaitTimeDifference(player1, player2)

    // FIFO策略下，匹配质量主要基于等待时间的相似性
    // 等待时间越相近，匹配质量越高
    const maxWaitTimeDiff = 60000 // 1分钟
    const waitTimeScore = Math.max(0, 1 - waitTimeDifference / maxWaitTimeDiff)

    return {
      score: waitTimeScore,
      waitTimeDifference,
      acceptable: true, // FIFO策略下所有匹配都是可接受的
    }
  }

  async isMatchAcceptable(
    player1: MatchmakingEntry,
    player2: MatchmakingEntry,
    config: MatchingConfig,
  ): Promise<boolean> {
    // FIFO策略下，只要有两个玩家就可以匹配
    return true
  }
}
