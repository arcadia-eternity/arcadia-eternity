import { nanoid } from 'nanoid'
import pino from 'pino'
import * as promClient from 'prom-client'
import type { RedisClientManager } from './redisClient'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export interface TraceSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  operationName: string
  startTime: number
  endTime?: number
  duration?: number
  tags: Record<string, any>
  logs: TraceLog[]
  status: 'pending' | 'success' | 'error'
  error?: string
}

export interface TraceLog {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  message: string
  fields?: Record<string, any>
}

export interface PerformanceMetric {
  name: string
  value: number
  unit: string
  timestamp: number
  tags: Record<string, string>
}

export class PerformanceTracker {
  private redisManager: RedisClientManager
  private instanceId: string
  private activeSpans: Map<string, TraceSpan> = new Map()
  private registry: promClient.Registry

  // Prometheus指标
  private httpRequestDuration!: promClient.Histogram<string>
  private httpRequestTotal!: promClient.Counter<string>
  private socketConnections!: promClient.Gauge<string>
  private battleRoomsActive!: promClient.Gauge<string>
  private matchmakingQueueSize!: promClient.Gauge<string>
  private redisOperationDuration!: promClient.Histogram<string>
  private memoryUsage!: promClient.Gauge<string>
  private cpuUsage!: promClient.Gauge<string>
  private errorTotal!: promClient.Counter<string>

  constructor(redisManager: RedisClientManager, instanceId: string) {
    this.redisManager = redisManager
    this.instanceId = instanceId
    this.registry = new promClient.Registry()

    this.initializeMetrics()
  }

