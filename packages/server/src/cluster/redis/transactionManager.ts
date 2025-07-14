import { nanoid } from 'nanoid'
import pino from 'pino'
import type { RedisClientManager } from './redisClient'
import type { DistributedLockManager } from './distributedLock'
import { ClusterError } from '../types'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export interface TransactionOperation {
  type: 'set' | 'del' | 'sadd' | 'srem' | 'hset' | 'hdel' | 'zadd' | 'zrem'
  key: string
  value?: any
  field?: string
  score?: number
  ttl?: number
}

export interface TransactionOptions {
  timeout?: number // 事务超时时间（毫秒）
  retryCount?: number // 重试次数
  retryDelay?: number // 重试延迟（毫秒）
  lockKeys?: string[] // 需要锁定的键
}

export interface TransactionResult {
  success: boolean
  transactionId: string
  operations: TransactionOperation[]
  error?: string
  executedOperations: number
}

export class TransactionManager {
  private redisManager: RedisClientManager
  private lockManager: DistributedLockManager
  private defaultOptions: Required<TransactionOptions>

  constructor(redisManager: RedisClientManager, lockManager: DistributedLockManager) {
    this.redisManager = redisManager
    this.lockManager = lockManager
    this.defaultOptions = {
      timeout: 30000, // 30秒超时
      retryCount: 3,
      retryDelay: 1000, // 1秒重试延迟
      lockKeys: [],
    }
  }

