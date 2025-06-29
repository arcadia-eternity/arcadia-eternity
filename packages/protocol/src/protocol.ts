// src/protocol.ts
import type { BattleMessage, BattleState, TimerConfig, PlayerTimerState } from '@arcadia-eternity/const'
import type { PlayerSchemaType, PlayerSelectionSchemaType } from '@arcadia-eternity/schema'

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
}

export interface ClientToServerEvents {
  // 心跳
  pong: () => void

  // 获取服务器状态
  getServerState: (ack: AckResponse<ServerState>) => void

  // 加入匹配队列
  joinMatchmaking: (playerSchema: PlayerSchemaType, callback: AckResponse<{ status: 'QUEUED' }>) => void
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
}