  private initializeMetrics(): void {
    // HTTP请求持续时间
    this.httpRequestDuration = new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code', 'instance_id'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
      registers: [this.registry],
    })

    // HTTP请求总数
    this.httpRequestTotal = new promClient.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code', 'instance_id'],
      registers: [this.registry],
    })

    // Socket连接数
    this.socketConnections = new promClient.Gauge({
      name: 'socket_connections_active',
      help: 'Number of active socket connections',
      labelNames: ['instance_id'],
      registers: [this.registry],
    })

    // 活跃战斗房间数
    this.battleRoomsActive = new promClient.Gauge({
      name: 'battle_rooms_active',
      help: 'Number of active battle rooms',
      labelNames: ['instance_id'],
      registers: [this.registry],
    })

    // 匹配队列大小
    this.matchmakingQueueSize = new promClient.Gauge({
      name: 'matchmaking_queue_size',
      help: 'Size of the matchmaking queue',
      labelNames: ['instance_id'],
      registers: [this.registry],
    })

    // Redis操作持续时间
    this.redisOperationDuration = new promClient.Histogram({
      name: 'redis_operation_duration_seconds',
      help: 'Duration of Redis operations in seconds',
      labelNames: ['operation', 'instance_id'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [this.registry],
    })

    // 内存使用量
    this.memoryUsage = new promClient.Gauge({
      name: 'memory_usage_bytes',
      help: 'Memory usage in bytes',
      labelNames: ['type', 'instance_id'],
      registers: [this.registry],
    })

    // CPU使用率
    this.cpuUsage = new promClient.Gauge({
      name: 'cpu_usage_percent',
      help: 'CPU usage percentage',
      labelNames: ['instance_id'],
      registers: [this.registry],
    })

    // 错误总数
    this.errorTotal = new promClient.Counter({
      name: 'errors_total',
      help: 'Total number of errors',
      labelNames: ['type', 'component', 'instance_id'],
      registers: [this.registry],
    })

    // 注册默认指标（进程指标）
    promClient.collectDefaultMetrics({
      register: this.registry,
      prefix: 'nodejs_',
      labels: { instance_id: this.instanceId },
    })

    logger.debug('Prometheus metrics initialized')
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing performance tracker')

      // 启动系统指标收集
      this.startSystemMetricsCollection()

      logger.info('Performance tracker initialized successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize performance tracker')
      throw error
    }
  }

  /**
   * 开始一个新的追踪span
   */
  startSpan(operationName: string, parentSpanId?: string, traceId?: string): TraceSpan {
    const span: TraceSpan = {
      traceId: traceId || nanoid(),
      spanId: nanoid(),
      parentSpanId,
      operationName,
      startTime: Date.now(),
      tags: {
        instanceId: this.instanceId,
      },
      logs: [],
      status: 'pending',
    }

    this.activeSpans.set(span.spanId, span)

    logger.debug(
      {
        traceId: span.traceId,
        spanId: span.spanId,
        operationName,
      },
      'Span started',
    )

    return span
  }

  /**
   * 结束一个span
   */
  finishSpan(spanId: string, status: 'success' | 'error' = 'success', error?: string): void {
    const span = this.activeSpans.get(spanId)
    if (!span) {
      logger.warn({ spanId }, 'Attempted to finish non-existent span')
      return
    }

    span.endTime = Date.now()
    span.duration = span.endTime - span.startTime
    span.status = status
    if (error) {
      span.error = error
    }

    this.activeSpans.delete(spanId)

    logger.debug(
      {
        traceId: span.traceId,
        spanId: span.spanId,
        duration: span.duration,
        status,
      },
      'Span finished',
    )
  }

  /**
   * 为span添加标签
   */
  setSpanTag(spanId: string, key: string, value: any): void {
    const span = this.activeSpans.get(spanId)
    if (span) {
      span.tags[key] = value
    }
  }

  /**
   * 为span添加日志
   */
  logToSpan(spanId: string, level: TraceLog['level'], message: string, fields?: Record<string, any>): void {
    const span = this.activeSpans.get(spanId)
    if (span) {
      span.logs.push({
        timestamp: Date.now(),
        level,
        message,
        fields,
      })
    }
  }

  /**
   * 记录HTTP请求指标
   */
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    const labels = {
      method,
      route,
      status_code: statusCode.toString(),
      instance_id: this.instanceId,
    }

    this.httpRequestDuration.observe(labels, duration / 1000) // 转换为秒
    this.httpRequestTotal.inc(labels)
  }

  /**
   * 更新Socket连接数
   */
  updateSocketConnections(count: number): void {
    this.socketConnections.set({ instance_id: this.instanceId }, count)
  }

  /**
   * 更新活跃战斗房间数
   */
  updateActiveBattleRooms(count: number): void {
    this.battleRoomsActive.set({ instance_id: this.instanceId }, count)
  }

  /**
   * 更新匹配队列大小
   */
  updateMatchmakingQueueSize(size: number): void {
    this.matchmakingQueueSize.set({ instance_id: this.instanceId }, size)
  }

  /**
   * 记录Redis操作指标
   */
  recordRedisOperation(operation: string, duration: number): void {
    this.redisOperationDuration.observe(
      { operation, instance_id: this.instanceId },
      duration / 1000, // 转换为秒
    )
  }

  /**
   * 记录错误指标
   */
  recordError(type: string, component: string): void {
    this.errorTotal.inc({
      type,
      component,
      instance_id: this.instanceId,
    })
  }

  /**
   * 更新内存使用指标
   */
  updateMemoryUsage(): void {
    const memUsage = process.memoryUsage()

    this.memoryUsage.set({ type: 'heap_used', instance_id: this.instanceId }, memUsage.heapUsed)
    this.memoryUsage.set({ type: 'heap_total', instance_id: this.instanceId }, memUsage.heapTotal)
    this.memoryUsage.set({ type: 'external', instance_id: this.instanceId }, memUsage.external)
    this.memoryUsage.set({ type: 'rss', instance_id: this.instanceId }, memUsage.rss)
  }

  /**
   * 更新CPU使用指标
   */
  updateCpuUsage(): void {
    const cpuUsage = process.cpuUsage()
    const totalUsage = (cpuUsage.user + cpuUsage.system) / 1000000 // 转换为秒

    this.cpuUsage.set({ instance_id: this.instanceId }, totalUsage)
  }

  /**
   * 创建一个计时器装饰器
   */
  timer(operationName: string, tags: Record<string, string> = {}) {
    return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
      const originalMethod = descriptor.value

      descriptor.value = async function (...args: any[]) {
        const tracker = (this as any).performanceTracker as PerformanceTracker
        if (!tracker) {
          return originalMethod.apply(this, args)
        }

        const span = tracker.startSpan(`${operationName}.${propertyKey}`)
        tracker.setSpanTag(span.spanId, 'method', propertyKey)

        for (const [key, value] of Object.entries(tags)) {
          tracker.setSpanTag(span.spanId, key, value)
        }

        try {
          const result = await originalMethod.apply(this, args)
          tracker.finishSpan(span.spanId, 'success')
          // 记录操作持续时间
          if (span.duration) {
            tracker.recordRedisOperation(`${operationName}.${propertyKey}`, span.duration)
          }
          return result
        } catch (error) {
          tracker.finishSpan(span.spanId, 'error', error instanceof Error ? error.message : 'Unknown error')
          tracker.recordError('operation_error', `${operationName}.${propertyKey}`)
          throw error
        }
      }

      return descriptor
    }
  }

  /**
   * 获取Prometheus指标
   */
  async getMetrics(): Promise<string> {
    try {
      return await this.registry.metrics()
    } catch (error) {
      logger.error({ error }, 'Failed to get Prometheus metrics')
      return ''
    }
  }

  /**
   * 获取指标注册表
   */
  getRegistry(): promClient.Registry {
    return this.registry
  }

  /**
   * 启动系统指标收集（优化频率以节约资源）
   */
  private startSystemMetricsCollection(): void {
    // 延长系统指标收集间隔：每5分钟更新一次
    setInterval(() => {
      this.updateMemoryUsage()
      this.updateCpuUsage()
    }, 300000) // 5分钟

    logger.debug('System metrics collection started (optimized for cost reduction)')
  }

  /**
   * 创建HTTP中间件用于自动记录请求指标
   */
  createHttpMiddleware() {
    return (req: any, res: any, next: any) => {
      const startTime = Date.now()

      res.on('finish', () => {
        const duration = Date.now() - startTime
        const route = req.route?.path || req.path || 'unknown'

        this.recordHttpRequest(req.method, route, res.statusCode, duration)
      })

      next()
    }
  }

  /**
   * 创建Redis操作装饰器
   */
  redisTimer(operation: string) {
    return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
      const originalMethod = descriptor.value

      descriptor.value = async function (...args: any[]) {
        const tracker = (this as any).performanceTracker as PerformanceTracker
        const startTime = Date.now()

        try {
          const result = await originalMethod.apply(this, args)

          if (tracker) {
            const duration = Date.now() - startTime
            tracker.recordRedisOperation(operation, duration)
          }

          return result
        } catch (error) {
          if (tracker) {
            const duration = Date.now() - startTime
            tracker.recordRedisOperation(operation, duration)
            tracker.recordError('redis_error', operation)
          }
          throw error
        }
      }

      return descriptor
    }
  }

  /**
   * 查询指标数据
   */
  async queryMetrics(
    name: string,
    startTime: number,
    endTime: number,
    tags?: Record<string, string>,
  ): Promise<PerformanceMetric[]> {
    try {
      const client = this.redisManager.getClient()
      const metrics: PerformanceMetric[] = []

      const startMinute = Math.floor(startTime / 60000)
      const endMinute = Math.floor(endTime / 60000)

      for (let minute = startMinute; minute <= endMinute; minute++) {
        const pattern = `metric:${minute}:*`
        const keys = await client.keys(pattern)

        for (const key of keys) {
          const metricData = await client.hgetall(key)
          if (Object.keys(metricData).length === 0) continue

          if (metricData.name === name) {
            const metric: PerformanceMetric = {
              name: metricData.name,
              value: parseFloat(metricData.value),
              unit: metricData.unit,
              timestamp: parseInt(metricData.timestamp),
              tags: JSON.parse(metricData.tags),
            }

            // 应用标签过滤
            if (!tags || this.matchesTags(metric.tags, tags)) {
              metrics.push(metric)
            }
          }
        }
      }

      return metrics.sort((a, b) => a.timestamp - b.timestamp)
    } catch (error) {
      logger.error({ error, name }, 'Failed to query metrics')
      return []
    }
  }

  private matchesTags(metricTags: Record<string, string>, filterTags: Record<string, string>): boolean {
    for (const [key, value] of Object.entries(filterTags)) {
      if (metricTags[key] !== value) {
        return false
      }
    }
    return true
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up performance tracker')

      // 结束所有活跃的span
      for (const [spanId, _span] of this.activeSpans.entries()) {
        this.finishSpan(spanId, 'error', 'Tracker cleanup')
      }

      // 清理Prometheus注册表
      this.registry.clear()

      logger.info('Performance tracker cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during performance tracker cleanup')
    }
  }
}