  /**
   * 执行分布式事务
   */
  async executeTransaction(
    operations: TransactionOperation[],
    options: TransactionOptions = {},
  ): Promise<TransactionResult> {
    const opts = { ...this.defaultOptions, ...options }
    const transactionId = nanoid()
    const client = this.redisManager.getClient()

    logger.debug({ transactionId, operationCount: operations.length }, 'Starting distributed transaction')

    let executedOperations = 0
    const acquiredLocks: Array<{ key: string; lock: any }> = []

    try {
      // 获取所有需要的锁
      if (opts.lockKeys.length > 0) {
        for (const lockKey of opts.lockKeys) {
          const lock = await this.lockManager.acquireLock(lockKey, {
            ttl: opts.timeout,
            retryCount: opts.retryCount,
            retryDelay: opts.retryDelay,
          })
          acquiredLocks.push({ key: lockKey, lock })
        }
      }

      // 创建事务记录
      await this.createTransactionRecord(transactionId, operations)

      // 执行事务操作
      const multi = client.multi()

      for (const operation of operations) {
        this.addOperationToMulti(multi, operation)
      }

      // 执行事务
      const results = await multi.exec()

      if (!results) {
        throw new ClusterError('Transaction execution failed', 'TRANSACTION_FAILED')
      }

      // 检查结果
      for (let i = 0; i < results.length; i++) {
        const [error, _result] = results[i]
        if (error) {
          throw new ClusterError(`Operation ${i} failed: ${error.message}`, 'OPERATION_FAILED', error)
        }
        executedOperations++
      }

      // 标记事务为成功
      await this.markTransactionComplete(transactionId, true)

      logger.info({ transactionId, executedOperations }, 'Transaction completed successfully')

      return {
        success: true,
        transactionId,
        operations,
        executedOperations,
      }
    } catch (error) {
      logger.error({ error, transactionId, executedOperations }, 'Transaction failed')

      // 尝试回滚已执行的操作
      try {
        await this.rollbackTransaction(transactionId, operations.slice(0, executedOperations))
      } catch (rollbackError) {
        logger.error({ rollbackError, transactionId }, 'Transaction rollback failed')
      }

      // 标记事务为失败
      await this.markTransactionComplete(transactionId, false)

      return {
        success: false,
        transactionId,
        operations,
        executedOperations,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    } finally {
      // 释放所有锁
      for (const { lock } of acquiredLocks) {
        try {
          await this.lockManager.releaseLock(lock)
        } catch (error) {
          logger.error({ error, transactionId }, 'Failed to release lock')
        }
      }
    }
  }

  /**
   * 执行原子操作（单个操作的事务）
   */
  async executeAtomicOperation(operation: TransactionOperation, lockKey?: string): Promise<TransactionResult> {
    const lockKeys = lockKey ? [lockKey] : []
    return this.executeTransaction([operation], { lockKeys })
  }

  /**
   * 批量执行操作（带锁）
   */
  async executeBatch(operations: TransactionOperation[], lockKeys: string[] = []): Promise<TransactionResult> {
    return this.executeTransaction(operations, { lockKeys })
  }

  private addOperationToMulti(multi: any, operation: TransactionOperation): void {
    switch (operation.type) {
      case 'set':
        if (operation.ttl) {
          multi.setex(operation.key, Math.floor(operation.ttl / 1000), operation.value)
        } else {
          multi.set(operation.key, operation.value)
        }
        break

      case 'del':
        multi.del(operation.key)
        break

      case 'sadd':
        multi.sadd(operation.key, operation.value)
        break

      case 'srem':
        multi.srem(operation.key, operation.value)
        break

      case 'hset':
        if (operation.field) {
          multi.hset(operation.key, operation.field, operation.value)
        } else {
          multi.hset(operation.key, operation.value)
        }
        break

      case 'hdel':
        if (operation.field) {
          multi.hdel(operation.key, operation.field)
        }
        break

      case 'zadd':
        if (operation.score !== undefined) {
          multi.zadd(operation.key, operation.score, operation.value)
        }
        break

      case 'zrem':
        multi.zrem(operation.key, operation.value)
        break

      default:
        throw new ClusterError(`Unsupported operation type: ${operation.type}`, 'UNSUPPORTED_OPERATION')
    }
  }

  private async createTransactionRecord(transactionId: string, operations: TransactionOperation[]): Promise<void> {
    const client = this.redisManager.getClient()
    const record = {
      id: transactionId,
      operations: JSON.stringify(operations),
      status: 'pending',
      createdAt: Date.now(),
    }

    await client.hset(`transaction:${transactionId}`, record)
    await client.expire(`transaction:${transactionId}`, 3600) // 1小时过期
  }

  private async markTransactionComplete(transactionId: string, success: boolean): Promise<void> {
    const client = this.redisManager.getClient()
    await client.hset(`transaction:${transactionId}`, {
      status: success ? 'completed' : 'failed',
      completedAt: Date.now(),
    })
  }

  private async rollbackTransaction(transactionId: string, executedOperations: TransactionOperation[]): Promise<void> {
    logger.warn({ transactionId, operationCount: executedOperations.length }, 'Starting transaction rollback')

    const client = this.redisManager.getClient()
    const rollbackOps: TransactionOperation[] = []

    // 生成回滚操作（简化版本）
    for (const operation of executedOperations.reverse()) {
      const rollbackOp = this.generateRollbackOperation(operation)
      if (rollbackOp) {
        rollbackOps.push(rollbackOp)
      }
    }

    if (rollbackOps.length > 0) {
      const multi = client.multi()
      for (const operation of rollbackOps) {
        this.addOperationToMulti(multi, operation)
      }
      await multi.exec()
    }

    // 记录回滚信息
    await client.hset(`transaction:${transactionId}`, {
      status: 'rolled_back',
      rollbackAt: Date.now(),
      rollbackOperations: JSON.stringify(rollbackOps),
    })

    logger.info({ transactionId, rollbackOperations: rollbackOps.length }, 'Transaction rollback completed')
  }

  private generateRollbackOperation(operation: TransactionOperation): TransactionOperation | null {
    // 简化的回滚逻辑 - 实际实现中需要更复杂的状态跟踪
    switch (operation.type) {
      case 'set':
        return { type: 'del', key: operation.key }
      case 'del':
        // 无法回滚删除操作，除非事先保存了值
        return null
      case 'sadd':
        return { type: 'srem', key: operation.key, value: operation.value }
      case 'srem':
        return { type: 'sadd', key: operation.key, value: operation.value }
      case 'hset':
        return { type: 'hdel', key: operation.key, field: operation.field }
      case 'hdel':
        // 无法回滚哈希字段删除，除非事先保存了值
        return null
      case 'zadd':
        return { type: 'zrem', key: operation.key, value: operation.value }
      case 'zrem':
        if (operation.score !== undefined) {
          return { type: 'zadd', key: operation.key, value: operation.value, score: operation.score }
        }
        return null
      default:
        return null
    }
  }

  /**
   * 获取事务状态
   */
  async getTransactionStatus(transactionId: string): Promise<{
    id: string
    status: string
    createdAt: number
    completedAt?: number
    operations: TransactionOperation[]
  } | null> {
    try {
      const client = this.redisManager.getClient()
      const record = await client.hgetall(`transaction:${transactionId}`)

      if (Object.keys(record).length === 0) {
        return null
      }

      return {
        id: record.id,
        status: record.status,
        createdAt: parseInt(record.createdAt),
        completedAt: record.completedAt ? parseInt(record.completedAt) : undefined,
        operations: JSON.parse(record.operations),
      }
    } catch (error) {
      logger.error({ error, transactionId }, 'Failed to get transaction status')
      return null
    }
  }

  /**
   * 清理过期的事务记录
   */
  async cleanupExpiredTransactions(): Promise<number> {
    try {
      const client = this.redisManager.getClient()
      const pattern = 'transaction:*'
      const keys = await client.keys(pattern)

      let cleanedCount = 0
      const now = Date.now()
      const maxAge = 24 * 60 * 60 * 1000 // 24小时

      for (const key of keys) {
        const record = await client.hgetall(key)
        if (record.createdAt) {
          const age = now - parseInt(record.createdAt)
          if (age > maxAge) {
            await client.del(key)
            cleanedCount++
          }
        }
      }

      if (cleanedCount > 0) {
        logger.info({ cleanedCount }, 'Cleaned up expired transaction records')
      }

      return cleanedCount
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup expired transactions')
      return 0
    }
  }
}

// 常用事务操作的便捷函数
export class TransactionBuilder {
  private operations: TransactionOperation[] = []

  set(key: string, value: any, ttl?: number): this {
    this.operations.push({ type: 'set', key, value, ttl })
    return this
  }

  del(key: string): this {
    this.operations.push({ type: 'del', key })
    return this
  }

  sadd(key: string, value: any): this {
    this.operations.push({ type: 'sadd', key, value })
    return this
  }

  srem(key: string, value: any): this {
    this.operations.push({ type: 'srem', key, value })
    return this
  }

  hset(key: string, field: string, value: any): this {
    this.operations.push({ type: 'hset', key, field, value })
    return this
  }

  hdel(key: string, field: string): this {
    this.operations.push({ type: 'hdel', key, field })
    return this
  }

  zadd(key: string, score: number, value: any): this {
    this.operations.push({ type: 'zadd', key, score, value })
    return this
  }

  zrem(key: string, value: any): this {
    this.operations.push({ type: 'zrem', key, value })
    return this
  }

  build(): TransactionOperation[] {
    return [...this.operations]
  }

  clear(): this {
    this.operations = []
    return this
  }
}
