// 集群相关类型定义
import { nanoid } from 'nanoid'
import type { BattleState } from '@arcadia-eternity/const'

export interface ClusterConfig {
  redis: {
    host: string
    port: number
    password?: string
    db?: number
    keyPrefix?: string
    maxRetriesPerRequest?: number
    retryDelayOnFailover?: number
    enableReadyCheck?: boolean
    lazyConnect?: boolean
    tls?: boolean
  }
  instance: {
    id: string
    host: string
    port: number
    grpcPort?: number // gRPC 服务端口
    region?: string
    isFlyIo?: boolean // 是否在 Fly.io 环境
  }
  cluster: {
    enabled: boolean
    heartbeatInterval?: number
    healthCheckInterval?: number
    failoverTimeout?: number
  }
}

export interface ServiceInstance {
  id: string
  host: string
  port: number
  rpcPort?: number // 新增：RPC服务端口
  rpcAddress?: string // 新增：完整的RPC地址 (host:port)
  region?: string
  status: 'healthy' | 'unhealthy' | 'starting' | 'stopping'
  lastHeartbeat: number
  connections: number
  load: number
  // 增强的性能指标
  performance: {
    cpuUsage: number // CPU使用率 (0-100)
    memoryUsage: number // 内存使用率 (0-100)
    memoryUsedMB: number // 已使用内存 (MB)
    memoryTotalMB: number // 总内存 (MB)
    activeBattles: number // 活跃战斗数量
    queuedPlayers: number // 排队玩家数量
    avgResponseTime: number // 平均响应时间 (ms)
    errorRate: number // 错误率 (0-1)
    lastUpdated: number // 性能指标最后更新时间
  }
  metadata?: Record<string, any>
}

export interface PlayerConnection {
  instanceId: string
  socketId: string
  lastSeen: number
  status: 'connected' | 'disconnected'
  sessionId: string // 新增：关联的会话ID
  metadata?: Record<string, any>
}

// 新增：玩家会话连接，支持多个连接
export interface PlayerSessionConnection {
  playerId: string
  sessionId: string
  instanceId: string
  socketId: string
  lastSeen: number
  status: 'connected' | 'disconnected'
  metadata?: Record<string, any>
}

export interface RoomState {
  id: string
  status: 'waiting' | 'active' | 'ended'
  sessions: string[] // 战斗中玩家的 sessionIds
  sessionPlayers: Record<string, string> // sessionId -> playerId 映射，用于反向查找 (包含玩家和观战者)
  instanceId: string
  lastActive: number
  battleState?: BattleState
  spectators: { playerId: string; sessionId: string }[] // 观战者的 session 信息
  metadata?: Record<string, any>
}

export interface MatchmakingEntry {
  playerId: string
  joinTime: number
  playerData: any
  preferences?: Record<string, any>
  sessionId: string // 新增：会话ID
  ruleSetId?: string // 新增：规则集ID
  metadata?: {
    sessionId?: string
    ruleSetId?: string
    [key: string]: any
  }
}

export interface SessionData {
  playerId: string
  sessionId: string // 新增：唯一会话标识符
  accessToken?: string
  refreshToken?: string
  expiry?: number
  instanceId?: string
  createdAt: number // 新增：会话创建时间
  lastAccessed: number // 新增：最后访问时间
  metadata?: Record<string, any>
}

export interface AuthBlacklistEntry {
  jti: string
  expiry: number
  reason?: string
  revokedAt: number
}

// 分布式锁相关
export interface DistributedLock {
  key: string
  value: string
  ttl: number
  acquired: boolean
}

export interface LockOptions {
  ttl?: number // 锁的生存时间（毫秒）
  retryDelay?: number // 重试延迟（毫秒）
  retryCount?: number // 最大重试次数
}

// 事件类型
export type ClusterEvent =
  | { type: 'instance:join'; data: ServiceInstance }
  | { type: 'instance:leave'; data: { instanceId: string } }
  | { type: 'instance:update'; data: ServiceInstance }
  | { type: 'player:connect'; data: { playerId: string; connection: PlayerConnection } }
  | { type: 'player:disconnect'; data: { playerId: string; instanceId: string; sessionId?: string } }
  | { type: 'room:create'; data: RoomState }
  | { type: 'room:update'; data: RoomState }
  | { type: 'room:destroy'; data: { roomId: string } }
  | { type: 'matchmaking:join'; data: MatchmakingEntry }
  | { type: 'matchmaking:leave'; data: { playerId: string; sessionId?: string } }

