import { type TimerEvent, type TimerEventBatch, type TimerSnapshot, TIMER_CONSTANTS } from '@arcadia-eternity/const'
import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

const createChildLogger = (name: string) => logger.child({ component: name })

/**
 * Timer事件批处理器
 * 批量处理Timer事件，减少网络传输频率
 */
export class TimerEventBatcher {
  private readonly logger = createChildLogger('TimerEventBatcher')

  // 按会话分组的事件批次
  private readonly sessionBatches = new Map<string, TimerEventBatch>()

  // 快照批次 - 特殊处理，因为快照包含完整状态
  private readonly snapshotBatches = new Map<
    string,
    {
      snapshots: TimerSnapshot[]
      createdAt: number
      timer?: ReturnType<typeof setTimeout>
    }
  >()

  // 需要立即发送的事件类型
  private readonly immediateEventTypes = new Set(['start', 'timeout', 'stateChange'])

  constructor(private readonly sendCallback: (sessionKey: string, eventType: string, data: any) => Promise<void>) {}

  /**
   * 添加Timer事件到批次
   */
  public addEvent(sessionKey: string, event: TimerEvent): void {
    // 检查是否需要立即发送
    const isImmediate = this.immediateEventTypes.has(event.type)

    if (isImmediate) {
      // 立即发送重要事件
      this.sendCallback(sessionKey, 'timerEvent', event).catch(error => {
        this.logger.error({ error, sessionKey, eventType: event.type }, 'Failed to send immediate timer event')
      })
      return
    }

    // 添加到批次
    let batch = this.sessionBatches.get(sessionKey)
    if (!batch) {
      batch = {
        events: [],
        createdAt: Date.now(),
      }
      this.sessionBatches.set(sessionKey, batch)
    }

    // 清除之前的定时器
    if (batch.timer) {
      clearTimeout(batch.timer)
    }

    // 添加事件到批次
    batch.events.push(event)

    // 检查是否需要立即发送批次
    if (batch.events.length >= TIMER_CONSTANTS.TIMER_EVENT_BATCH_SIZE) {
      this.flushEventBatch(sessionKey)
    } else {
      // 设置定时器，在超时后发送
      batch.timer = setTimeout(() => {
        this.flushEventBatch(sessionKey)
      }, TIMER_CONSTANTS.TIMER_EVENT_BATCH_TIMEOUT)
    }
  }

  /**
   * 添加Timer快照到批次
   */
  public addSnapshots(sessionKey: string, snapshots: TimerSnapshot[]): void {
    let batch = this.snapshotBatches.get(sessionKey)
    if (!batch) {
      batch = {
        snapshots: [],
        createdAt: Date.now(),
      }
      this.snapshotBatches.set(sessionKey, batch)
    }

    // 清除之前的定时器
    if (batch.timer) {
      clearTimeout(batch.timer)
    }

    // 合并快照（相同玩家的快照会被覆盖，保持最新状态）
    const playerSnapshotMap = new Map<string, TimerSnapshot>()

    // 先添加现有快照
    batch.snapshots.forEach(snapshot => {
      playerSnapshotMap.set(snapshot.playerId, snapshot)
    })

    // 再添加新快照（会覆盖旧的）
    snapshots.forEach(snapshot => {
      playerSnapshotMap.set(snapshot.playerId, snapshot)
    })

    // 更新批次
    batch.snapshots = Array.from(playerSnapshotMap.values())

    // 快照通常需要及时发送，使用较短的超时时间
    batch.timer = setTimeout(() => {
      this.flushSnapshotBatch(sessionKey)
    }, TIMER_CONSTANTS.TIMER_EVENT_BATCH_TIMEOUT / 2) // 快照批次使用更短的超时
  }

  /**
   * 立即发送事件批次
   */
  private flushEventBatch(sessionKey: string): void {
    const batch = this.sessionBatches.get(sessionKey)
    if (!batch || batch.events.length === 0) {
      return
    }

    const events = [...batch.events]

    // 清理批次
    if (batch.timer) {
      clearTimeout(batch.timer)
    }
    this.sessionBatches.delete(sessionKey)

    // 发送批次
    this.sendCallback(sessionKey, 'timerEventBatch', events).catch(error => {
      this.logger.error({ error, sessionKey, eventCount: events.length }, 'Failed to send timer event batch')
    })

    this.logger.debug(`Flushed timer event batch for ${sessionKey}, events: ${events.length}`)
  }

  /**
   * 立即发送快照批次
   */
  private flushSnapshotBatch(sessionKey: string): void {
    const batch = this.snapshotBatches.get(sessionKey)
    if (!batch || batch.snapshots.length === 0) {
      return
    }

    const snapshots = [...batch.snapshots]

    // 清理批次
    if (batch.timer) {
      clearTimeout(batch.timer)
    }
    this.snapshotBatches.delete(sessionKey)

    // 发送快照
    this.sendCallback(sessionKey, 'timerSnapshot', { snapshots }).catch(error => {
      this.logger.error({ error, sessionKey, snapshotCount: snapshots.length }, 'Failed to send timer snapshot batch')
    })

    this.logger.debug(`Flushed timer snapshot batch for ${sessionKey}, snapshots: ${snapshots.length}`)
  }

  /**
   * 立即发送指定会话的所有批次
   */
  public flushSession(sessionKey: string): void {
    this.flushEventBatch(sessionKey)
    this.flushSnapshotBatch(sessionKey)
  }

  /**
   * 立即发送所有批次
   */
  public flushAll(): void {
    const sessionKeys = new Set([...this.sessionBatches.keys(), ...this.snapshotBatches.keys()])

    sessionKeys.forEach(sessionKey => {
      this.flushSession(sessionKey)
    })
  }

  /**
   * 获取批处理统计信息
   */
  public getBatchStats(): {
    eventBatches: number
    snapshotBatches: number
    totalEvents: number
    totalSnapshots: number
  } {
    let totalEvents = 0
    let totalSnapshots = 0

    this.sessionBatches.forEach(batch => {
      totalEvents += batch.events.length
    })

    this.snapshotBatches.forEach(batch => {
      totalSnapshots += batch.snapshots.length
    })

    return {
      eventBatches: this.sessionBatches.size,
      snapshotBatches: this.snapshotBatches.size,
      totalEvents,
      totalSnapshots,
    }
  }

  /**
   * 清理资源
   */
  public cleanup(): void {
    // 发送所有待处理的批次
    this.flushAll()

    // 清理所有定时器
    this.sessionBatches.forEach(batch => {
      if (batch.timer) {
        clearTimeout(batch.timer)
      }
    })

    this.snapshotBatches.forEach(batch => {
      if (batch.timer) {
        clearTimeout(batch.timer)
      }
    })

    // 清理Map
    this.sessionBatches.clear()
    this.snapshotBatches.clear()

    this.logger.info('Timer event batcher cleaned up')
  }
}
