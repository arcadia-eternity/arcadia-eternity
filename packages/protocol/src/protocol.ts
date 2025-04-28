// src/protocol.ts
// src/protocol.ts
import type { BattleMessage, BattleState } from '@arcadia-eternity/const'
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
  // 玩家动作
  submitPlayerSelection: (
    selection: PlayerSelectionSchemaType,
    callback: AckResponse<{ status: 'ACTION_ACCEPTED' }>,
  ) => void
  // 获取状态
  getState: (ack: AckResponse<BattleState>) => void
  // 获取可用选项
  getAvailableSelection: (ack: AckResponse<PlayerSelectionSchemaType[]>) => void
}
