import { Battle } from '@arcadia-eternity/battle'
import {
  BattleMessageType,
  BattleStatus,
  type BattleState,
  type BattleMessage,
  type PlayerTimerState,
  type TimerConfig,
  type playerId,
} from '@arcadia-eternity/const'
import { PlayerParser, SelectionParser } from '@arcadia-eternity/parser'
import { ScriptLoader } from '@arcadia-eternity/data-repository'
import type {
  AckResponse,
  ClientToServerEvents,
  ErrorResponse,
  ServerState,
  ServerToClientEvents,
} from '@arcadia-eternity/protocol'
import { type PlayerSelectionSchemaType, PlayerSelectionSchema } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import pino from 'pino'
import type { Server, Socket } from 'socket.io'
import { ZodError } from 'zod'
import { BattleReportService, type BattleReportConfig } from './battleReportService'
import { getContainer, TYPES } from './container'
import type { IAuthService, JWTPayload } from './authService'
import { PlayerRepository } from '@arcadia-eternity/database'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

type BattleRoom = {
  id: string
  battle: Battle
  battlePromise?: Promise<void>
  players: Map<string, GamePlayer>
  playersReady: WeakMap<GamePlayer, boolean>
  status: 'waiting' | 'active' | 'ended'
  lastActive: number
  battleRecordId?: string // 战报记录ID
}

type GamePlayer = {
  socket: Socket<ClientToServerEvents, ServerToClientEvents>
  playerData: ReturnType<typeof PlayerParser.parse>
  lastPing: number
  online: boolean
  disconnectTimer?: ReturnType<typeof setTimeout>
}

