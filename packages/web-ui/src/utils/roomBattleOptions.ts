import { DEFAULT_TIMER_CONFIG, type TimerConfig } from '@arcadia-eternity/const'

export interface RoomBattleOptionsValue {
  battleMode: 'server' | 'p2p'
  timerConfig: TimerConfig
  allowFaintSwitch: boolean
  showHidden: boolean
}

export function createDefaultRoomBattleOptions(): RoomBattleOptionsValue {
  return {
    battleMode: 'server',
    timerConfig: { ...DEFAULT_TIMER_CONFIG },
    allowFaintSwitch: true,
    showHidden: false,
  }
}
