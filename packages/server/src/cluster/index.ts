// 集群管理模块导出

// 主要类
export {
  ClusterManager,
  initializeCluster,
  cleanupCluster,
  getClusterManager,
  createClusterConfigFromEnv,
  createClusterConfigFromCli,
  type ClusterCliOptions,
} from './clusterManager'
export { ClusterStateManager } from './clusterStateManager'
export { DistributedLockManager, LOCK_KEYS } from './distributedLock'
export { RedisClientManager, createRedisConfigFromEnv } from './redisClient'
export {
  ServiceDiscoveryManager,
  RoundRobinStrategy,
  LeastConnectionsStrategy,
  WeightedLoadStrategy,
} from './serviceDiscovery'
export { FlyIoServiceDiscoveryManager } from './flyIoServiceDiscovery'
export { SocketClusterAdapter } from './socketClusterAdapter'
export { ClusterBattleServer } from './clusterBattleServer'
export { createClusterApp } from './clusterApp'
export { TransactionManager, TransactionBuilder } from './transactionManager'
export { TransactionTemplates, withRetry } from './transactionTemplates'
export { RoomManager } from './roomManager'
export { ClusterAuthService, createClusterAuthService } from './clusterAuthService'
export { SessionManager, BlacklistManager } from './sessionManager'
export { MonitoringManager, LogAggregationManager } from './monitoringManager'
export { PerformanceTracker } from './performanceTracker'

// 接口
export type { LoadBalancingStrategy } from './serviceDiscovery'
export type { ClusterServerConfig } from './clusterApp'
export type { TransactionOperation, TransactionOptions, TransactionResult } from './transactionManager'
export type { RoomMigrationOptions, RoomCreationOptions } from './roomManager'
export type { SessionOptions, SessionInfo } from './sessionManager'
export type {
  MetricData,
  PerformanceMetrics,
  AlertRule,
  Alert,
  LogLevel,
  LogEntry,
  LogQuery,
} from './monitoringManager'
export type { TraceSpan, TraceLog, PerformanceMetric } from './performanceTracker'

// 类型定义
export type {
  ClusterConfig,
  ServiceInstance,
  PlayerConnection,
  RoomState,
  MatchmakingEntry,
  SessionData,
  AuthBlacklistEntry,
  DistributedLock,
  LockOptions,
  ClusterEvent,
  ClusterStats,
} from './types'

// 错误类型
export { ClusterError, LockError, ServiceDiscoveryError, REDIS_KEYS } from './types'
