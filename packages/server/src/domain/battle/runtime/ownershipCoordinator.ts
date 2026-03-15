import pino from 'pino'
import { REDIS_KEYS } from '../../../cluster/types'
import { TTLHelper } from '../../../cluster/config/ttlConfig'

export type RuntimeOwnershipStatus = 'idle' | 'active' | 'draining' | 'released'

export type RuntimeOwnershipRecord = {
  roomId: string
  ownerInstanceId: string
  status: RuntimeOwnershipStatus
  leaseExpireAt?: number
  lastUpdatedAt: number
}

export interface OwnershipCoordinator {
  claim(roomId: string, ownerInstanceId: string): Promise<RuntimeOwnershipRecord>
  get(roomId: string): Promise<RuntimeOwnershipRecord | null>
  markDraining(roomId: string, ownerInstanceId: string): Promise<void>
  release(roomId: string, ownerInstanceId: string): Promise<void>
}

type RedisClientLike = {
  get(key: string): Promise<string | null>
  setex(key: string, seconds: number, value: string): Promise<unknown>
  set?(...args: any[]): Promise<unknown>
  del(key: string): Promise<number>
}

type RedisManagerLike = {
  getClient(): RedisClientLike
}

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export class InMemoryOwnershipCoordinator implements OwnershipCoordinator {
  private readonly records = new Map<string, RuntimeOwnershipRecord>()

  async claim(roomId: string, ownerInstanceId: string): Promise<RuntimeOwnershipRecord> {
    const record: RuntimeOwnershipRecord = {
      roomId,
      ownerInstanceId,
      status: 'active',
      lastUpdatedAt: Date.now(),
    }
    this.records.set(roomId, record)
    return record
  }

  async get(roomId: string): Promise<RuntimeOwnershipRecord | null> {
    return this.records.get(roomId) ?? null
  }

  async markDraining(roomId: string, ownerInstanceId: string): Promise<void> {
    const record = this.records.get(roomId)
    if (!record || record.ownerInstanceId !== ownerInstanceId) {
      return
    }
    record.status = 'draining'
    record.lastUpdatedAt = Date.now()
  }

  async release(roomId: string, ownerInstanceId: string): Promise<void> {
    const record = this.records.get(roomId)
    if (!record || record.ownerInstanceId !== ownerInstanceId) {
      return
    }
    record.status = 'released'
    record.lastUpdatedAt = Date.now()
    this.records.delete(roomId)
  }
}

export class RedisOwnershipCoordinator implements OwnershipCoordinator {
  private readonly leaseTtlMs: number

  constructor(
    private readonly redisManager: RedisManagerLike,
    private readonly instanceId: string,
    leaseTtlMs?: number,
  ) {
    this.leaseTtlMs = leaseTtlMs ?? TTLHelper.getTTLForDataType('lock')
  }

  async claim(roomId: string, ownerInstanceId: string): Promise<RuntimeOwnershipRecord> {
    const now = Date.now()
    const record: RuntimeOwnershipRecord = {
      roomId,
      ownerInstanceId,
      status: 'active',
      leaseExpireAt: now + this.leaseTtlMs,
      lastUpdatedAt: now,
    }

    try {
      const created = await this.tryCreateRecord(record)
      if (created) {
        return record
      }

      const existing = await this.get(roomId)

      if (!existing) {
        await this.writeRecord(record)
        return record
      }

      // Same owner re-claims: refresh lease and lastUpdatedAt.
      if (existing.ownerInstanceId === ownerInstanceId) {
        const refreshed: RuntimeOwnershipRecord = {
          ...existing,
          status: 'active',
          leaseExpireAt: now + this.leaseTtlMs,
          lastUpdatedAt: now,
        }
        await this.writeRecord(refreshed)
        return refreshed
      }

      // Another owner already holds ownership. Return existing record as arbitration result.
      return existing
    } catch (error) {
      logger.warn(
        { roomId, ownerInstanceId, instanceId: this.instanceId, error },
        'Failed to persist ownership claim to Redis',
      )
    }

    return record
  }

  async get(roomId: string): Promise<RuntimeOwnershipRecord | null> {
    try {
      const client = this.redisManager.getClient()
      const raw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP(roomId))
      if (!raw) return null

      const parsed = JSON.parse(raw) as RuntimeOwnershipRecord
      if (parsed.roomId !== roomId) return null
      return parsed
    } catch (error) {
      logger.warn({ roomId, instanceId: this.instanceId, error }, 'Failed to read ownership record from Redis')
      return null
    }
  }

  async markDraining(roomId: string, ownerInstanceId: string): Promise<void> {
    const record = await this.get(roomId)
    if (!record || record.ownerInstanceId !== ownerInstanceId) {
      return
    }

    const now = Date.now()
    const next: RuntimeOwnershipRecord = {
      ...record,
      status: 'draining',
      leaseExpireAt: now + this.leaseTtlMs,
      lastUpdatedAt: now,
    }

    try {
      await this.writeRecord(next)
    } catch (error) {
      logger.warn(
        { roomId, ownerInstanceId, instanceId: this.instanceId, error },
        'Failed to persist draining ownership state to Redis',
      )
    }
  }

  async release(roomId: string, ownerInstanceId: string): Promise<void> {
    const record = await this.get(roomId)
    if (!record || record.ownerInstanceId !== ownerInstanceId) {
      return
    }

    try {
      const client = this.redisManager.getClient()
      await client.del(REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP(roomId))
    } catch (error) {
      logger.warn(
        { roomId, ownerInstanceId, instanceId: this.instanceId, error },
        'Failed to delete ownership record from Redis',
      )
    }
  }

  private async writeRecord(record: RuntimeOwnershipRecord): Promise<void> {
    const client = this.redisManager.getClient()
    const ttlSeconds = Math.max(1, Math.ceil(this.leaseTtlMs / 1000))
    await client.setex(REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP(record.roomId), ttlSeconds, JSON.stringify(record))
  }

  private async tryCreateRecord(record: RuntimeOwnershipRecord): Promise<boolean> {
    const client = this.redisManager.getClient()

    if (typeof client.set !== 'function') {
      return false
    }

    const result = await client.set(
      REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP(record.roomId),
      JSON.stringify(record),
      'PX',
      this.leaseTtlMs,
      'NX',
    )

    return result === 'OK'
  }
}
