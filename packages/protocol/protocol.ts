// src/protocol.ts
// src/protocol.ts
import type { BattleMessage, BattleState } from '@test-battle/const'
import type { Player, PlayerSelection } from '@test-battle/schema'

// 统一响应类型
export type SuccessResponse<T = undefined> = {
  status: 'SUCCESS'
  data?: T
}

export type ErrorResponse = {
  status: 'ERROR'
  code: string
  details?: string
}

export type AckResponse<T = undefined> = (response: SuccessResponse<T> | ErrorResponse) => void

export interface ServerToClientEvents {
  ping: () => void
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
  // 加入匹配队列
  joinMatchmaking: (playerSchema: Player, callback: AckResponse<{ status: 'QUEUED' }>) => void
  // 玩家动作
  playerAction: (selection: PlayerSelection, callback: AckResponse<{ status: 'ACTION_ACCEPTED' }>) => void
  // 获取状态
  getState: (ack: AckResponse<BattleState>) => void
  // 获取可用选项
  getAvailableSelection: (ack: AckResponse<PlayerSelection[]>) => void
}
