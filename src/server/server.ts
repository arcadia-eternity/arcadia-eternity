// server.ts
import { Server, Socket } from 'socket.io'
import { Battle } from '@core/battle'
import { PlayerParser } from '@/parser/player'
import { SelectionParser } from '@/parser/selection'
import { PetParser } from '@/parser/pet'
import { ZodError } from 'zod'
import { PlayerSelection } from '@/core/selection'
import { nanoid } from 'nanoid'
import { PlayerSelectionSchema } from '@/schema/selection'

// 类型定义
type BattleRoom = {
  id: string
  battle: Battle
  players: Map<string, GamePlayer>
  selections: Map<string, PlayerSelection> // 改用Map存储选择
  status: 'waiting' | 'active' | 'ended'
}

type GamePlayer = {
  socket: Socket
  playerData: ReturnType<typeof PlayerParser.parse>
  lastPing: number
}

// 全局状态
const rooms = new Map<string, BattleRoom>()
const matchQueue = new Set<string>()
const HEARTBEAT_INTERVAL = 5000

export function initBattleServer(io: Server) {
  // 心跳中间件
  io.use((socket, next) => {
    socket.on('ping', () => updatePlayerHeartbeat(socket.id))
    next()
  })

  io.on('connection', (socket: Socket) => {
    console.log(`玩家连接: ${socket.id}`)
    const heartbeat = setupHeartbeat(socket)

    // 加入匹配队列
    socket.on('joinMatchmaking', async (rawPlayerData, ack) => {
      try {
        const playerData = await validatePlayerData(rawPlayerData)
        initializePlayer(socket, playerData)

        matchQueue.add(socket.id)
        ack?.({ status: 'QUEUED' })
        attemptMatchmaking(io)
      } catch (error) {
        handleValidationError(error, socket, ack)
      }
    })

    // 处理玩家操作
    socket.on('playerAction', async (rawData, ack) => {
      try {
        const selection = await processPlayerAction(socket.id, rawData)
        const room = getPlayerRoom(socket.id)

        if (!room) throw new Error('NOT_IN_BATTLE')

        room.selections.set(socket.id, selection)
        checkBattleProgress(room, io)
        ack?.({ status: 'ACTION_ACCEPTED' })
      } catch (error) {
        handleActionError(error, socket, ack)
      }
    })

    socket.on('disconnect', () => {
      clearInterval(heartbeat)
      handleDisconnect(socket.id, io)
    })
  })
}

// 核心逻辑函数
async function validatePlayerData(rawData: unknown) {
  try {
    // 先验证基础结构
    const baseData = PlayerParser.parse(rawData)

    // 深度验证宠物数据
    baseData.team.forEach(pet => PetParser.parse(pet))

    return baseData
  } catch (error) {
    throw new Error(`数据验证失败: ${error instanceof ZodError ? error.errors : error}`)
  }
}

function initializePlayer(socket: Socket, playerData: unknown) {
  const parsedPlayer = PlayerParser.parse(playerData)
  return {
    socket,
    playerData: parsedPlayer,
    lastPing: Date.now(),
  }
}

async function processPlayerAction(socketId: string, rawData: unknown) {
  try {
    // 双重验证
    const schemaValidated = PlayerSelectionSchema.parse(rawData)
    return SelectionParser.parse(schemaValidated)
  } catch (error) {
    console.error(`玩家操作解析失败 [${socketId}]:`, error)
    throw new Error('INVALID_ACTION')
  }
}

// 匹配逻辑优化
function attemptMatchmaking(io: Server) {
  const MAX_RETRIES = 3
  let retryCount = 0

  const tryMatch = () => {
    if (matchQueue.size < 2 || retryCount >= MAX_RETRIES) return

    const candidates = Array.from(matchQueue)
    const [p1Id, p2Id] = candidates.slice(0, 2)

    const p1 = io.sockets.sockets.get(p1Id)
    const p2 = io.sockets.sockets.get(p2Id)

    if (!p1 || !p2) {
      matchQueue.delete(p1Id)
      matchQueue.delete(p2Id)
      retryCount++
      setTimeout(tryMatch, 1000)
      return
    }

    try {
      const roomId = createBattleRoom(p1, p2)
      finalizeMatchmaking(roomId, p1, p2)
    } catch (error) {
      handleMatchmakingError(error, p1, p2)
    }
  }

  tryMatch()
}

