import { BattleMessageType, BattleState } from '@/core/message'
import { PlayerParser } from '@/parser/player'
import { SelectionParser } from '@/parser/selection'
import { AckResponse, ClientToServerEvents, ErrorResponse, ServerToClientEvents } from '@/protocol'
import { PlayerSelection, PlayerSelectionSchema } from '@/schema'
import { Battle } from '@core/battle'
import { nanoid } from 'nanoid'
import pino from 'pino'
import { Server, Socket } from 'socket.io'
import { ZodError } from 'zod'

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
  battleGenerator: Generator<void, void, void>
  players: Map<string, GamePlayer>
  status: 'waiting' | 'active' | 'ended'
}

type GamePlayer = {
  socket: Socket<ClientToServerEvents, ServerToClientEvents>
  playerData: ReturnType<typeof PlayerParser.parse>
  lastPing: number
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
}

export class BattleServer {
  private readonly rooms = new Map<string, BattleRoom>()
  private readonly matchQueue = new Set<string>()
  private readonly HEARTBEAT_INTERVAL = 5000
  private readonly players = new Map<string, PlayerMeta>() // 新增玩家池

  constructor(private readonly io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    this.initializeMiddleware()
    this.setupConnectionHandlers()
    this.setupHeartbeatSystem()
  }

  private initializeMiddleware() {
    this.io.use((socket, next) => {
      next()
    })
  }

  private setupConnectionHandlers() {
    this.io.on('connection', socket => {
      logger.info({ socketId: socket.id }, '玩家连接')
      this.registerPlayer(socket) // 注册到玩家池

      socket.on('pong', () => {
        const player = this.players.get(socket.id)
        if (player) player.lastPing = Date.now()
      })

      socket.on('disconnect', () => {
        logger.info({ socketId: socket.id }, '玩家断开连接')
        this.removePlayer(socket.id)
      })

      this.setupSocketHandlers(socket)
    })
  }

  private setupSocketHandlers(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ) {
    socket.on('joinMatchmaking', (data, ack) => this.handleJoinMatchmaking(socket, data, ack))
    socket.on('playerAction', (data, ack) => this.handlePlayerAction(socket, data, ack))
    socket.on('getState', ack => this.handleGetState(socket, ack))
    socket.on('getAvailableSelection', ack => this.handleGetSelection(socket, ack))
  }

  private handleJoinMatchmaking(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    rawPlayerData: unknown,
    ack?: AckResponse<{ status: 'QUEUED' }>,
  ) {
    try {
      const playerData = this.validatePlayerData(rawPlayerData)
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

  private handlePlayerAction(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    rawData: unknown,
    ack?: AckResponse<{ status: 'ACTION_ACCEPTED' }>,
  ) {
    try {
      const selection = this.processPlayerAction(socket.id, rawData)
      const room = this.getPlayerRoom(socket.id)

      if (!room) throw new Error('NOT_IN_BATTLE')
      if (!room.players.get(socket.id)?.playerData.setSelection(selection)) {
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
      const player = this.getPlayerBySocket(socket.id)
      ack?.({
        status: 'SUCCESS',
        data: player.playerData.getState(),
      })
    } catch (error) {
      this.handleGetStateError(error, socket, ack)
    }
  }

  private handleGetSelection(
    socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    ack?: AckResponse<PlayerSelection[]>,
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
    ack?: AckResponse<PlayerSelection[]>,
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
    try {
      const baseData = PlayerParser.parse(rawData)
      return baseData
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(
          `玩家数据验证失败:\n${error.errors.map(e => `[字段 ${e.path.join('.')}] ${e.message}`).join('\n')}`,
        )
      }
      throw error
    }
  }

  private processPlayerAction(socketId: string, rawData: unknown) {
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

    const tryMatch = () => {
      if (this.matchQueue.size < 2 || retryCount >= maxRetries) return

      const [p1Id, p2Id] = Array.from(this.matchQueue).slice(0, 2)
      const p1 = this.io.sockets.sockets.get(p1Id)
      const p2 = this.io.sockets.sockets.get(p2Id)

      if (!p1 || !p2) {
        this.matchQueue.delete(p1Id)
        this.matchQueue.delete(p2Id)
        retryCount++
        setTimeout(tryMatch, 1000)
        return
      }

      try {
        const roomId = this.createBattleRoom(p1, p2)
        this.finalizeMatchmaking(roomId, p1, p2)
      } catch (error) {
        this.handleMatchmakingError(error, p1, p2)
      }
    }

    tryMatch()
  }

  private createBattleRoom(
    p1: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    p2: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  ) {
    const roomId = `battle_${nanoid(12)}`
    p1.join(roomId)
    p2.join(roomId)

    const player1 = this.initializePlayer(p1)
    const player2 = this.initializePlayer(p2)
    const battle = new Battle(player1.playerData, player2.playerData)

    battle.registerListener(message => {
      this.io.to(roomId).emit('battleEvent', message)
      if (message.type === BattleMessageType.BattleEnd) {
        this.cleanupRoom(roomId)
      }
    })

    this.rooms.set(roomId, {
      id: roomId,
      battle,
      battleGenerator: battle.startBattle(),
      players: new Map([
        [p1.id, player1],
        [p2.id, player2],
      ]),
      status: 'waiting',
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
    }
  }

  private cleanupRoom(roomId: string) {
    const room = this.rooms.get(roomId)
    if (!room) return

    room.players.forEach(player => {
      player.socket.leave(roomId)
      player.socket.data.roomId = undefined
    })

    this.rooms.delete(roomId)
    this.io.to(roomId).emit('roomClosed', { roomId })
  }

  private setupHeartbeatSystem() {
    // 全局心跳检测定时器
    setInterval(() => {
      const now = Date.now()
      this.players.forEach((player, socketId) => {
        if (now - player.lastPing > this.HEARTBEAT_INTERVAL * 2) {
          logger.warn({ socketId }, '心跳丢失，断开连接')
          player.socket.disconnect(true)
          this.removePlayer(socketId)
        }
      })
    }, this.HEARTBEAT_INTERVAL)
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

  private getPlayerRoom(socketId: string) {
    return Array.from(this.rooms.values()).find(room => room.players.has(socketId))
  }

  private getPlayerBySocket(socketId: string): GamePlayer {
    const player = this.getPlayerRoom(socketId)?.players.get(socketId)
    if (!player) {
      throw new Error('Player not in game')
    }
    return player
  }

  private checkBattleProgress(room: BattleRoom) {
    try {
      const result = room.battleGenerator.next()
      if (result.done) this.cleanupRoom(room.id)
    } catch (error) {
      logger.error({ error, roomId: room.id }, 'Battle progression error')
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
    this.rooms.get(roomId)?.battleGenerator.next()
    logger.info(`Matched: room:${roomId} ${p1.id} vs ${p2.id}`)
  }
}
