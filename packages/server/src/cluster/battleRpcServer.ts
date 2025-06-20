import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import pino from 'pino'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import type { ClusterBattleServer } from './clusterBattleServer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

export class BattleRpcServer {
  private server: grpc.Server
  private battleServer: ClusterBattleServer
  private port: number

  constructor(battleServer: ClusterBattleServer, port: number) {
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

      const battleProto = grpc.loadPackageDefinition(packageDefinition).battle as any

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
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id, selection_data } = call.request
      logger.debug({ room_id, player_id }, 'RPC: SubmitPlayerSelection')

      const selectionObj = JSON.parse(selection_data)
      const result = await this.battleServer.handleLocalPlayerSelection(room_id, player_id, selectionObj)

      callback(null, {
        success: true,
        status: result.status,
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: SubmitPlayerSelection')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleGetAvailableSelection(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id } = call.request
      logger.debug({ room_id, player_id }, 'RPC: GetAvailableSelection')

      const result = await this.battleServer.handleLocalGetSelection(room_id, player_id)

      callback(null, {
        success: true,
        selections: JSON.stringify(result),
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetAvailableSelection')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleGetBattleState(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id } = call.request
      logger.debug({ room_id, player_id }, 'RPC: GetBattleState')

      const battleState = await this.battleServer.handleLocalGetState(room_id, player_id)

      callback(null, {
        success: true,
        battle_state: JSON.stringify(battleState),
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetBattleState')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handlePlayerReady(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id } = call.request
      logger.debug({ room_id, player_id }, 'RPC: PlayerReady')

      const result = await this.battleServer.handleLocalReady(room_id, player_id)

      callback(null, {
        success: true,
        status: result.status,
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: PlayerReady')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handlePlayerAbandon(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id } = call.request
      logger.debug({ room_id, player_id }, 'RPC: PlayerAbandon')

      const result = await this.battleServer.handleLocalPlayerAbandon(room_id, player_id)

      callback(null, {
        success: true,
        status: result.status,
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: PlayerAbandon')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleReportAnimationEnd(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id, animation_data } = call.request
      logger.debug({ room_id, player_id }, 'RPC: ReportAnimationEnd')

      const animationObj = JSON.parse(animation_data)
      const result = await this.battleServer.handleLocalReportAnimationEnd(room_id, player_id, animationObj)

      callback(null, {
        success: true,
        status: result.status,
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: ReportAnimationEnd')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleIsTimerEnabled(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id } = call.request
      logger.debug({ room_id, player_id }, 'RPC: IsTimerEnabled')

      const result = await this.battleServer.handleLocalIsTimerEnabled(room_id, player_id)

      callback(null, {
        success: true,
        enabled: result,
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: IsTimerEnabled')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleGetPlayerTimerState(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id, timer_data } = call.request
      logger.debug({ room_id, player_id }, 'RPC: GetPlayerTimerState')

      const timerObj = JSON.parse(timer_data)
      const result = await this.battleServer.handleLocalGetPlayerTimerState(room_id, player_id, timerObj)

      callback(null, {
        success: true,
        timer_state: JSON.stringify(result),
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetPlayerTimerState')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleGetAllPlayerTimerStates(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id } = call.request
      logger.debug({ room_id, player_id }, 'RPC: GetAllPlayerTimerStates')

      const result = await this.battleServer.handleLocalGetAllPlayerTimerStates(room_id, player_id)

      callback(null, {
        success: true,
        timer_states: JSON.stringify(result),
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetAllPlayerTimerStates')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleGetTimerConfig(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id } = call.request
      logger.debug({ room_id, player_id }, 'RPC: GetTimerConfig')

      const result = await this.battleServer.handleLocalGetTimerConfig(room_id, player_id)

      callback(null, {
        success: true,
        config: JSON.stringify(result),
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: GetTimerConfig')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleStartAnimation(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id, animation_data } = call.request
      logger.debug({ room_id, player_id }, 'RPC: StartAnimation')

      const animationObj = JSON.parse(animation_data)
      const result = await this.battleServer.handleLocalStartAnimation(room_id, player_id, animationObj)

      callback(null, {
        success: true,
        result: JSON.stringify(result),
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: StartAnimation')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleEndAnimation(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id, animation_data } = call.request
      logger.debug({ room_id, player_id }, 'RPC: EndAnimation')

      const animationObj = JSON.parse(animation_data)
      const result = await this.battleServer.handleLocalEndAnimation(room_id, player_id, animationObj)

      callback(null, {
        success: true,
        status: result.status,
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: EndAnimation')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  private async handleTerminateBattle(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
  ): Promise<void> {
    try {
      const { room_id, player_id, reason } = call.request
      logger.debug({ room_id, player_id, reason }, 'RPC: TerminateBattle')

      const result = await this.battleServer.handleLocalBattleTermination(room_id, player_id, reason)

      callback(null, {
        success: true,
        status: result.status,
      })
    } catch (error) {
      logger.error({ error, request: call.request }, 'RPC error: TerminateBattle')
      callback(null, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}
