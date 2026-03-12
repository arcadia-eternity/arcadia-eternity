import Redis from 'ioredis-mock'
import { EventEmitter } from 'events'
import pino from 'pino'
import type { ClusterConfig } from '../types'
import type { PerformanceTracker } from '../monitoring/performanceTracker'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

type RedisLike = InstanceType<typeof Redis>
type PubSubSubscriber = RedisLike & {
  __channelSubscriptions?: Set<string>
  __patternSubscriptions?: Set<string>
}

export class InMemoryRedisClientManager {
  private client: RedisLike | null = null
  private subscriber: RedisLike | null = null
  private publisher: RedisLike | null = null
  private performanceTracker?: PerformanceTracker
  private readonly pubsubEmitter = new EventEmitter()

  constructor(private readonly config: ClusterConfig['redis']) {}

  setPerformanceTracker(tracker: PerformanceTracker): void {
    this.performanceTracker = tracker
  }

  async initialize(): Promise<void> {
    this.client = new Redis({
      data: {},
      keyPrefix: this.getKeyPrefix(),
    } as any)
    this.publisher = this.client.duplicate()
    this.subscriber = this.client.duplicate()
    this.patchPubSub(this.publisher, this.subscriber as PubSubSubscriber)
    logger.info('In-memory Redis clients initialized successfully')
  }

  getClient(): RedisLike {
    if (!this.client) throw new Error('In-memory Redis client not initialized')
    return this.client
  }

  getPublisher(): RedisLike {
    if (!this.publisher) throw new Error('In-memory Redis publisher not initialized')
    return this.publisher
  }

  getSubscriber(): RedisLike {
    if (!this.subscriber) throw new Error('In-memory Redis subscriber not initialized')
    return this.subscriber
  }

  getKeyPrefix(): string {
    return this.config.keyPrefix || 'arcadia:'
  }

  async ping(): Promise<boolean> {
    const startTime = Date.now()
    try {
      const result = await this.getClient().ping()
      if (this.performanceTracker) {
        this.performanceTracker.recordRedisOperation('ping', Date.now() - startTime)
      }
      return result === 'PONG'
    } catch (error) {
      logger.error({ error }, 'In-memory Redis ping failed')
      return false
    }
  }

  async getInfo(): Promise<Record<string, any>> {
    return {
      connected_clients: 3,
      used_memory_human: 'in-memory',
      uptime_in_seconds: Math.floor(process.uptime()),
    }
  }

  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }> {
    return {
      status: 'healthy',
      details: {
        responseTime: 0,
        connectedClients: 3,
        usedMemory: 'in-memory',
        uptime: Math.floor(process.uptime()),
      },
    }
  }

  async cleanup(): Promise<void> {
    const tasks: Array<Promise<unknown>> = []
    if (this.client) tasks.push(Promise.resolve(this.client.disconnect()))
    if (this.publisher) tasks.push(Promise.resolve(this.publisher.disconnect()))
    if (this.subscriber) tasks.push(Promise.resolve(this.subscriber.disconnect()))
    await Promise.all(tasks)
    this.client = null
    this.publisher = null
    this.subscriber = null
    logger.info('In-memory Redis clients cleaned up successfully')
  }

  private patchPubSub(publisher: RedisLike, subscriber: PubSubSubscriber): void {
    subscriber.__channelSubscriptions = new Set<string>()
    subscriber.__patternSubscriptions = new Set<string>()

    const originalPublish = publisher.publish.bind(publisher)
    publisher.publish = (async (channel: string, message: string) => {
      const publishedCount = await originalPublish(channel, message)

      if (subscriber.__channelSubscriptions?.has(channel)) {
        subscriber.emit('message', channel, message)
      }

      for (const pattern of subscriber.__patternSubscriptions ?? []) {
        if (this.matchesPattern(pattern, channel)) {
          subscriber.emit('pmessage', pattern, channel, message)
        }
      }

      this.pubsubEmitter.emit('publish', channel, message)
      return publishedCount
    }) as typeof publisher.publish

    subscriber.subscribe = ((...args: any[]) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
      const channels = args as string[]
      for (const channel of channels) {
        subscriber.__channelSubscriptions?.add(channel)
      }
      callback?.(null, subscriber.__channelSubscriptions?.size ?? 0)
      return Promise.resolve(subscriber.__channelSubscriptions?.size ?? 0)
    }) as typeof subscriber.subscribe

    subscriber.psubscribe = ((...args: any[]) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
      const patterns = args as string[]
      for (const pattern of patterns) {
        subscriber.__patternSubscriptions?.add(pattern)
      }
      callback?.(null, subscriber.__patternSubscriptions?.size ?? 0)
      return Promise.resolve(subscriber.__patternSubscriptions?.size ?? 0)
    }) as typeof subscriber.psubscribe

    subscriber.unsubscribe = ((...args: any[]) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
      const channels = args as string[]
      if (channels.length === 0) {
        subscriber.__channelSubscriptions?.clear()
      } else {
        for (const channel of channels) {
          subscriber.__channelSubscriptions?.delete(channel)
        }
      }
      callback?.(null, subscriber.__channelSubscriptions?.size ?? 0)
      return Promise.resolve(subscriber.__channelSubscriptions?.size ?? 0)
    }) as typeof subscriber.unsubscribe

    subscriber.punsubscribe = ((...args: any[]) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
      const patterns = args as string[]
      if (patterns.length === 0) {
        subscriber.__patternSubscriptions?.clear()
      } else {
        for (const pattern of patterns) {
          subscriber.__patternSubscriptions?.delete(pattern)
        }
      }
      callback?.(null, subscriber.__patternSubscriptions?.size ?? 0)
      return Promise.resolve(subscriber.__patternSubscriptions?.size ?? 0)
    }) as typeof subscriber.punsubscribe
  }

  private matchesPattern(pattern: string, channel: string): boolean {
    if (pattern === channel) return true
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${escaped}$`).test(channel)
  }
}
