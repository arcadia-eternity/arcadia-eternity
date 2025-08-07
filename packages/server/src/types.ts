// 服务标识符
export const TYPES = {
  EmailService: Symbol.for('EmailService'),
  AuthService: Symbol.for('AuthService'),
  EmailVerificationRepository: Symbol.for('EmailVerificationRepository'),
  PlayerRepository: Symbol.for('PlayerRepository'),

  // 战斗系统服务
  MatchmakingService: Symbol.for('MatchmakingService'),
  BattleService: Symbol.for('BattleService'),
  ResourceLoadingManager: Symbol.for('ResourceLoadingManager'),

  // 私人房间服务
  PrivateRoomService: Symbol.for('PrivateRoomService'),
  SessionStateManager: Symbol.for('SessionStateManager'),

  // 集群服务
  ClusterBattleServer: Symbol.for('ClusterBattleServer'),
  BattleRpcServer: Symbol.for('BattleRpcServer'),
  BattleRpcClient: Symbol.for('BattleRpcClient'),

  // 战斗系统依赖
  ClusterStateManager: Symbol.for('ClusterStateManager'),
  SocketClusterAdapter: Symbol.for('SocketClusterAdapter'),
  DistributedLockManager: Symbol.for('DistributedLockManager'),
  RedisManager: Symbol.for('RedisManager'),
  PerformanceTracker: Symbol.for('PerformanceTracker'),
  ServiceDiscoveryManager: Symbol.for('ServiceDiscoveryManager'),
  InstanceId: Symbol.for('InstanceId'),
  BattleReportConfig: Symbol.for('BattleReportConfig'),
  MatchmakingCallbacks: Symbol.for('MatchmakingCallbacks'),
  BattleCallbacks: Symbol.for('BattleCallbacks'),

  // Socket.IO 服务器实例
  SocketIOServer: Symbol.for('SocketIOServer'),
  RpcPort: Symbol.for('RpcPort'),

  // 观战者广播服务
  SpectatorBroadcastService: Symbol.for('SpectatorBroadcastService'),

  // Socket管理器
  SocketManager: Symbol.for('SocketManager'),
} as const
