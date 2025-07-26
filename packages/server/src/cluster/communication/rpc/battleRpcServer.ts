import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import pino from 'pino'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import type { ClusterBattleServer } from '../../../domain/battle/services/clusterBattleServer'
import { injectable, inject } from 'inversify'
import { TYPES } from '../../../types'
import type {
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
  CreateBattleRequest,
  CreateBattleResponse,
} from '../../../generated/grpc-types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

@injectable()
export class BattleRpcServer {
  private server: grpc.Server
  private battleServer: ClusterBattleServer
  private port: number

  constructor(
    @inject(TYPES.ClusterBattleServer) battleServer: ClusterBattleServer,
    @inject(TYPES.RpcPort) port: number,
  ) {
    this.battleServer = battleServer
    this.port = port
    this.server = new grpc.Server()
    this.setupService()
  }

  private setupService(): void {
    try {
      // 加载proto定义 - 支持多种路径解析
      let protoPath: string | undefined

      // 尝试多个可能的路径
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

      logger.debug({ protoPath }, 'Battle RPC proto definition loaded')

      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      })

      const battleProto = grpc.loadPackageDefinition(packageDefinition).battle as unknown as {
        BattleService: { service: grpc.ServiceDefinition }
      }

      // 注册服务实现
      this.server.addService(battleProto.BattleService.service, {
        SubmitPlayerSelection: this.handleSubmitPlayerSelection.bind(this),
        GetAvailableSelection: this.handleGetAvailableSelection.bind(this),
        GetBattleState: this.handleGetBattleState.bind(this),
        PlayerReady: this.handlePlayerReady.bind(this),
        PlayerAbandon: this.handlePlayerAbandon.bind(this),
        ReportAnimationEnd: this.handleReportAnimationEnd.bind(this),
        IsTimerEnabled: this.handleIsTimerEnabled.bind(this),
        GetPlayerTimerState: this.handleGetPlayerTimerState.bind(this),
        GetAllPlayerTimerStates: this.handleGetAllPlayerTimerStates.bind(this),
        GetTimerConfig: this.handleGetTimerConfig.bind(this),
        StartAnimation: this.handleStartAnimation.bind(this),
        EndAnimation: this.handleEndAnimation.bind(this),
        TerminateBattle: this.handleTerminateBattle.bind(this),
        CreateBattle: this.handleCreateBattle.bind(this),
      })

