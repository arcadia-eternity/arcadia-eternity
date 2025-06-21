import type { playerId, petId, skillId } from './const'
import type { TimerSnapshot } from './timer'

export type Events = {
  // 计时器事件
  timerStart: {
    player: playerId[]
    turnTimeLimit: number | null
    remainingTotalTime: { [key: string]: number }
  }
  timerUpdate: {
    player: playerId
    remainingTurnTime: number
    remainingTotalTime: number
  }
  timerPause: {
    player: playerId[]
    reason: 'animation' | 'system'
  }
  timerResume: {
    player: playerId[]
  }
  timerTimeout: {
    player: playerId
    type: 'turn' | 'total'
    autoAction?: string
  }
  // 新增Timer快照事件 - 用于高效的状态同步
  timerSnapshot: {
    snapshots: TimerSnapshot[]
  }
  // Timer状态变化事件 - 用于关键状态变化通知
  timerStateChange: {
    playerId: playerId
    oldState: string
    newState: string
    timestamp: number
  }
  animationStart: {
    animationId: string
    duration: number
    source: petId | skillId
  }
  animationEnd: {
    animationId: string
    actualDuration: number
  }
}
