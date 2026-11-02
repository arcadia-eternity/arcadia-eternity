import type { TimerConfig } from '@arcadia-eternity/const'
import type { NativeWebBattleConfig } from './nativeBattleFactory'

export interface BattleConfiguration {
  allowFaintSwitch: boolean
  showHidden: boolean
  rngSeed?: number
  teamSelection: {
    enabled: boolean
    mode: 'VIEW_ONLY' | 'TEAM_SELECTION' | 'FULL_TEAM'
    maxTeamSize: number
    minTeamSize: number
    allowStarterSelection: boolean
    showOpponentTeam: boolean
    teamInfoVisibility: 'HIDDEN' | 'BASIC' | 'FULL'
    timeLimit: number
  }
}
export function createBattleConfiguration(): BattleConfiguration {
  return {
    allowFaintSwitch: true,
    showHidden: true,
    rngSeed: undefined,
    teamSelection: {
      enabled: false,
      mode: 'TEAM_SELECTION',
      maxTeamSize: 6,
      minTeamSize: 1,
      allowStarterSelection: true,
      showOpponentTeam: false,
      teamInfoVisibility: 'HIDDEN',
      timeLimit: 60,
    },
  }
}
/** Both player and author launchers pass the same options to their battle host. */
export function battleOptions(config: BattleConfiguration, timer: TimerConfig): NativeWebBattleConfig {
  const { enabled, ...selection } = config.teamSelection
  return JSON.parse(
    JSON.stringify({
      allowFaintSwitch: config.allowFaintSwitch,
      showHidden: config.showHidden,
      ...(typeof config.rngSeed === 'number' ? { rngSeed: config.rngSeed } : {}),
      timerConfig: timer,
      ai: { enabled: true, players: ['playerB'] },
      ...(enabled ? { teamSelection: { enabled: true, config: selection } } : {}),
    }),
  ) as NativeWebBattleConfig
}