function createBattleRoom(p1: Socket, p2: Socket): string {
  const roomId = `battle_${nanoid(12)}`
  const player1 = initializePlayer(p1, p1.data.playerData)
  const player2 = initializePlayer(p2, p2.data.playerData)

  rooms.set(roomId, {
    id: roomId,
    battle: new Battle(player1.playerData, player2.playerData),
    players: new Map([
      [p1.id, player1],
      [p2.id, player2],
    ]),
    selections: new Map(),
    status: 'waiting',
  })

  return roomId
}

// 错误处理增强
function handleValidationError(
  error: unknown,
  socket: Socket,
  ack?: (response: { error: string; details?: string }) => void,
) {
  const message =
    error instanceof ZodError
      ? error.errors.map(e => `${e.path}: ${e.message}`).join(', ')
      : error instanceof Error
        ? error.message
        : '未知错误'

  console.error(`数据验证失败 [${socket.id}]: ${message}`)
  socket.emit('validationError', { code: 'INVALID_DATA', details: message })
  ack?.({ error: 'INVALID_DATA', details: message })
}

function handleActionError(
  error: unknown,
  socket: Socket,
  ack?: (response: { error: string; details?: string }) => void,
) {
  const errorCode = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
  socket.emit('actionError', { code: errorCode })
  ack?.({ error: errorCode })
}

// 工具函数优化
function setupHeartbeat(socket: Socket) {
  return setInterval(() => {
    const player = getPlayerBySocket(socket.id)
    if (player && Date.now() - player.lastPing > HEARTBEAT_INTERVAL * 2) {
      console.log(`[${socket.id}] 心跳丢失，强制断开`)
      socket.disconnect(true)
    }
  }, HEARTBEAT_INTERVAL)
}

function updatePlayerHeartbeat(socketId: string) {
  const player = getPlayerBySocket(socketId)
  if (player) player.lastPing = Date.now()
}

function getPlayerRoom(socketId: string): BattleRoom | undefined {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room
  }
}

function checkBattleProgress(room: BattleRoom, io: Server) {
  if (room.selections.size === 2) {
    io.to(room.id).emit('battleReadyCheck', { ready: true })
    return true
  }
  return false
}

function handleDisconnect(socketId: string, io: Server) {
  matchQueue.delete(socketId)
  const room = getPlayerRoom(socketId)
  if (room) cleanupRoom(room.id, io)
}

function finalizeMatchmaking(roomId: string, p1: Socket, p2: Socket) {
  p1.data.roomId = roomId
  p2.data.roomId = roomId
  console.log(`匹配成功: ${p1.id} vs ${p2.id}`)
}

function handleMatchmakingError(error: unknown, p1?: Socket, p2?: Socket) {
  console.error(`匹配失败: ${error}`)
  p1?.emit('matchmakingError', 'MATCH_FAILED')
  p2?.emit('matchmakingError', 'MATCH_FAILED')
}

function getPlayerBySocket(socketId: string): GamePlayer | undefined {
  for (const room of rooms.values()) {
    const player = room.players.get(socketId)
    if (player) return player
  }
}

export function cleanupRoom(roomId: string, io: Server) {
  const room = rooms.get(roomId)
  if (!room) return

  // 1. 清理所有玩家
  room.players.forEach(player => {
    player.socket.leave(roomId)
    player.socket.data.roomId = undefined
  })

  // 2. 删除房间记录
  rooms.delete(roomId)

  // 3. 发送清理完成事件
  io.to(roomId).emit('roomClosed', { roomId })

  console.log(`[Room ${roomId}] Cleanup completed`)
}
