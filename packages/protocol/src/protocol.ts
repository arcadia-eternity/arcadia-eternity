// src/protocol.ts
import type { BattleMessage, BattleState, TimerConfig, PlayerTimerState } from '@arcadia-eternity/const'
import type { PlayerSchemaType, PlayerSelectionSchemaType, PetSchemaType } from '@arcadia-eternity/schema'

// 重新导出常用类型
export type { PetSchemaType, PlayerSchemaType, PlayerSelectionSchemaType }

// 统一响应类型
export type SuccessResponse<T = undefined> = {
  status: 'SUCCESS'
  data: T
}

export type ErrorResponse = {
  status: 'ERROR'
  code: string
  details?: string
}

export type AckResponse<T = unknown> = (response: SuccessResponse<T> | ErrorResponse) => void

export type ServerState = {
  onlinePlayers: number
  matchmakingQueue: number
  rooms: number
  playersInRooms: number
}

export interface ServerToClientEvents {
  ping: () => void

  // 获取服务器状态
  updateState: (state: ServerState) => void
  // 战斗事件（保持原始格式）
  battleEvent: (message: BattleMessage) => void
  // 批量战斗事件（新增）
  battleEventBatch: (messages: BattleMessage[]) => void
  // 计时器事件
  timerEvent: (event: { type: string; data: any }) => void
  // 新架构：Timer快照事件
  timerSnapshot: (data: { snapshots: any[] }) => void
  // 新架构：Timer事件批处理
  timerEventBatch: (events: any[]) => void
  // 房间关闭通知
  roomClosed: (message: { roomId: string }) => void
  // 匹配成功事件
  matchSuccess: (
    response: SuccessResponse<{
      roomId: string
      opponent: { id: string; name: string }
    }>,
  ) => void
  // 错误通知事件
  matchmakingError: (error: ErrorResponse) => void
  // 对手掉线通知
  opponentDisconnected: (data: { disconnectedPlayerId: string; graceTimeRemaining: number }) => void
  // 对手重连通知
  opponentReconnected: (data: { reconnectedPlayerId: string }) => void
  // 战斗重连通知（用于页面刷新后自动跳转）
  battleReconnect: (data: {
    roomId: string
    shouldRedirect: boolean
    battleState: string
    fullBattleState?: BattleState // 可选的完整战斗状态，避免客户端额外调用 getState
  }) => void
  // 重连测试事件（用于验证消息发送是否正常）
  reconnectTest: (data: { message: string; timestamp: number }) => void

  // 私人房间事件
  privateRoomEvent: (event: PrivateRoomEvent) => void
}

export interface ClientToServerEvents {
  // 心跳
  pong: () => void

  // 获取服务器状态
  getServerState: (ack: AckResponse<ServerState>) => void

  // 加入匹配队列
  joinMatchmaking: (
    data:
      | PlayerSchemaType // 旧格式：直接传递玩家数据
      | {
          playerSchema: PlayerSchemaType
          ruleSetId?: string
        }, // 新格式：包含规则集信息
    callback: AckResponse<{ status: 'QUEUED' }>,
  ) => void
  //取消匹配
  cancelMatchmaking: (ack: AckResponse<{ status: 'CANCELED' }>) => void
  // 准备开始对战
  ready: (ack: AckResponse<{ status: 'READY' }>) => void

  // 玩家动作
  submitPlayerSelection: (
    selection: PlayerSelectionSchemaType,
    callback: AckResponse<{ status: 'ACTION_ACCEPTED' }>,
  ) => void
  // 获取状态
  getState: (ack: AckResponse<BattleState>) => void
  // 获取可用选项
  getAvailableSelection: (ack: AckResponse<PlayerSelectionSchemaType[]>) => void

  // 计时器相关事件
  reportAnimationEnd: (data: { animationId: string; actualDuration: number }) => void
  getTimerConfig: (ack: AckResponse<TimerConfig>) => void
  getPlayerTimerState: (data: { playerId: string }, ack: AckResponse<PlayerTimerState | null>) => void
  getAllPlayerTimerStates: (ack: AckResponse<PlayerTimerState[]>) => void
  isTimerEnabled: (ack: AckResponse<boolean>) => void
  startAnimation: (
    data: { source: string; expectedDuration: number; ownerId: string },
    ack: AckResponse<string>,
  ) => void
  endAnimation: (data: { animationId: string; actualDuration?: number }) => void

