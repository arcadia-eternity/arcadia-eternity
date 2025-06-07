import type { playerId, petId, skillId } from './const'

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