// 集群统计信息
export interface ClusterStats {
  instances: {
    total: number
    healthy: number
    unhealthy: number
  }
  players: {
    total: number
    connected: number
    disconnected: number
  }
  rooms: {
    total: number
    waiting: number
    active: number
    ended: number
  }
  matchmaking: {
    queueSize: number
    averageWaitTime: number
  }
}

// Redis键命名空间
export const REDIS_KEYS = {
  // 服务实例
  SERVICE_INSTANCES: 'service:instances',
  SERVICE_INSTANCE: (id: string) => `service:instance:${id}`,

  // 玩家连接 - 基于会话
  ACTIVE_PLAYERS: 'players:active', // 活跃玩家索引集合
  PLAYER_SESSION_CONNECTIONS: (playerId: string) => `player:sessions:connections:${playerId}`, // 玩家的所有会话连接
  PLAYER_SESSION_CONNECTION: (playerId: string, sessionId: string) =>
    `player:session:connection:${playerId}:${sessionId}`, // 特定会话连接

  // 房间状态
  ROOMS: 'rooms',
  ROOM: (roomId: string) => `room:${roomId}`,
  SESSION_ROOM_MAPPING: (playerId: string, sessionId: string) => `session:rooms:${playerId}:${sessionId}`,

  // 匹配队列
  MATCHMAKING_QUEUE: 'matchmaking:queue',
  MATCHMAKING_PLAYER: (sessionKey: string) => `matchmaking:session:${sessionKey}`,

  // 会话管理 - 支持多会话
  PLAYER_SESSIONS: (playerId: string) => `player:sessions:${playerId}`, // 玩家会话列表
  SESSION: (playerId: string, sessionId: string) => `session:${playerId}:${sessionId}`, // 具体会话数据
  SESSION_INDEX: 'sessions:index', // 全局会话索引，用于清理

  // 认证黑名单
  AUTH_BLACKLIST: (jti: string) => `auth:blacklist:${jti}`,

  // 分布式锁
  LOCK: (key: string) => `lock:${key}`,

  // 集群事件
  CLUSTER_EVENTS: 'cluster:events',
  BATTLE_CONTROL_CHANNEL: 'battle-control', // 新增：战斗控制频道

  // 断线玩家宽限期管理
  DISCONNECTED_PLAYER: (playerId: string, sessionId: string) => `disconnected:player:${playerId}:${sessionId}`, // 断线玩家信息
  DISCONNECTED_PLAYERS: 'disconnected:players', // 所有断线玩家索引

  // 统计信息
  STATS: 'cluster:stats',

  // 私人房间
  PRIVATE_ROOM: (roomCode: string) => `private_room:${roomCode}`,
  PRIVATE_ROOM_PLAYER_SESSION: (playerId: string, sessionId: string) => `private_room_player:${playerId}:${sessionId}`,
  PRIVATE_ROOM_PLAYER_SESSIONS: (playerId: string) => `private_room_player_sessions:${playerId}`,
  PRIVATE_ROOM_EVENTS: (roomCode: string) => `private_room_events:${roomCode}`,
  PRIVATE_BATTLE_FINISHED_EVENTS: 'private_battle_finished',
} as const

export type RedisDisconnectedPlayerInfo = {
  playerId: string
  sessionId: string
  roomId: string
  disconnectTime: number
  instanceId: string
  expiresAt: number
}

// 错误类型
export class ClusterError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any,
  ) {
    super(message)
    this.name = 'ClusterError'
  }
}

export class LockError extends ClusterError {
  constructor(message: string, details?: any) {
    super(message, 'LOCK_ERROR', details)
  }
}

export class ServiceDiscoveryError extends ClusterError {
  constructor(message: string, details?: any) {
    super(message, 'SERVICE_DISCOVERY_ERROR', details)
  }
}

// === 新增：战斗控制频道事件类型 ===
export enum BattleControlEventType {
  BattleCreated = 'battleCreated',
  Cleanup = 'cleanup',
}

export interface BattleCreatedEventPayload {
  event: BattleControlEventType.BattleCreated
  roomId: string
  spectators: { playerId: string; sessionId: string }[]
  sourceInstance: string
}

export interface CleanupEventPayload {
  event: BattleControlEventType.Cleanup
  roomId: string
}

export type BattleControlEvent = BattleCreatedEventPayload | CleanupEventPayload

// === 工具函数 ===

/**
 * 生成唯一的会话ID
 */
export function generateSessionId(): string {
  return nanoid()
}

/**
 * 从会话ID和时间戳生成带时间前缀的会话ID（便于排序）
 */
export function generateTimestampedSessionId(): string {
  const timestamp = Date.now().toString(36) // 36进制时间戳
  const randomId = nanoid(8) // 8位随机字符
  return `${timestamp}_${randomId}`
}
