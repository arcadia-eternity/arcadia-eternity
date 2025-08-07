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
} from './core/clusterManager'
export { ClusterStateManager } from './core/clusterStateManager'
export { DistributedLockManager, LOCK_KEYS } from './redis/distributedLock'
export { RedisClientManager, createRedisConfigFromEnv } from './redis/redisClient'
export {
  ServiceDiscoveryManager,
  RoundRobinStrategy,
  LeastConnectionsStrategy,
  WeightedLoadStrategy,
} from './discovery/serviceDiscovery'
export { FlyIoServiceDiscoveryManager } from './discovery/flyIoServiceDiscovery'
export { SocketClusterAdapter } from './communication/socketClusterAdapter'
export { ClusterBattleServer } from '../domain/battle/services/clusterBattleServer'
export { createClusterApp } from './core/clusterApp'
export { TransactionManager, TransactionBuilder } from './redis/transactionManager'
export { TransactionTemplates, withRetry } from './redis/transactionTemplates'
export { ClusterAuthService, createClusterAuthService } from '../domain/auth/services/clusterAuthService'
export { SessionManager, BlacklistManager } from '../domain/auth/services/sessionManager'
export { MonitoringManager } from './monitoring/monitoringManager'
export { PerformanceTracker } from './monitoring/performanceTracker'

// 接口
export type { LoadBalancingStrategy } from './discovery/serviceDiscovery'
export type { ClusterServerConfig } from './core/clusterApp'
export type { TransactionOperation, TransactionOptions, TransactionResult } from './redis/transactionManager'
export type { SessionOptions, SessionInfo } from '../domain/auth/services/sessionManager'
export type { MetricData, PerformanceMetrics, AlertRule, Alert } from './monitoring/monitoringManager'
export type { TraceSpan, TraceLog, PerformanceMetric } from './monitoring/performanceTracker'

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