type PlayerMeta = {
  socket: Socket<ClientToServerEvents, ServerToClientEvents>
  lastPing: number
  heartbeatTimer?: ReturnType<typeof setTimeout>
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface InterServerEvents {}

interface SocketData {
  data: ReturnType<typeof PlayerParser.parse>
  roomId: string
  user?: JWTPayload // 认证用户信息
  playerId?: string // 认证的玩家ID
}

export class BattleServer {
  private readonly INACTIVE_TIMEOUT = 30 * 60 * 1000
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000
  private readonly RECONNECT_TIMEOUT = 30 * 1000
  private readonly rooms = new Map<string, BattleRoom>()
  private readonly matchQueue = new Set<string>()
  private readonly HEARTBEAT_INTERVAL = 5000
  private readonly players = new Map<string, PlayerMeta>()
  private scriptLoader?: ScriptLoader
  private battleReportService?: BattleReportService

  constructor(
    private readonly io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    private readonly battleReportConfig?: BattleReportConfig,
  ) {
    this.initializeMiddleware()
    this.setupConnectionHandlers()
    this.setupHeartbeatSystem()
    this.setupAutoUpdateState()
    this.setupAutoCleanup()

    // 初始化战报服务
    if (battleReportConfig) {
      this.battleReportService = new BattleReportService(battleReportConfig, logger)
    }
  }

  private initializeMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        // 从查询参数中获取玩家ID
        const playerId = socket.handshake.query?.playerId as string

        if (!playerId) {
          logger.debug('No playerId provided for socket connection')
          return next(new Error('PLAYER_ID_REQUIRED'))
        }

        const container = getContainer()
        const playerRepo = container.get<PlayerRepository>(TYPES.PlayerRepository)
        const authService = container.get<IAuthService>(TYPES.AuthService)

        // 检查玩家是否存在
        const player = await playerRepo.getPlayerById(playerId)
        if (!player) {
          logger.debug(`Player not found: ${playerId}`)
          return next(new Error('PLAYER_NOT_FOUND'))
        }

        const isRegistered = player.is_registered || false
        socket.data.playerId = playerId

        if (!isRegistered) {
          // 游客用户，直接放行
          logger.debug(`Guest user socket connection: ${playerId}`)
          socket.data.user = undefined
          next()
          return
        }

        // 注册用户，需要JWT认证
        const token = socket.handshake.auth?.token || (socket.handshake.query?.token as string)

        logger.debug(`Socket auth debug for ${playerId}:`)
        logger.debug(`- hasAuth: ${!!socket.handshake.auth}`)
        logger.debug(`- authKeys: ${socket.handshake.auth ? Object.keys(socket.handshake.auth).join(',') : 'none'}`)
        logger.debug(`- hasQuery: ${!!socket.handshake.query}`)
        logger.debug(`- queryKeys: ${socket.handshake.query ? Object.keys(socket.handshake.query).join(',') : 'none'}`)
        logger.debug(`- hasToken: ${!!token}`)
        if (token) {
          logger.debug(`- tokenPreview: ${token.substring(0, 50)}...`)
        }

        if (!token) {
          logger.debug(`Registered user missing token: ${playerId}`)
          return next(new Error('TOKEN_REQUIRED_FOR_REGISTERED_USER'))
        }

        // 验证token
        let payload: any
        try {
          payload = authService.verifyAccessToken(token)
          if (!payload) {
            logger.debug(`Token verification returned null for user: ${playerId}`)
            logger.debug(`Token length: ${token.length}`)
            logger.debug(`Token start: ${token.substring(0, 100)}`)
            return next(new Error('INVALID_TOKEN'))
          }
          logger.debug(`Token verification successful for user: ${playerId}`)
        } catch (error) {
          logger.debug(`Token verification error for user: ${playerId}`)
          logger.debug(`Error: ${error}`)
          logger.debug(`Token: ${token.substring(0, 100)}`)
          return next(new Error('INVALID_TOKEN'))
        }

        // 验证token中的玩家ID是否匹配
        if (payload.playerId !== playerId) {
          logger.warn(`Socket player ID mismatch: token=${payload.playerId}, request=${playerId}`)
          return next(new Error('PLAYER_ID_TOKEN_MISMATCH'))
        }

        // 将认证信息添加到socket数据
        socket.data.user = payload
        logger.debug(`Registered user socket authenticated: ${playerId}`)
        next()
      } catch (error) {
        logger.error({ error }, 'Socket authentication error')
        next(new Error('AUTHENTICATION_ERROR'))
      }
    })
  }

  private setupAutoUpdateState() {
    setInterval(() => {
      const state: ServerState = this.getCurrentState()
      this.io.emit('updateState', state)
    }, 10000)
  }

  private setupConnectionHandlers() {
    this.io.on('connection', socket => {
      logger.info({ socketId: socket.id }, '玩家连接')
      this.registerPlayer(socket) // 注册到玩家池

      socket.on('pong', () => {
        const player = this.players.get(socket.id)
        if (player) player.lastPing = Date.now()
        const room = this.getPlayerRoom(socket.id)
        if (room) room.lastActive = Date.now()
      })

      socket.on('disconnect', () => {
        logger.info({ socketId: socket.id }, '玩家断开连接')
        const room = this.getPlayerRoom(socket.id)

        if (room) {
          const player = room.players.get(socket.id)
          if (player) {
            this.handlePlayerAbandon(room.id, socket.id)
          }
          this.removePlayer(socket.id)
        } else {
          this.removePlayer(socket.id)
        }
      })

      this.setupSocketHandlers(socket)
    })
  }

  private setupSocketHandlers(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ) {
    socket.on('joinMatchmaking', (data, ack) => this.handleJoinMatchmaking(socket, data, ack))
    socket.on('cancelMatchmaking', ack => this.handleCancelMatchmaking(socket, ack))
    socket.on('submitPlayerSelection', (data, ack) => this.handleplayerSelection(socket, data, ack))
    socket.on('getState', ack => this.handleGetState(socket, ack))
    socket.on('getAvailableSelection', ack => this.handleGetSelection(socket, ack))
    socket.on('getServerState', ack => this.handleGetServerState(socket, ack))
    socket.on('ready', () => this.handleReady(socket))
    socket.on('reportAnimationEnd', data => this.handleReportAnimationEnd(socket, data))

    // 计时器相关事件处理
    socket.on('isTimerEnabled', ack => this.handleIsTimerEnabled(socket, ack))
    socket.on('getPlayerTimerState', (data, ack) => this.handleGetPlayerTimerState(socket, data, ack))
    socket.on('getAllPlayerTimerStates', ack => this.handleGetAllPlayerTimerStates(socket, ack))
    socket.on('getTimerConfig', ack => this.handleGetTimerConfig(socket, ack))
    socket.on('startAnimation', (data, ack) => this.handleStartAnimation(socket, data, ack))
    socket.on('endAnimation', data => this.handleEndAnimation(socket, data))
  }

  private setupAutoCleanup() {
    const cleaner = setInterval(() => {
      const now = Date.now()
      this.rooms.forEach((room, roomId) => {
        // 跳过已结束的房间
        if (room.status === 'ended') return

        const inactiveDuration = now - room.lastActive
        const shouldCleanup = inactiveDuration > this.INACTIVE_TIMEOUT

        logger.debug(
          {
            roomId,
            status: room.status,
            inactiveMinutes: Math.floor(inactiveDuration / 60000),
            players: Array.from(room.players.keys()),
          },
          '检查房间活跃状态',
        )

        if (shouldCleanup) {
          logger.warn(
            {
              roomId,
              lastActive: new Date(room.lastActive).toISOString(),
              inactiveMinutes: Math.floor(inactiveDuration / 60000),
            },
            '清理不活跃房间',
          )
          this.cleanupRoom(roomId)
        }
      })
    }, this.CLEANUP_INTERVAL)

    this.io.engine.on('close', () => clearInterval(cleaner))
  }

  private getCurrentState() {
    return {
      onlinePlayers: this.io.engine.clientsCount,
      matchmakingQueue: this.matchQueue.size,
      rooms: this.rooms.size,
      playersInRooms: Array.from(this.rooms.values()).reduce((acc, room) => acc + room.players.size, 0),
    }
  }

  private handleGetServerState(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<ServerState>,
  ) {
    const state: ServerState = this.getCurrentState()
    ack?.({
      status: 'SUCCESS',
      data: state,
    })
  }

  private handleJoinMatchmaking(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    rawPlayerData: unknown,
    ack?: AckResponse<{ status: 'QUEUED' }>,
  ) {
    try {
      const playerData = this.validatePlayerData(rawPlayerData)

      // 验证玩家ID是否与连接时验证的ID一致
      if (socket.data.playerId && playerData.id !== socket.data.playerId) {
        logger.warn(
          {
            socketId: socket.id,
            connectedPlayerId: socket.data.playerId,
            requestedPlayerId: playerData.id,
          },
          '玩家ID不匹配，拒绝加入匹配',
        )
        throw new Error('PLAYER_ID_MISMATCH')
      }

      socket.data.data = playerData

      logger.info(
        {
          socketId: socket.id,
          player: {
            id: socket.data.data.id,
            name: socket.data.data.name,
            teamSize: socket.data.data.team.length,
          },
          queueSize: this.matchQueue.size + 1,
        },
        '玩家加入匹配队列',
      )
      this.matchQueue.add(socket.id)
      ack?.({
        status: 'SUCCESS',
        data: { status: 'QUEUED' },
      })
      logger.debug(
        {
          currentQueue: Array.from(this.matchQueue),
          roomCount: this.rooms.size,
        },
        '匹配系统状态',
      )
      this.attemptMatchmaking()
    } catch (error) {
      logger.error(
        {
          socketId: socket.id,
          error: error instanceof Error ? error.stack : error,
          inputData: rawPlayerData,
        },
        '加入匹配队列失败',
      )
      this.handleValidationError(error, socket, ack)
    }
  }

  private handlePlayerAbandon(roomId: string, socketId: string) {
    const room = this.rooms.get(roomId)
    if (!room) return

    const player = room.players.get(socketId)
    if (!player) return

    logger.warn({ socketId, roomId }, '玩家放弃战斗')

    // 在战斗逻辑中标记玩家放弃
    room.battle.abandonPlayer(player.playerData.id)

    // 推进战斗流程
    this.checkBattleProgress(room)

    // 清理玩家数据
    room.players.delete(socketId)
    this.players.delete(socketId)

    // 如果房间为空则清理
    if (room.players.size === 0) {
      this.cleanupRoom(roomId)
    }
  }

  // 新增取消匹配处理方法
  private handleCancelMatchmaking(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<{ status: 'CANCELED' }>,
  ) {
    try {
      // 检查是否在匹配队列中
      if (!this.matchQueue.has(socket.id)) {
        throw new Error('NOT_IN_QUEUE')
      }

      // 从队列中移除
      this.matchQueue.delete(socket.id)

      logger.info({ socketId: socket.id, queueSize: this.matchQueue.size }, '玩家取消匹配')

      // 发送成功响应
      ack?.({
        status: 'SUCCESS',
        data: { status: 'CANCELED' },
      })
    } catch (error) {
      this.handleCancelError(error, socket, ack)
    }
  }

  // 新增取消错误处理
  private handleCancelError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<{ status: 'CANCELED' }>,
  ) {
    const errorResponse: ErrorResponse = {
      status: 'ERROR',
      code: 'CANCEL_FAILED',
      details: error instanceof Error ? error.message : '取消匹配失败',
    }

    ack?.(errorResponse)
    logger.warn({ socketId: socket.id, error: error instanceof Error ? error.stack : error }, '取消匹配时发生错误')
  }

  private handleplayerSelection(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    rawData: unknown,
    ack?: AckResponse<{ status: 'ACTION_ACCEPTED' }>,
  ) {
    try {
      const selection = this.processplayerSelection(socket.id, rawData)
      const room = this.getPlayerRoom(socket.id)

      if (!room) throw new Error('NOT_IN_BATTLE')
      room.lastActive = Date.now()
      if (!room.battle.setSelection(selection)) {
        throw new Error('INVALID_SELECTION')
      }

      this.checkBattleProgress(room)
      ack?.({
        status: 'SUCCESS',
        data: { status: 'ACTION_ACCEPTED' },
      })
    } catch (error) {
      this.handleActionError(error, socket, ack)
    }
  }

  private handleGetState(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<BattleState>,
  ) {
    try {
      const room = this.getPlayerRoom(socket.id)

      if (!room) throw new Error('NOT_IN_BATTLE')
      room.lastActive = Date.now()
      const player = this.getPlayerBySocket(socket.id)
      ack?.({
        status: 'SUCCESS',
        data: room.battle.getState(player.playerData.id, false),
      })
    } catch (error) {
      this.handleGetStateError(error, socket, ack)
    }
  }

  private handleGetSelection(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<PlayerSelectionSchemaType[]>,
  ) {
    try {
      const player = this.getPlayerBySocket(socket.id)
      ack?.({
        status: 'SUCCESS',
        data: player.playerData.getAvailableSelection().map(v => SelectionParser.serialize(v)),
      })
    } catch (error) {
      this.handleGetSelectionError(error, socket, ack)
    }
  }

  // 修改后的错误处理方法
  private handleValidationError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ack?: AckResponse<any>,
  ) {
    const response: ErrorResponse = {
      status: 'ERROR',
      code: 'VALIDATION_ERROR',
      details: error instanceof Error ? error.message : 'Invalid data format',
    }

    // 同时发送两种错误通知
    ack?.(response)
  }

  private handleActionError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<{ status: 'ACTION_ACCEPTED' }>,
  ) {
    const response: ErrorResponse = {
      status: 'ERROR',
      code: error instanceof Error ? error.message : 'ACTION_FAILED',
    }

    ack?.(response)
  }

  private handleGetStateError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<BattleState>,
  ) {
    const response: ErrorResponse = {
      status: 'ERROR',
      code: 'STATE_ERROR',
      details: error instanceof Error ? error.message : 'Failed to get state',
    }

    ack?.(response)
  }

  private handleMatchmakingError(
    error: unknown,
    ...sockets: (Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> | undefined)[]
  ) {
    // 构建标准错误响应
    const errorResponse: ErrorResponse = {
      status: 'ERROR',
      code: 'MATCH_FAILED',
      details: error instanceof Error ? error.message : String(error),
    }

    // 发送给所有相关客户端
    sockets.forEach(socket => {
      if (socket?.connected) {
        socket.emit('matchmakingError', errorResponse)
      }
    })

    // 清理无效的匹配队列
    sockets.forEach(socket => {
      if (socket) {
        this.matchQueue.delete(socket.id)
      }
    })
  }

  private handleGetSelectionError(
    error: unknown,
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<PlayerSelectionSchemaType[]>,
  ) {
    const response: ErrorResponse = {
      status: 'ERROR',
      code: 'SELECTION_ERROR',
      details: error instanceof Error ? error.message : 'Failed to get available selections',
    }

    // 同时通过ACK返回错误（如果存在回调）
    ack?.(response)
  }

  private validatePlayerData(rawData: unknown) {
    // PlayerParser now handles ZodError formatting internally
    return PlayerParser.parse(rawData)
  }

  private processplayerSelection(socketId: string, rawData: unknown) {
    try {
      const schemaValidated = PlayerSelectionSchema.parse(rawData)
      return SelectionParser.parse(schemaValidated)
    } catch (error) {
      logger.error(`Action parse failed [${socketId}]:`, error)
      throw error
    }
  }

  private attemptMatchmaking(maxRetries = 3) {
    let retryCount = 0

    const tryMatch = async () => {
      if (this.matchQueue.size < 2 || retryCount >= maxRetries) return

      // 寻找两个不同 playerId 的玩家进行匹配
      const queueArray = Array.from(this.matchQueue)
      let p1: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> | undefined
      let p2: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> | undefined
      let p1Id: string | undefined
      let p2Id: string | undefined

      // 选择第一个有效玩家
      for (const socketId of queueArray) {
        const socket = this.io.sockets.sockets.get(socketId)
        if (socket?.data.data) {
          p1 = socket
          p1Id = socketId
          break
        }
      }

      if (!p1 || !p1Id) {
        // 清理无效的队列项
        queueArray.forEach(id => {
          const socket = this.io.sockets.sockets.get(id)
          if (!socket?.data.data) {
            this.matchQueue.delete(id)
          }
        })
        return
      }

      // 选择第二个有效且 playerId 不同的玩家（防止自己匹配自己）
      for (const socketId of queueArray) {
        if (socketId === p1Id) continue // 跳过第一个玩家

        const socket = this.io.sockets.sockets.get(socketId)
        if (socket?.data.data && socket.data.data.id !== p1.data.data.id) {
          p2 = socket
          p2Id = socketId
          break
        }
      }

      if (!p2 || !p2Id) {
        // 如果找不到合适的第二个玩家，等待更多玩家加入
        if (queueArray.length >= 2) {
          logger.debug(
            {
              queueSize: this.matchQueue.size,
              p1PlayerId: p1.data.data.id,
              p1PlayerName: p1.data.data.name,
              reason: '队列中其他玩家都是相同playerId，等待不同playerId的玩家加入',
            },
            '暂时无法匹配，等待更多玩家',
          )
        }
        return
      }

      try {
        logger.info(
          {
            p1: { socketId: p1Id, playerId: p1.data.data.id, playerName: p1.data.data.name },
            p2: { socketId: p2Id, playerId: p2.data.data.id, playerName: p2.data.data.name },
            queueSize: this.matchQueue.size,
          },
          '成功匹配两个不同 playerId 的玩家',
        )

        const roomId = await this.createBattleRoom(p1, p2)
        this.finalizeMatchmaking(roomId, p1, p2)
      } catch (error) {
        this.handleMatchmakingError(error, p1, p2)
      }
    }

    tryMatch()
  }

  private async createBattleRoom(
    p1: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    p2: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ) {
    const roomId = `battle_${nanoid(12)}`
    p1.join(roomId)
    p2.join(roomId)

    const player1 = this.initializePlayer(p1)
    const player2 = this.initializePlayer(p2)
    // 创建 Battle 时不启用 showHidden，让每个监听器自己控制可见性
    // 默认启用计时器系统
    const battle = new Battle(player1.playerData, player2.playerData, {
      showHidden: false,
      timerConfig: {
        enabled: true,
        turnTimeLimit: 30, // 30秒每回合
        totalTimeLimit: 1500, // 25分钟总思考时间
        animationPauseEnabled: true,
        maxAnimationDuration: 20000, // 最大20秒动画时长，支持更长的技能动画
      },
    })

    // 开始战报记录（同步等待）
    let battleRecordId: string | undefined
    if (this.battleReportService) {
      try {
        logger.info(
          { roomId, playerAId: player1.playerData.id, playerBId: player2.playerData.id },
          'Starting battle record...',
        )

        battleRecordId =
          (await this.battleReportService.startBattleRecord(
            roomId,
            player1.playerData.id,
            player1.playerData.name,
            player2.playerData.id,
            player2.playerData.name,
          )) || undefined

        if (battleRecordId) {
          logger.info({ roomId, battleRecordId }, 'Battle record started successfully')
        } else {
          logger.warn({ roomId }, 'Battle record creation returned null - battle messages will not be recorded')
        }
      } catch (error) {
        logger.error({ error, roomId }, 'Failed to start battle record')
      }
    } else {
      logger.debug({ roomId }, 'Battle report service not available')
    }

    // 监听 Battle 对象的消息用于战报记录（包含完整信息）
    battle.registerListener(
      (message: BattleMessage) => {
        // 记录战斗消息到战报（包含所有隐藏信息）
        if (this.battleReportService && battleRecordId) {
          this.battleReportService.recordBattleMessage(roomId, message)
        } else if (this.battleReportService && !battleRecordId) {
          logger.debug({ roomId, messageType: message.type }, 'Skipping message recording - no battle record')
        }

        // 处理战斗结束
        if (message.type === BattleMessageType.BattleEnd) {
          this.cleanupRoom(roomId)
        }
      },
      { showAll: true },
    ) // 显示所有信息用于战报记录

    // 分别监听每个玩家的消息用于发送给客户端（各自视角）
    ;[player1, player2].forEach(p => {
      p.playerData.registerListener((message: BattleMessage) => {
        // 向该玩家发送他们视角的战斗事件
        switch (message.type) {
          case BattleMessageType.BattleEnd:
            p.socket.emit('battleEvent', message)
            break
          default:
            p.socket.emit('battleEvent', message)
            break
        }
      }) // 使用默认选项，显示该玩家自己可见的信息
    })

    // 监听计时器事件并转发给客户端
    this.setupTimerEventListeners(battle, [player1, player2])

    this.rooms.set(roomId, {
      id: roomId,
      battle,
      players: new Map([
        [p1.id, player1],
        [p2.id, player2],
      ]),
      playersReady: new WeakMap([player1, player2].map(p => [p, false])),
      status: 'waiting',
      lastActive: Date.now(),
      battleRecordId,
    })

    return roomId
  }

  private initializePlayer(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ): GamePlayer {
    if (!socket.data.data) {
      throw new Error('Player data not loaded')
    }
    return {
      socket,
      playerData: socket.data.data,
      lastPing: Date.now(),
      online: true,
    }
  }

  private async cleanupRoom(roomId: string) {
    const room = this.rooms.get(roomId)
    if (!room) {
      logger.warn({ roomId }, '尝试清理不存在的房间')
      return
    }

    // 强制完成战报（如果战斗未正常结束）
    if (this.battleReportService && room.battle.status !== BattleStatus.Ended) {
      await this.battleReportService.forceBattleComplete(roomId, 'disconnect')
    }

    // Clean up battle promise if it exists
    if (room.battlePromise) {
      try {
        // The battle will naturally end when the promise resolves/rejects
        await room.battle.cleanup()
      } catch (e) {
        logger.error(e, '清理战斗失败')
      }
    }

    room.battle.clearListeners()
    room.status = 'ended'

    logger.info(
      {
        roomId,
        playerCount: room.players.size,
        roomStatus: room.status,
      },
      '开始清理房间',
    )

    try {
      // 记录每个玩家的离开情况
      room.players.forEach((player, socketId) => {
        try {
          if (!player.socket) return
          player.socket.leave(roomId)
          player.socket.data.roomId = undefined
          logger.debug(
            {
              socketId,
              playerId: player.playerData.id,
              roomId,
            },
            '玩家已移出房间',
          )
        } catch (error) {
          logger.error(
            {
              socketId,
              error: error instanceof Error ? error.stack : error,
            },
            '移除玩家时发生异常',
          )
        }
      })

      // 删除房间记录
      this.rooms.delete(roomId)
      logger.info({ roomId }, '房间数据已从内存移除')

      // 广播房间关闭事件
      this.io.to(roomId).emit('roomClosed', {
        roomId,
      })
      logger.info({ roomId }, '已广播房间关闭通知')
    } catch (error) {
      logger.error(
        {
          roomId,
          error: error instanceof Error ? error.stack : error,
        },
        '清理房间过程中发生未预期错误',
      )
    } finally {
      // 最终确认状态
      logger.debug(
        {
          roomExists: this.rooms.has(roomId),
          activeRooms: this.rooms.size,
        },
        '房间清理最终状态',
      )
    }
  }

  private setupHeartbeatSystem() {
    const timer = setInterval(() => {
      const now = Date.now()
      this.players.forEach((player, socketId) => {
        if (now - player.lastPing > this.HEARTBEAT_INTERVAL * 2) {
          logger.warn({ socketId }, '心跳丢失，断开连接')
          player.socket.disconnect(true)
          this.removePlayer(socketId)
        }
      })
    }, this.HEARTBEAT_INTERVAL)

    this.io.engine.on('close', () => clearInterval(timer))
  }

  // 玩家连接时注册
  private registerPlayer(socket: Socket) {
    this.players.set(socket.id, {
      socket,
      lastPing: Date.now(),
      // 初始化定时器
      heartbeatTimer: setInterval(() => {
        socket.emit('ping')
      }, this.HEARTBEAT_INTERVAL),
    })
  }

  // 清理玩家数据
  private removePlayer(socketId: string) {
    const player = this.players.get(socketId)
    if (player) {
      clearInterval(player.heartbeatTimer)
      this.players.delete(socketId)
      this.matchQueue.delete(socketId)
      logger.debug({ socketId }, '玩家已从池中移除')
    }
  }

  private getPlayerRoom(socketId: string, byPlayerId?: string) {
    return Array.from(this.rooms.values()).find(room =>
      byPlayerId
        ? Array.from(room.players.values()).some(p => p.playerData.id === byPlayerId)
        : room.players.has(socketId),
    )
  }

  private getPlayerBySocket(socketId: string): GamePlayer {
    const player = this.getPlayerRoom(socketId)?.players.get(socketId)
    if (!player) {
      throw new Error('Player not in game')
    }
    return player
  }

  private checkBattleProgress(room: BattleRoom) {
    // In the new phase-based system, battle progression is automatic
    // We just need to update the last active time
    room.lastActive = Date.now()

    // Check if battle has ended
    if (room.battle.status === BattleStatus.Ended) {
      room.status = 'ended'
      this.cleanupRoom(room.id)
    } else if (room.status === 'waiting') {
      room.status = 'active'
    }
  }

  private handleDisconnect(socketId: string, heartbeat: ReturnType<typeof setInterval>) {
    clearInterval(heartbeat)
    this.matchQueue.delete(socketId)
    const room = this.getPlayerRoom(socketId)
    if (room) this.cleanupRoom(room.id)
  }

  private finalizeMatchmaking(
    roomId: string,
    p1: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    p2: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ) {
    p1.data.roomId = roomId
    p2.data.roomId = roomId
    this.matchQueue.delete(p1.id)
    this.matchQueue.delete(p2.id)
    const p1Data = {
      status: 'SUCCESS' as const,
      data: {
        roomId,
        opponent: {
          id: p2.id,
          name: p2.data.data?.name || 'Unknown',
        },
      },
    }

    const p2Data = {
      status: 'SUCCESS' as const,
      data: {
        roomId,
        opponent: {
          id: p1.id,
          name: p1.data.data?.name || 'Unknown',
        },
      },
    }

    p1.emit('matchSuccess', p1Data)
    p2.emit('matchSuccess', p2Data)
    // this.rooms.get(roomId)?.battleGenerator.next()
    logger.info(`Matched: room:${roomId} ${p1.id} vs ${p2.id}`)
  }

  private handleReportAnimationEnd(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    data: { animationId: string; actualDuration: number },
  ): void {
    try {
      const room = this.getPlayerRoom(socket.id)
      if (!room) {
        logger.warn({ socketId: socket.id }, '玩家不在任何房间中，无法报告动画结束')
        return
      }

      // 更新房间活跃时间
      room.lastActive = Date.now()

      // 将动画结束报告传递给战斗系统的计时器管理器
      room.battle.timerManager.endAnimation(data.animationId, data.actualDuration)

      logger.debug(
        {
          socketId: socket.id,
          roomId: room.id,
          animationId: data.animationId,
          duration: data.actualDuration,
        },
        '收到动画结束报告',
      )
    } catch (error) {
      logger.error(
        {
          socketId: socket.id,
          error: error instanceof Error ? error.stack : error,
          data,
        },
        '处理动画结束报告时发生错误',
      )
    }
  }

  // 计时器相关处理方法
  private handleIsTimerEnabled(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack: AckResponse<boolean>,
  ): void {
    try {
      const room = this.getPlayerRoom(socket.id)
      if (!room) {
        ack({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '玩家不在任何房间中' })
        return
      }

      const isEnabled = room.battle.isTimerEnabled()
      ack({ status: 'SUCCESS', data: isEnabled })
    } catch (error) {
      logger.error({ socketId: socket.id, error }, '获取计时器状态时发生错误')
      ack({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '服务器内部错误' })
    }
  }

  private handleGetPlayerTimerState(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    data: { playerId: string },
    ack: AckResponse<PlayerTimerState | null>,
  ): void {
    try {
      const room = this.getPlayerRoom(socket.id)
      if (!room) {
        ack({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '玩家不在任何房间中' })
        return
      }

      const timerState = room.battle.getPlayerTimerState(data.playerId as any)
      ack({ status: 'SUCCESS', data: timerState })
    } catch (error) {
      logger.error({ socketId: socket.id, error }, '获取玩家计时器状态时发生错误')
      ack({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '服务器内部错误' })
    }
  }

  private handleGetAllPlayerTimerStates(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack: AckResponse<PlayerTimerState[]>,
  ): void {
    try {
      const room = this.getPlayerRoom(socket.id)
      if (!room) {
        ack({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '玩家不在任何房间中' })
        return
      }

      const timerStates = room.battle.getAllPlayerTimerStates()
      ack({ status: 'SUCCESS', data: timerStates })
    } catch (error) {
      logger.error({ socketId: socket.id, error }, '获取所有玩家计时器状态时发生错误')
      ack({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '服务器内部错误' })
    }
  }

  private handleGetTimerConfig(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack: AckResponse<TimerConfig>,
  ): void {
    try {
      const room = this.getPlayerRoom(socket.id)
      if (!room) {
        ack({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '玩家不在任何房间中' })
        return
      }

      const config = room.battle.getTimerConfig()
      ack({ status: 'SUCCESS', data: config })
    } catch (error) {
      logger.error({ socketId: socket.id, error }, '获取计时器配置时发生错误')
      ack({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '服务器内部错误' })
    }
  }

  private handleStartAnimation(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    data: { source: string; expectedDuration: number; ownerId: string },
    ack: AckResponse<string>,
  ): void {
    try {
      const room = this.getPlayerRoom(socket.id)
      if (!room) {
        ack({ status: 'ERROR', code: 'NOT_IN_ROOM', details: '玩家不在任何房间中' })
        return
      }

      // 验证提供的 ownerId 是否与调用者匹配
      const player = room.players.get(socket.id)
      const callerPlayerId = player?.playerData.id

      if (!callerPlayerId) {
        ack({ status: 'ERROR', code: 'INVALID_PLAYER', details: '无法获取玩家ID' })
        return
      }

      // 确保只能为自己开始动画
      if (data.ownerId !== callerPlayerId) {
        ack({ status: 'ERROR', code: 'INVALID_OWNER', details: '只能为自己开始动画' })
        return
      }

      const animationId = room.battle.startAnimation(data.source, data.expectedDuration, data.ownerId as playerId)
      ack({ status: 'SUCCESS', data: animationId })

      logger.debug(
        {
          socketId: socket.id,
          roomId: room.id,
          ownerId: data.ownerId,
          source: data.source,
          expectedDuration: data.expectedDuration,
          animationId,
        },
        '开始动画追踪',
      )
    } catch (error) {
      logger.error({ socketId: socket.id, error }, '开始动画追踪时发生错误')
      ack({ status: 'ERROR', code: 'INTERNAL_ERROR', details: '服务器内部错误' })
    }
  }

  private handleEndAnimation(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    data: { animationId: string; actualDuration?: number },
  ): void {
    try {
      const room = this.getPlayerRoom(socket.id)
      if (!room) {
        logger.warn({ socketId: socket.id }, '玩家不在任何房间中，无法结束动画')
        return
      }

      // 更新房间活跃时间
      room.lastActive = Date.now()

      // 结束动画追踪
      room.battle.endAnimation(data.animationId, data.actualDuration)

      logger.debug(
        {
          socketId: socket.id,
          roomId: room.id,
          animationId: data.animationId,
          actualDuration: data.actualDuration,
        },
        '处理动画结束请求',
      )
    } catch (error) {
      logger.error(
        {
          socketId: socket.id,
          error: error instanceof Error ? error.stack : error,
          data,
        },
        '结束动画追踪时发生错误',
      )
    }
  }

  /**
   * 设置计时器事件监听器
   */
  private setupTimerEventListeners(battle: Battle, players: GamePlayer[]): void {
    // 监听计时器开始事件
    battle.onTimerEvent('timerStart', data => {
      players.forEach(player => {
        player.socket.emit('timerEvent', { type: 'timerStart', data })
      })
    })

    // 监听计时器更新事件
    battle.onTimerEvent('timerUpdate', data => {
      players.forEach(player => {
        player.socket.emit('timerEvent', { type: 'timerUpdate', data })
      })
    })

    // 监听计时器暂停事件
    battle.onTimerEvent('timerPause', data => {
      players.forEach(player => {
        player.socket.emit('timerEvent', { type: 'timerPause', data })
      })
    })

    // 监听计时器恢复事件
    battle.onTimerEvent('timerResume', data => {
      players.forEach(player => {
        player.socket.emit('timerEvent', { type: 'timerResume', data })
      })
    })

    // 监听计时器超时事件
    battle.onTimerEvent('timerTimeout', data => {
      players.forEach(player => {
        player.socket.emit('timerEvent', { type: 'timerTimeout', data })
      })
    })

    // 监听动画开始事件
    battle.onTimerEvent('animationStart', data => {
      players.forEach(player => {
        player.socket.emit('timerEvent', { type: 'animationStart', data })
      })
    })

    // 监听动画结束事件
    battle.onTimerEvent('animationEnd', data => {
      players.forEach(player => {
        player.socket.emit('timerEvent', { type: 'animationEnd', data })
      })
    })
  }

  private handleReady(socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>): void {
    const roomId = socket.data.roomId
    if (!roomId) {
      logger.warn({ socketId: socket.id }, '玩家不在任何房间中，无法准备')
      return
    }

    const room = this.rooms.get(roomId)
    if (!room) {
      logger.warn({ socketId: socket.id, roomId }, '找不到房间，无法准备')
      return
    }

    const player = room.players.get(socket.id)
    if (!player) {
      logger.warn({ socketId: socket.id, roomId }, '找不到玩家，无法准备')
      return
    }

    room.playersReady.set(player, true)
    logger.info({ socketId: socket.id, roomId }, '玩家已准备')

    // 检查是否所有玩家都已准备
    let allPlayersReady = true
    for (const p of room.players.values()) {
      if (!room.playersReady.get(p)) {
        allPlayersReady = false
        break
      }
    }

    if (allPlayersReady) {
      logger.info({ roomId }, '所有玩家已准备，开始战斗')

      // Start the phase-based battle
      room.battlePromise = room.battle.startBattle().catch(error => {
        logger.error({ error, roomId }, '战斗执行错误')
        room.status = 'ended'
        this.cleanupRoom(roomId)
      })
    }
  }

  /**
   * 清理服务器资源（服务器关闭时调用）
   */
  async cleanup(): Promise<void> {
    logger.info('开始清理 BattleServer 资源')

    // 主动断开所有socket连接
    await this.disconnectAllSockets()

    // 清理所有活跃房间
    const roomIds = Array.from(this.rooms.keys())
    await Promise.all(roomIds.map(roomId => this.cleanupRoom(roomId)))

    // 清理战报服务
    if (this.battleReportService) {
      await this.battleReportService.cleanup()
    }

    logger.info('BattleServer 资源清理完成')
  }

  /**
   * 主动断开所有socket连接
   */
  private async disconnectAllSockets(): Promise<void> {
    const connectedSockets = await this.io.fetchSockets()
    const socketCount = connectedSockets.length

    if (socketCount === 0) {
      logger.info('没有活跃的socket连接需要断开')
      return
    }

    logger.info({ socketCount }, '开始主动断开所有socket连接')

    // 主动断开所有socket连接
    const disconnectPromises = connectedSockets.map(async socket => {
      try {
        // 清理该socket的心跳定时器
        const player = this.players.get(socket.id)
        if (player?.heartbeatTimer) {
          clearInterval(player.heartbeatTimer)
        }

        // 使用Socket.IO原生方法断开连接，true表示强制断开
        socket.disconnect(true)
        logger.debug({ socketId: socket.id }, 'Socket已断开')
      } catch (error) {
        logger.error(
          {
            socketId: socket.id,
            error: error instanceof Error ? error.message : error,
          },
          '断开socket时发生错误',
        )
      }
    })

    await Promise.all(disconnectPromises)

    // 清理玩家池
    this.players.clear()
    this.matchQueue.clear()

    logger.info({ disconnectedCount: socketCount }, '所有socket连接已断开')
  }

  /**
   * 获取服务器统计信息（包括战报统计）
   */
  getServerStats() {
    const baseStats = this.getCurrentState()
    const battleReportStats = this.battleReportService
      ? {
          activeBattleRecords: this.battleReportService.getActiveBattleCount(),
        }
      : {}

    return {
      ...baseStats,
      ...battleReportStats,
    }
  }
}