  // 私人房间相关事件
  createPrivateRoom: (data: CreatePrivateRoomRequest, ack: AckResponse<{ roomCode: string }>) => void
  joinPrivateRoom: (data: JoinPrivateRoomRequest, ack: AckResponse<{ status: 'JOINED' }>) => void
  joinPrivateRoomAsSpectator: (data: JoinPrivateRoomSpectatorRequest, ack: AckResponse<{ status: 'JOINED' }>) => void
  leavePrivateRoom: (ack: AckResponse<{ status: 'LEFT' }>) => void
  togglePrivateRoomReady: (ack: AckResponse<{ status: 'READY_TOGGLED' }>) => void
  startPrivateRoomBattle: (ack: AckResponse<{ battleRoomId: string }>) => void
  resetPrivateRoom: (ack: AckResponse<{ status: 'RESET' }>) => void
  switchToSpectator: (
    data: { preferredView?: 'player1' | 'player2' | 'god' },
    ack: AckResponse<{ status: 'SWITCHED' }>,
  ) => void
  switchToPlayer: (data: { team: PetSchemaType[] }, ack: AckResponse<{ status: 'SWITCHED' }>) => void
  getPrivateRoomInfo: (data: { roomCode: string }, ack: AckResponse<PrivateRoomInfo>) => void
}

// 私人房间相关类型定义
export interface CreatePrivateRoomRequest {
  team: PetSchemaType[]
  config: {
    ruleSetId?: string
    isPrivate?: boolean
    password?: string
    allowSpectators?: boolean
    maxSpectators?: number
    spectatorMode?: 'free' | 'player1' | 'player2' | 'god'
  }
}

export interface JoinPrivateRoomRequest {
  roomCode: string
  team: PetSchemaType[]
  password?: string
}

export interface JoinPrivateRoomSpectatorRequest {
  roomCode: string
  preferredView?: 'player1' | 'player2' | 'god'
}

export interface PrivateRoomPlayer {
  playerId: string
  playerName: string
  sessionId: string
  team: PetSchemaType[]
  isReady: boolean
  joinedAt: number
}

export interface PrivateRoomSpectator {
  playerId: string
  playerName: string
  sessionId: string
  joinedAt: number
  preferredView?: 'player1' | 'player2' | 'god'
}

export interface PrivateRoomInfo {
  id: string
  config: {
    roomCode: string
    hostPlayerId: string
    ruleSetId: string
    maxPlayers: number
    maxSpectators: number
    allowSpectators: boolean
    spectatorMode: 'free' | 'player1' | 'player2' | 'god'
    isPrivate: boolean
  }
  players: PrivateRoomPlayer[]
  spectators: PrivateRoomSpectator[]
  status: 'waiting' | 'ready' | 'started' | 'finished' | 'ended'
  createdAt: number
  lastActivity: number
  battleRoomId?: string
  lastBattleResult?: {
    winner: string | null
    reason: string
    endedAt: number
    battleRoomId: string
  }
}

export type PrivateRoomEvent =
  | { type: 'playerJoined'; data: PrivateRoomPlayer }
  | { type: 'playerLeft'; data: { playerId: string } }
  | { type: 'playerReady'; data: { playerId: string; isReady: boolean } }
  | { type: 'spectatorJoined'; data: PrivateRoomSpectator }
  | { type: 'spectatorLeft'; data: { playerId: string } }
  | { type: 'playerSwitchedToSpectator'; data: { playerId: string; preferredView: string } }
  | { type: 'spectatorSwitchedToPlayer'; data: { playerId: string } }
  | { type: 'roomUpdate'; data: PrivateRoomInfo }
  | { type: 'battleStarted'; data: { battleRoomId: string } }
  | {
      type: 'battleFinished'
      data: { battleResult: { winner: string | null; reason: string; endedAt: number; battleRoomId: string } }
    }
  | { type: 'roomReset'; data: { message: string } }
  | { type: 'roomClosed'; data: { reason: string } }
