import { SocketManager } from './cluster/communication/socketManager'
import 'reflect-metadata'
import { Container } from 'inversify'
import { EmailService, createEmailConfigFromEnv, type EmailConfig } from './domain/email/emailService'
import { AuthService, createAuthConfigFromEnv } from './domain/auth/services/authService'
import { EmailVerificationRepository, PlayerRepository } from '@arcadia-eternity/database'
import type { IEmailService } from './interfaces/IEmailService'
import type { IAuthService } from './domain/auth/services/authService'
import { ClusterMatchmakingService } from './domain/matching/services/clusterMatchmakingService'
import { ClusterBattleService } from './domain/battle/services/clusterBattleService'
import { ClusterBattleServer } from './domain/battle/services/clusterBattleServer'
import { BattleRpcServer } from './cluster/communication/rpc/battleRpcServer'
import { BattleRpcClient } from './cluster/communication/rpc/battleRpcClient'
import { SessionStateManager } from './domain/session/sessionStateManager'
import type { IMatchmakingService, IBattleService, IResourceLoadingManager, MatchmakingCallbacks, BattleCallbacks } from './domain/battle/services/interfaces'
import type { ClusterStateManager } from './cluster/core/clusterStateManager'
import type { RealtimeTransport } from './realtime/realtimeTransport'
import type { DistributedLockManager } from './cluster/redis/distributedLock'
import type { PerformanceTracker } from './cluster/monitoring/performanceTracker'
import type { ServiceDiscoveryManager } from './cluster/discovery/serviceDiscovery'
import type { BattleReportConfig } from './domain/report/services/battleReportService'
import type { RedisClientManager } from './cluster/redis/redisClient'
import type { ClientRealtimeGateway } from './realtime/clientRealtimeGateway'
import type { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@arcadia-eternity/protocol'
import { resourceLoadingManager } from './resourceLoadingManager'
import { TYPES } from './types'

// 重新导出 TYPES 以保持向后兼容
export { TYPES }

// 创建DI容器
export function createContainer(emailConfig?: EmailConfig): Container {
  const container = new Container()

  // 绑定邮件服务
  container
    .bind<IEmailService>(TYPES.EmailService)
    .toDynamicValue(() => {
      const config = emailConfig || createEmailConfigFromEnv()
      return new EmailService(config)
    })
    .inSingletonScope()

  // 绑定认证服务
  container
    .bind<IAuthService>(TYPES.AuthService)
    .toDynamicValue(() => {
      const config = createAuthConfigFromEnv()
      return new AuthService(config)
    })
    .inSingletonScope()

  // 绑定数据库仓库
  container
    .bind<EmailVerificationRepository>(TYPES.EmailVerificationRepository)
    .toDynamicValue(() => new EmailVerificationRepository())
    .inSingletonScope()

  container
    .bind<PlayerRepository>(TYPES.PlayerRepository)
    .toDynamicValue(() => new PlayerRepository())
    .inSingletonScope()

  // 绑定资源加载管理器
  container.bind<IResourceLoadingManager>(TYPES.ResourceLoadingManager).toDynamicValue(() => {
    return {
      isReady: () => {
        return resourceLoadingManager.isReady()
      },
      getProgress: () => {
        return resourceLoadingManager.getProgress()
      },
    }
  })

  return container
}

// 全局容器实例
let containerInstance: Container | null = null

export function getContainer(emailConfig?: EmailConfig): Container {
  if (!containerInstance) {
    containerInstance = createContainer(emailConfig)
  }
  return containerInstance
}

export function resetContainer(): void {
  containerInstance = null
}

/**
 * 配置战斗系统服务的绑定
 * 这些服务需要特殊的依赖（如回调函数），所以需要在运行时配置
 */
export function configureBattleServices(
  container: Container,
  dependencies: {
    stateManager: ClusterStateManager
    realtimeGateway: RealtimeTransport
    lockManager: DistributedLockManager
    instanceId: string
    matchmakingCallbacks: MatchmakingCallbacks
    battleCallbacks: BattleCallbacks
    performanceTracker?: PerformanceTracker | null
    serviceDiscovery?: ServiceDiscoveryManager | null
    battleReportConfig?: BattleReportConfig
  }) {
    container.bind(TYPES.MatchmakingCallbacks).toConstantValue(dependencies.matchmakingCallbacks)
    container.bind(TYPES.BattleCallbacks).toConstantValue(dependencies.battleCallbacks)
    if (dependencies.performanceTracker) {
      container.bind(TYPES.PerformanceTracker).toConstantValue(dependencies.performanceTracker)
    }
    if (dependencies.serviceDiscovery) {
      container.bind(TYPES.ServiceDiscoveryManager).toConstantValue(dependencies.serviceDiscovery)
    }

  // 绑定核心依赖
  container.bind(TYPES.ClusterStateManager).toConstantValue(dependencies.stateManager)
  container.bind(TYPES.ClusterRealtimeGateway).toConstantValue(dependencies.realtimeGateway)
  container.bind(TYPES.DistributedLockManager).toConstantValue(dependencies.lockManager)
  container.bind(TYPES.InstanceId).toConstantValue(dependencies.instanceId)
  container.bind(TYPES.MatchmakingCallbacks).toConstantValue(dependencies.matchmakingCallbacks)
  container.bind(TYPES.BattleCallbacks).toConstantValue(dependencies.battleCallbacks)

  // 绑定可选依赖
  if (dependencies.performanceTracker) {
    container.bind(TYPES.PerformanceTracker).toConstantValue(dependencies.performanceTracker)
  }
  if (dependencies.serviceDiscovery) {
    container.bind(TYPES.ServiceDiscoveryManager).toConstantValue(dependencies.serviceDiscovery)
  }
  if (dependencies.battleReportConfig) {
    container.bind(TYPES.BattleReportConfig).toConstantValue(dependencies.battleReportConfig)
  }

  // 绑定服务实现
  container.bind<IMatchmakingService>(TYPES.MatchmakingService).to(ClusterMatchmakingService).inSingletonScope()
  container.bind<IBattleService>(TYPES.BattleService).to(ClusterBattleService).inSingletonScope()
}

/**
 * 配置集群服务的绑定（解决循环依赖）
 */
export function configureClusterServices(
  container: Container,
  dependencies: {
    io: Server<ClientToServerEvents, ServerToClientEvents>
    clientRealtimeGateway?: ClientRealtimeGateway<ClientToServerEvents, ServerToClientEvents>
    stateManager: ClusterStateManager
    realtimeGateway: RealtimeTransport
    lockManager: DistributedLockManager
    redisManager: RedisClientManager
    instanceId: string
    rpcPort?: number
    battleReportConfig?: BattleReportConfig
    matchmakingCallbacks?: MatchmakingCallbacks
    battleCallbacks?: BattleCallbacks
    performanceTracker?: PerformanceTracker | null
    serviceDiscovery?: ServiceDiscoveryManager | null
  },
): { battleServer: ClusterBattleServer; rpcServer: BattleRpcServer } {
  // 绑定基础依赖
  if (dependencies.clientRealtimeGateway) {
    container.bind(TYPES.ClientRealtimeGateway).toConstantValue(dependencies.clientRealtimeGateway)
  }
  container.bind(TYPES.ClusterStateManager).toConstantValue(dependencies.stateManager)
  container.bind(TYPES.ClusterRealtimeGateway).toConstantValue(dependencies.realtimeGateway)
  container.bind(TYPES.DistributedLockManager).toConstantValue(dependencies.lockManager)
  container.bind(TYPES.RedisManager).toConstantValue(dependencies.redisManager) // 添加绑定
  container.bind(TYPES.InstanceId).toConstantValue(dependencies.instanceId)

  if (dependencies.rpcPort !== undefined) {
    container.bind(TYPES.RpcPort).toConstantValue(dependencies.rpcPort)
  }
  if (dependencies.battleReportConfig) {
    container.bind(TYPES.BattleReportConfig).toConstantValue(dependencies.battleReportConfig)
  }
  if (dependencies.performanceTracker) {
    container.bind(TYPES.PerformanceTracker).toConstantValue(dependencies.performanceTracker)
  }
  if (dependencies.serviceDiscovery) {
    container.bind(TYPES.ServiceDiscoveryManager).toConstantValue(dependencies.serviceDiscovery)
  }

  // 绑定集群服务（不依赖回调的服务）
  container.bind<ClusterBattleServer>(TYPES.ClusterBattleServer).to(ClusterBattleServer).inSingletonScope()
  container.bind<BattleRpcServer>(TYPES.BattleRpcServer).to(BattleRpcServer).inSingletonScope()
  container.bind<BattleRpcClient>(TYPES.BattleRpcClient).to(BattleRpcClient).inSingletonScope()
  container.bind<SessionStateManager>(TYPES.SessionStateManager).to(SessionStateManager).inSingletonScope()
  container.bind<SocketManager>(TYPES.SocketManager).to(SocketManager).inSingletonScope()

  // 获取 ClusterBattleServer 实例（它不依赖回调）
  const battleServer = container.get<ClusterBattleServer>(TYPES.ClusterBattleServer)
  const rpcServer = container.get<BattleRpcServer>(TYPES.BattleRpcServer)

  // 设置循环依赖
  battleServer.setRpcServer(rpcServer)

  // 现在创建回调并绑定依赖回调的服务
  const matchmakingCallbacks = battleServer.createMatchmakingCallbacks()
  const battleCallbacks = battleServer.createBattleCallbacks()

  container.bind(TYPES.MatchmakingCallbacks).toConstantValue(matchmakingCallbacks)
  container.bind(TYPES.BattleCallbacks).toConstantValue(battleCallbacks)

  // 绑定依赖回调的服务
  container.bind<IMatchmakingService>(TYPES.MatchmakingService).to(ClusterMatchmakingService).inSingletonScope()
  container.bind<IBattleService>(TYPES.BattleService).to(ClusterBattleService).inSingletonScope()

  // 获取服务实例并设置到 battleServer 中
  const matchmakingService = container.get<IMatchmakingService>(TYPES.MatchmakingService)
  const battleService = container.get<IBattleService>(TYPES.BattleService)

  battleServer.setServices(matchmakingService, battleService)

  return { battleServer, rpcServer }
}
