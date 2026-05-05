import type { TimerConfig } from '@arcadia-eternity/const'

export type BattleWorkbenchTeamSelectionConfig = {
  enabled: boolean
  mode: 'VIEW_ONLY' | 'TEAM_SELECTION' | 'FULL_TEAM'
  maxTeamSize: number
  minTeamSize: number
  allowStarterSelection: boolean
  showOpponentTeam: boolean
  teamInfoVisibility: 'HIDDEN' | 'BASIC' | 'FULL'
  timeLimit: number
}

export type BattleWorkbenchBattleConfig = {
  allowFaintSwitch: boolean
  showHidden: boolean
  rngSeed?: number
  teamSelection: BattleWorkbenchTeamSelectionConfig
}

export type BattleWorkbenchResourceRef = {
  id: string
  packFolder: string
  relativePath: string
  label: string
  kind: string
  dataKind?: string
  sourceFile?: string
}

export type BattleWorkbenchLaunchPayload = {
  version: 1
  source: 'pack-workbench'
  createdAt: number
  selectedPlayer1TeamIndex: number
  selectedPlayer2TeamIndex: number
  battleConfig: BattleWorkbenchBattleConfig
  timerConfig: TimerConfig
  resources: BattleWorkbenchResourceRef[]
}

const KEY_PREFIX = 'arcadia:battle-workbench:launch:'

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

export function createBattleWorkbenchLaunch(
  payload: Omit<BattleWorkbenchLaunchPayload, 'version' | 'source' | 'createdAt'>,
): string {
  if (!hasSessionStorage()) {
    throw new Error('当前环境不支持 sessionStorage')
  }

  const launchPayload: BattleWorkbenchLaunchPayload = {
    version: 1,
    source: 'pack-workbench',
    createdAt: Date.now(),
    ...payload,
  }

  const key = `${KEY_PREFIX}${launchPayload.createdAt}:${Math.random().toString(36).slice(2, 10)}`
  window.sessionStorage.setItem(key, JSON.stringify(launchPayload))
  return key
}

export function readBattleWorkbenchLaunch(launchKey: string): BattleWorkbenchLaunchPayload | null {
  if (!hasSessionStorage()) return null
  if (!launchKey.startsWith(KEY_PREFIX)) return null

  const raw = window.sessionStorage.getItem(launchKey)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as BattleWorkbenchLaunchPayload
    if (parsed?.version !== 1 || parsed?.source !== 'pack-workbench') return null
    if (!Number.isFinite(parsed.selectedPlayer1TeamIndex) || !Number.isFinite(parsed.selectedPlayer2TeamIndex)) {
      return null
    }
    if (!parsed.battleConfig || !parsed.timerConfig) return null
    if (!Array.isArray(parsed.resources)) return null
    return parsed
  } catch {
    return null
  }
}
