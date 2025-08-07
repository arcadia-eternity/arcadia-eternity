import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import pino from 'pino'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import type { FlyIoServiceDiscoveryManager } from '../../discovery/flyIoServiceDiscovery'
import { injectable, inject, optional } from 'inversify'
import { TYPES } from '../../../types'
import type {
  BattleServiceClientImpl,
  PlayerSelectionRequest,
  PlayerSelectionResponse,
  SelectionRequest,
  SelectionResponse,
  BattleStateRequest,
  BattleStateResponse,
  ReadyRequest,
  ReadyResponse,
  AbandonRequest,
  AbandonResponse,
  AnimationEndRequest,
  AnimationEndResponse,
  TimerEnabledRequest,
  TimerEnabledResponse,
  PlayerTimerStateRequest,
  PlayerTimerStateResponse,
  AllPlayerTimerStatesRequest,
  AllPlayerTimerStatesResponse,
  TimerConfigRequest,
  TimerConfigResponse,
  StartAnimationRequest,
  StartAnimationResponse,
  EndAnimationRequest,
  EndAnimationResponse,
  TerminateBattleRequest,
  TerminateBattleResponse,
} from '../../../generated/battle-rpc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

// 使用生成的类型安全接口
type BattleServiceClient = BattleServiceClientImpl

@injectable()
export class BattleRpcClient {
  private clients = new Map<string, BattleServiceClient>() // instanceId -> client
  private packageDefinition!: protoLoader.PackageDefinition
  private readonly REQUEST_TIMEOUT = 15000 // 15秒超时，适应Docker环境
  private serviceDiscovery?: FlyIoServiceDiscoveryManager

  constructor(@optional() @inject(TYPES.ServiceDiscoveryManager) serviceDiscovery?: FlyIoServiceDiscoveryManager) {
    this.serviceDiscovery = serviceDiscovery
    this.loadProtoDefinition()
  }

  private loadProtoDefinition(): void {
    try {
      // 尝试多个可能的路径
      let protoPath: string | undefined
      const possiblePaths = [
        path.resolve(__dirname, '../../proto/battle-rpc.proto'), // 开发环境
        path.resolve(__dirname, '../../../proto/battle-rpc.proto'), // 编译后环境
        path.resolve(process.cwd(), 'packages/server/proto/battle-rpc.proto'), // Docker环境
        path.resolve(process.cwd(), 'proto/battle-rpc.proto'), // 简化Docker环境
        '/app/packages/server/proto/battle-rpc.proto', // 绝对路径Docker环境
      ]

      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          protoPath = testPath
          break
        }
      }

      if (!protoPath) {
        throw new Error(`Proto file not found. Tried paths: ${possiblePaths.join(', ')}`)
      }