      logger.info({ port: this.port }, 'Battle RPC service configured')
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Failed to setup RPC service',
      )
      throw error
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 在 Fly.io 环境中，绑定到所有接口
      const bindAddress = process.env.GRPC_BIND_ADDRESS || '0.0.0.0'
      const fullAddress = `${bindAddress}:${this.port}`

      this.server.bindAsync(fullAddress, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
        if (err) {
          logger.error({ error: err, port: this.port, bindAddress }, 'Failed to start Battle RPC server')
          reject(err)
          return
        }

        logger.info(
          {
            port: boundPort,
            bindAddress,
            isFlyIo: Boolean(process.env.FLY_APP_NAME),
            flyRegion: process.env.FLY_REGION,
          },
          'Battle RPC server started successfully',
        )
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise(resolve => {
      this.server.tryShutdown(error => {
        if (error) {
          logger.error({ error }, 'Error during RPC server shutdown')
        } else {
          logger.info('Battle RPC server stopped')
        }
        resolve()
      })
    })
  }

  // === RPC方法实现 ===

  private async handleSubmitPlayerSelection(
    call: grpc.ServerUnaryCall<PlayerSelectionRequest, any>,
    callback: grpc.sendUnaryData<PlayerSelectionResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId, selectionData } = call.request
      logger.debug({ roomId, playerId }, 'RPC: SubmitPlayerSelection')

      const selectionObj = JSON.parse(selectionData)
      const result = await this.battleServer.handleLocalPlayerSelection(roomId, playerId, selectionObj)

      callback(null, {
        success: true,
        status: result.status,
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: SubmitPlayerSelection')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: '',
      })
    }
  }

  private async handleGetAvailableSelection(
    call: grpc.ServerUnaryCall<SelectionRequest, any>,
    callback: grpc.sendUnaryData<SelectionResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId } = call.request
      logger.debug({ roomId, playerId }, 'RPC: GetAvailableSelection')

      const result = await this.battleServer.handleLocalGetSelection(roomId, playerId)

      callback(null, {
        success: true,
        selections: JSON.stringify(result),
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetAvailableSelection')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        selections: '',
      })
    }
  }

  private async handleGetBattleState(
    call: grpc.ServerUnaryCall<BattleStateRequest, any>,
    callback: grpc.sendUnaryData<BattleStateResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId } = call.request
      logger.debug({ roomId, playerId }, 'RPC: GetBattleState')

      const battleState = await this.battleServer.handleLocalGetState(roomId, playerId)

      callback(null, {
        success: true,
        battleState: JSON.stringify(battleState),
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetBattleState')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        battleState: '',
      })
    }
  }

  private async handlePlayerReady(
    call: grpc.ServerUnaryCall<ReadyRequest, any>,
    callback: grpc.sendUnaryData<ReadyResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId } = call.request
      logger.debug({ roomId, playerId }, 'RPC: PlayerReady')

      const result = await this.battleServer.handleLocalReady(roomId, playerId)

      callback(null, {
        success: true,
        status: result.status,
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: PlayerReady')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: '',
      })
    }
  }

  private async handlePlayerAbandon(
    call: grpc.ServerUnaryCall<AbandonRequest, any>,
    callback: grpc.sendUnaryData<AbandonResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId } = call.request
      logger.debug({ roomId, playerId }, 'RPC: PlayerAbandon')

      const result = await this.battleServer.handleLocalPlayerAbandon(roomId, playerId)

      callback(null, {
        success: true,
        status: result.status,
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: PlayerAbandon')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: '',
      })
    }
  }

  private async handleReportAnimationEnd(
    call: grpc.ServerUnaryCall<AnimationEndRequest, any>,
    callback: grpc.sendUnaryData<AnimationEndResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId, animationData } = call.request
      logger.debug({ roomId, playerId }, 'RPC: ReportAnimationEnd')

      const animationObj = JSON.parse(animationData)
      const result = await this.battleServer.handleLocalReportAnimationEnd(roomId, playerId, animationObj)

      callback(null, {
        success: true,
        status: result.status,
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: ReportAnimationEnd')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: '',
      })
    }
  }

  private async handleIsTimerEnabled(
    call: grpc.ServerUnaryCall<TimerEnabledRequest, any>,
    callback: grpc.sendUnaryData<TimerEnabledResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId } = call.request
      logger.debug({ roomId, playerId }, 'RPC: IsTimerEnabled')

      const result = await this.battleServer.handleLocalIsTimerEnabled(roomId, playerId)

      callback(null, {
        success: true,
        enabled: result,
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: IsTimerEnabled')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        enabled: false,
      })
    }
  }

  private async handleGetPlayerTimerState(
    call: grpc.ServerUnaryCall<PlayerTimerStateRequest, any>,
    callback: grpc.sendUnaryData<PlayerTimerStateResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId, timerData } = call.request
      logger.debug({ roomId, playerId }, 'RPC: GetPlayerTimerState')

      const timerObj = JSON.parse(timerData)
      const result = await this.battleServer.handleLocalGetPlayerTimerState(roomId, playerId, timerObj)

      callback(null, {
        success: true,
        timerState: JSON.stringify(result),
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetPlayerTimerState')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timerState: '',
      })
    }
  }

  private async handleGetAllPlayerTimerStates(
    call: grpc.ServerUnaryCall<AllPlayerTimerStatesRequest, any>,
    callback: grpc.sendUnaryData<AllPlayerTimerStatesResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId } = call.request
      logger.debug({ roomId, playerId }, 'RPC: GetAllPlayerTimerStates')

      const result = await this.battleServer.handleLocalGetAllPlayerTimerStates(roomId, playerId)

      callback(null, {
        success: true,
        timerStates: JSON.stringify(result),
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetAllPlayerTimerStates')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timerStates: '',
      })
    }
  }

  private async handleGetTimerConfig(
    call: grpc.ServerUnaryCall<TimerConfigRequest, any>,
    callback: grpc.sendUnaryData<TimerConfigResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId } = call.request
      logger.debug({ roomId, playerId }, 'RPC: GetTimerConfig')

      const result = await this.battleServer.handleLocalGetTimerConfig(roomId, playerId)

      callback(null, {
        success: true,
        config: JSON.stringify(result),
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetTimerConfig')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        config: '',
      })
    }
  }

  private async handleStartAnimation(
    call: grpc.ServerUnaryCall<StartAnimationRequest, any>,
    callback: grpc.sendUnaryData<StartAnimationResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId, animationData } = call.request
      logger.debug({ roomId, playerId }, 'RPC: StartAnimation')

      const animationObj = JSON.parse(animationData)
      const result = await this.battleServer.handleLocalStartAnimation(roomId, playerId, animationObj)

      callback(null, {
        success: true,
        result: JSON.stringify(result),
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: StartAnimation')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        result: '',
      })
    }
  }

  private async handleEndAnimation(
    call: grpc.ServerUnaryCall<EndAnimationRequest, any>,
    callback: grpc.sendUnaryData<EndAnimationResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId, animationData } = call.request
      logger.debug({ roomId, playerId }, 'RPC: EndAnimation')

      const animationObj = JSON.parse(animationData)
      const result = await this.battleServer.handleLocalEndAnimation(roomId, playerId, animationObj)

      callback(null, {
        success: true,
        status: result.status,
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: EndAnimation')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: '',
      })
    }
  }

  private async handleTerminateBattle(
    call: grpc.ServerUnaryCall<TerminateBattleRequest, any>,
    callback: grpc.sendUnaryData<TerminateBattleResponse>,
  ): Promise<void> {
    try {
      const { roomId, playerId, reason } = call.request
      logger.debug({ roomId, playerId, reason }, 'RPC: TerminateBattle')

      const result = await this.battleServer.handleLocalBattleTermination(roomId, playerId, reason)

      callback(null, {
        success: true,
        status: result.status,
        error: '',
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: TerminateBattle')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: '',
      })
    }
  }

  private async handleCreateBattle(
    call: grpc.ServerUnaryCall<CreateBattleRequest, any>,
    callback: grpc.sendUnaryData<CreateBattleResponse>,
  ): Promise<void> {
    try {
      const { player1Entry: player1Proto, player2Entry: player2Proto } = call.request

      if (!player1Proto || !player2Proto) {
        throw new Error('Missing player entries in CreateBattle request')
      }

      logger.info(
        {
          player1Id: player1Proto.playerId,
          player2Id: player2Proto.playerId,
          instanceId: this.battleServer.currentInstanceId,
        },
        'RPC: CreateBattle request received',
      )

      // 转换proto消息为MatchmakingEntry格式
      const player1Entry = {
        playerId: player1Proto.playerId,
        sessionId: player1Proto.sessionId,
        playerData: JSON.parse(player1Proto.playerData),
        ruleSetId: player1Proto.ruleSetId,
        joinTime: Number(player1Proto.joinTime),
        metadata: {
          sessionId: player1Proto.sessionId,
          ruleSetId: player1Proto.ruleSetId,
        },
      }

      const player2Entry = {
        playerId: player2Proto.playerId,
        sessionId: player2Proto.sessionId,
        playerData: JSON.parse(player2Proto.playerData),
        ruleSetId: player2Proto.ruleSetId,
        joinTime: Number(player2Proto.joinTime),
        metadata: {
          sessionId: player2Proto.sessionId,
          ruleSetId: player2Proto.ruleSetId,
        },
      }

      // 调用本地战斗创建方法
      const roomId = await this.battleServer.createClusterBattleRoom(player1Entry, player2Entry)

      if (roomId) {
        logger.info(
          {
            roomId,
            player1Id: player1Entry.playerId,
            player2Id: player2Entry.playerId,
            instanceId: this.battleServer.currentInstanceId,
          },
          'RPC: Battle created successfully',
        )

        callback(null, {
          success: true,
          roomId: roomId,
          error: '',
        })
      } else {
        logger.warn(
          {
            player1Id: player1Entry.playerId,
            player2Id: player2Entry.playerId,
            instanceId: this.battleServer.currentInstanceId,
          },
          'RPC: Battle creation failed',
        )

        callback(null, {
          success: false,
          error: 'Failed to create battle room',
          roomId: '',
        })
      }
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: CreateBattle')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        roomId: '',
      })
    }
  }
}
