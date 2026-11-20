import { resolveTeamSelectionConfig, type TeamSelectionConfig, type TimerConfig } from '@arcadia-eternity/const'
import type { NativeWebBattleConfig } from './nativeBattleFactory'

export interface BattleConfiguration {
  showHidden: boolean
  rngSeed?: number
  teamSelection: Required<TeamSelectionConfig> & { enabled: boolean }
}
export function createBattleConfiguration(): BattleConfiguration {
  return {
    showHidden: true,
    rngSeed: undefined,
    teamSelection: {
      enabled: false,
      ...resolveTeamSelectionConfig(),
    },
  }
}
/** Both player and author launchers pass the same options to their battle host. */
export function battleOptions(config: BattleConfiguration, timer: TimerConfig): NativeWebBattleConfig {
  const { enabled, ...selection } = config.teamSelection
  return JSON.parse(
    JSON.stringify({
      showHidden: config.showHidden,
      ...(typeof config.rngSeed === 'number' ? { rngSeed: config.rngSeed } : {}),
      timerConfig: timer,
      ai: { enabled: true, players: ['playerB'] },
      ...(enabled ? { teamSelection: { enabled: true, config: selection } } : {}),
    }),
  ) as NativeWebBattleConfig
}
