import type { PetSchemaType } from '@arcadia-eternity/schema'

/**
 * 私人房间配置
 */
export interface PrivateRoomConfig {
  /** 房间码 - 6位字母数字组合 */
  roomCode: string
  /** 房主玩家ID */
  hostPlayerId: string
  /** 规则集ID */
  ruleSetId: string
  /** 最大玩家数量 */
  maxPlayers: number
  /** 最大观战者数量 */
  maxSpectators: number
  /** 是否允许观战 */
  allowSpectators: boolean
  /** 观战模式 */
  spectatorMode: 'free' | 'player1' | 'player2' | 'god'
  /** 是否为私密房间 */
  isPrivate: boolean
  /** 房间密码（私密房间时必填） */
  password?: string
}

/**
 * 房间内玩家信息
 */
export interface RoomPlayer {
  /** 玩家ID */
  playerId: string
  /** 玩家名称 */
  playerName: string
  /** Socket会话ID */
  sessionId: string
  /** 玩家队伍（准备时才有） */
  team?: PetSchemaType[]
  /** 是否已准备 */
  isReady: boolean
  /** 加入时间 */
  joinedAt: number
}

/**
 * 观战者信息
 */
export interface SpectatorEntry {
  /** 玩家ID */
  playerId: string
  /** 玩家名称 */
  playerName: string
  /** Socket会话ID */
  sessionId: string
  /** 加入时间 */
  joinedAt: number
  /** 偏好的观战视角 */
  preferredView?: 'player1' | 'player2' | 'god'
}

/**
 * 战斗结果
 */
export interface BattleResult {
  /** 胜利者玩家ID，null表示平局 */
  winner: string | null
  /** 战斗结束原因 */
  reason: string
  /** 战斗结束时间 */
  endedAt: number
  /** 战斗房间ID */
  battleRoomId: string
}

/**
 * 私人房间状态
 */
export type PrivateRoomStatus = 'waiting' | 'ready' | 'started' | 'finished' | 'ended'

/**
 * 私人房间完整信息
 */
export interface PrivateRoom {
  /** 房间唯一ID */
  id: string
  /** 房间配置 */
  config: PrivateRoomConfig
  /** 房间内玩家列表 */
  players: RoomPlayer[]
  /** 观战者列表 */
  spectators: SpectatorEntry[]
  /** 房间状态 */
  status: PrivateRoomStatus
  /** 创建时间 */
  createdAt: number
  /** 最后活跃时间 */
  lastActivity: number
  /** 战斗房间ID（战斗开始后） */
  battleRoomId?: string
  /** 上一局战斗结果 */
  lastBattleResult?: BattleResult
}

/**
 * 创建房间请求
 */
export interface CreateRoomRequest {
  /** 房间配置 */
  config: Partial<PrivateRoomConfig>
}

/**
 * 加入房间请求
 */
export interface JoinRoomRequest {
  /** 房间码 */
  roomCode: string
  /** 房间密码（如果是私密房间） */
  password?: string
}

/**
 * 观战加入请求
 */
export interface JoinSpectatorRequest {
  /** 房间码 */
  roomCode: string
  /** 偏好的观战视角 */
  preferredView?: 'player1' | 'player2' | 'god'
}

/**
 * 房间事件类型
 */
export type PrivateRoomEvent =
  | { type: 'playerJoined'; data: RoomPlayer }
  | { type: 'playerLeft'; data: { playerId: string } }
  | { type: 'playerReady'; data: { playerId: string; isReady: boolean } }
  | { type: 'spectatorJoined'; data: SpectatorEntry }
  | { type: 'spectatorLeft'; data: { playerId: string } }
  | { type: 'playerSwitchedToSpectator'; data: { playerId: string; preferredView: string } }
  | { type: 'spectatorSwitchedToPlayer'; data: { playerId: string } }
  | { type: 'roomUpdate'; data: PrivateRoom }
  | { type: 'battleStarted'; data: { battleRoomId: string } }
  | { type: 'battleFinished'; data: { battleResult: BattleResult } }
  | { type: 'roomReset'; data: { message: string } }
  | { type: 'roomClosed'; data: { reason: string } }
  | { type: 'ruleSetChanged'; data: { ruleSetId: string; changedBy: string } }
  | {
      type: 'roomConfigChanged'
      data: { oldConfig: PrivateRoomConfig; newConfig: PrivateRoomConfig; changedBy: string }
    }

/**
 * Socket事件响应类型
 */
export interface PrivateRoomResponse {
  status: 'SUCCESS' | 'ERROR'
  message?: string
  data?: any
}

/**
 * 房间错误类型
 */
export class PrivateRoomError extends Error {
  constructor(
    message: string,
    public code:
      | 'ROOM_NOT_FOUND'
      | 'ROOM_FULL'
      | 'INVALID_PASSWORD'
      | 'ALREADY_IN_ROOM'
      | 'NOT_HOST'
      | 'INVALID_STATE'
      | 'PLAYER_NOT_FOUND'
      | 'SPECTATOR_NOT_FOUND'
      | 'HOST_CANNOT_SPECTATE'
      | 'SPECTATOR_LIMIT_REACHED'
      | 'PLAYER_LIMIT_REACHED'
      | 'INVALID_TEAM'
      | 'INVALID_RULESET'
      | 'TEAM_VALIDATION_FAILED'
      | 'INVALID_CONFIG',
    public details?: any,
  ) {
    super(message)
    this.name = 'PrivateRoomError'
  }
}
