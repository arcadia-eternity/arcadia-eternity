import { DEFAULT_TIMER_CONFIG, type TimerConfig } from '@arcadia-eternity/const'

export interface RoomBattleOptionsValue {
  battleMode: 'server' | 'p2p'
  timerConfig: TimerConfig
  showHidden: boolean
}

export function createDefaultRoomBattleOptions(): RoomBattleOptionsValue {
  return {
    battleMode: 'server',
    timerConfig: { ...DEFAULT_TIMER_CONFIG },
    showHidden: false,
  }
}