      this.packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      })
      logger.debug({ protoPath }, 'Battle RPC proto definition loaded')
    } catch (error) {
      logger.error({ error }, 'Failed to load proto definition')
      throw error
    }
  }

  private getClient(instanceId: string, address: string): BattleServiceClient {
    if (this.clients.has(instanceId)) {
      return this.clients.get(instanceId)!
    }

    try {
      const battleProto = grpc.loadPackageDefinition(this.packageDefinition).battle as {
        BattleService: grpc.ServiceClientConstructor
      }
      const client = new battleProto.BattleService(address, grpc.credentials.createInsecure(), {
        'grpc.keepalive_time_ms': 30000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1,
        'grpc.http2.max_pings_without_data': 0,
        'grpc.http2.min_time_between_pings_ms': 10000,
        'grpc.http2.min_ping_interval_without_data_ms': 300000,
      }) as unknown as BattleServiceClient

      this.clients.set(instanceId, client)
      logger.debug({ instanceId, address }, 'Created new RPC client')
      return client
    } catch (error) {
      logger.error({ error, instanceId, address }, 'Failed to create RPC client')
      throw error
    }
  }

  private async callWithTimeout<TRequest, TResponse>(
    client: BattleServiceClient,
    method: keyof BattleServiceClient,
    request: TRequest,
    timeout: number = this.REQUEST_TIMEOUT,
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('RPC_TIMEOUT'))
      }, timeout)

      const clientMethod = client[method] as (req: TRequest, callback: grpc.requestCallback<TResponse>) => void
      clientMethod.call(client, request, (error: grpc.ServiceError | null, response?: TResponse) => {
        clearTimeout(timer)

        if (error) {
          logger.error({ error, method, request }, 'RPC call failed')
          reject(error)
        } else if (response && (response as any).success === false) {
          reject(new Error((response as any).error || 'RPC_ERROR'))
        } else if (response) {
          resolve(response)
        } else {
          reject(new Error('No response received'))
        }
      })
    })
  }

  // === 公共API方法 ===

  async submitPlayerSelection(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
    selectionData: unknown,
  ): Promise<{ status: string }> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<PlayerSelectionRequest, PlayerSelectionResponse>(
      client,
      'SubmitPlayerSelection',
      {
        roomId,
        playerId,
        selectionData: JSON.stringify(selectionData),
      },
    )

    return { status: response.status }
  }

  async getAvailableSelection(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
  ): Promise<unknown[]> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<SelectionRequest, SelectionResponse>(client, 'GetAvailableSelection', {
      roomId,
      playerId,
    })

    return JSON.parse(response.selections)
  }

  async getBattleState(instanceId: string, address: string, roomId: string, playerId: string): Promise<unknown> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<BattleStateRequest, BattleStateResponse>(client, 'GetBattleState', {
      roomId,
      playerId,
    })

    return JSON.parse(response.battleState)
  }

  async playerReady(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
  ): Promise<{ status: string }> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<ReadyRequest, ReadyResponse>(client, 'PlayerReady', {
      roomId,
      playerId,
    })

    return { status: response.status }
  }

  async playerAbandon(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
  ): Promise<{ status: string }> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<AbandonRequest, AbandonResponse>(client, 'PlayerAbandon', {
      roomId,
      playerId,
    })

    return { status: response.status }
  }

  async reportAnimationEnd(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
    animationData: unknown,
  ): Promise<{ status: string }> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<AnimationEndRequest, AnimationEndResponse>(
      client,
      'ReportAnimationEnd',
      {
        roomId,
        playerId,
        animationData: JSON.stringify(animationData),
      },
    )

    return { status: response.status }
  }

  async isTimerEnabled(instanceId: string, address: string, roomId: string, playerId: string): Promise<boolean> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<TimerEnabledRequest, TimerEnabledResponse>(client, 'IsTimerEnabled', {
      roomId,
      playerId,
    })

    return response.enabled
  }

  async getPlayerTimerState(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
    timerData: unknown,
  ): Promise<unknown> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<PlayerTimerStateRequest, PlayerTimerStateResponse>(
      client,
      'GetPlayerTimerState',
      {
        roomId,
        playerId,
        timerData: JSON.stringify(timerData),
      },
    )

    return JSON.parse(response.timerState)
  }

  async getAllPlayerTimerStates(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
  ): Promise<unknown> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<AllPlayerTimerStatesRequest, AllPlayerTimerStatesResponse>(
      client,
      'GetAllPlayerTimerStates',
      {
        roomId,
        playerId,
      },
    )

    return JSON.parse(response.timerStates)
  }

  async getTimerConfig(instanceId: string, address: string, roomId: string, playerId: string): Promise<unknown> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<TimerConfigRequest, TimerConfigResponse>(client, 'GetTimerConfig', {
      roomId,
      playerId,
    })

    return JSON.parse(response.config)
  }

  async startAnimation(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
    animationData: any,
  ): Promise<any> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<StartAnimationRequest, StartAnimationResponse>(
      client,
      'StartAnimation',
      {
        roomId,
        playerId,
        animationData: JSON.stringify(animationData),
      },
    )

    return JSON.parse(response.result)
  }

  async endAnimation(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
    animationData: any,
  ): Promise<{ status: string }> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<EndAnimationRequest, EndAnimationResponse>(client, 'EndAnimation', {
      roomId,
      playerId,
      animationData: JSON.stringify(animationData),
    })

    return { status: response.status }
  }

  async terminateBattle(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
    reason: string,
  ): Promise<{ status: string }> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<TerminateBattleRequest, TerminateBattleResponse>(
      client,
      'TerminateBattle',
      {
        roomId,
        playerId,
        reason,
      },
    )

    return { status: response.status }
  }

  async joinSpectateBattle(
    instanceId: string,
    address: string,
    roomId: string,
    playerId: string,
    sessionId: string,
  ): Promise<boolean> {
    const client = this.getClient(instanceId, address)
    const response = await this.callWithTimeout<any, any>(client, 'JoinSpectateBattle', {
      roomId,
      playerId,
      sessionId,
    })

    return response.success
  }

  // === 连接管理 ===

  closeClient(instanceId: string): void {
    const client = this.clients.get(instanceId)
    if (client) {
      try {
        // gRPC客户端没有显式的close方法，但我们可以从缓存中移除
        this.clients.delete(instanceId)
        logger.debug({ instanceId }, 'RPC client removed from cache')
      } catch (error) {
        logger.error({ error, instanceId }, 'Error closing RPC client')
      }
    }
  }

  closeAllClients(): void {
    for (const instanceId of this.clients.keys()) {
      this.closeClient(instanceId)
    }
    logger.info('All RPC clients closed')
  }

  // === 服务发现集成方法 ===

  /**
   * 通过服务发现获取最佳 gRPC 客户端
   */
  async getOptimalClient(): Promise<BattleServiceClient | null> {
    if (!this.serviceDiscovery) {
      logger.warn('Service discovery not configured, cannot get optimal client')
      return null
    }

    try {
      const instance = await this.serviceDiscovery.getOptimalGrpcInstance()
      if (!instance || !instance.rpcAddress) {
        logger.warn('No optimal gRPC instance available')
        return null
      }

      return this.getClient(instance.id, instance.rpcAddress)
    } catch (error) {
      logger.error({ error }, 'Error getting optimal gRPC client')
      return null
    }
  }

  /**
   * 通过服务发现获取指定实例的客户端
   */
  async getClientByInstanceId(instanceId: string): Promise<BattleServiceClient | null> {
    if (!this.serviceDiscovery) {
      logger.warn('Service discovery not configured, cannot get client by instance ID')
      return null
    }

    try {
      const address = await this.serviceDiscovery.getGrpcAddress(instanceId)
      if (!address) {
        logger.warn({ instanceId }, 'No gRPC address found for instance')
        return null
      }

      return this.getClient(instanceId, address)
    } catch (error) {
      logger.error({ error, instanceId }, 'Error getting gRPC client by instance ID')
      return null
    }
  }

  /**
   * 获取所有可用的 gRPC 客户端
   */
  async getAllAvailableClients(): Promise<Array<{ instanceId: string; client: BattleServiceClient }>> {
    if (!this.serviceDiscovery) {
      logger.warn('Service discovery not configured, cannot get all clients')
      return []
    }

    try {
      const addresses = await this.serviceDiscovery.getAllGrpcAddresses()
      const clients = addresses.map(({ instanceId, address }) => ({
        instanceId,
        client: this.getClient(instanceId, address),
      }))

      logger.debug({ count: clients.length }, 'Retrieved all available gRPC clients')
      return clients
    } catch (error) {
      logger.error({ error }, 'Error getting all available gRPC clients')
      return []
    }
  }
}
