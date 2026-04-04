import { defineStore } from 'pinia'
import { DEFAULT_TIMER_CONFIG, type TimerConfig } from '@arcadia-eternity/const'
import type { PackWorkbenchFileEntry } from '@/components/pack-editor/workbenchEditorRegistry'
import {
  createBattleWorkbenchLaunch,
  type BattleWorkbenchBattleConfig,
  type BattleWorkbenchResourceRef,
} from '@/utils/battleWorkbenchLaunch'

function createDefaultBattleConfig(): BattleWorkbenchBattleConfig {
  return {
    allowFaintSwitch: true,
    showHidden: true,
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

function cloneTimerConfig(config?: TimerConfig): TimerConfig {
  return {
    ...DEFAULT_TIMER_CONFIG,
    ...(config ?? {}),
  }
}

export const useBattleWorkbenchStore = defineStore('battleWorkbench', {
  state: () => ({
    selectedPlayer1TeamIndex: null as number | null,
    selectedPlayer2TeamIndex: null as number | null,
    battleConfig: createDefaultBattleConfig(),
    timerConfig: cloneTimerConfig(),
    resources: [] as BattleWorkbenchResourceRef[],
  }),

  getters: {
    resourceCount: state => state.resources.length,
  },

  actions: {
    ensureDefaultTeams(player1TeamIndex: number, player2TeamIndex: number) {
      if (!Number.isFinite(this.selectedPlayer1TeamIndex)) {
        this.selectedPlayer1TeamIndex = player1TeamIndex
      }
      if (!Number.isFinite(this.selectedPlayer2TeamIndex)) {
        this.selectedPlayer2TeamIndex = player2TeamIndex
      }
    },

    addResource(packFolder: string, entry: PackWorkbenchFileEntry): boolean {
      const id = `${packFolder}:${entry.relativePath}`
      if (this.resources.some(resource => resource.id === id)) {
        return false
      }

      this.resources.push({
        id,
        packFolder,
        relativePath: entry.relativePath,
        label: entry.label,
        kind: entry.kind,
        dataKind: entry.dataKind,
        sourceFile: entry.sourceFile,
      })
      return true
    },

    removeResource(resourceId: string) {
      this.resources = this.resources.filter(resource => resource.id !== resourceId)
    },

    clearResources() {
      this.resources = []
    },

    createLaunchKey(): string {
      const player1 = Number.isFinite(this.selectedPlayer1TeamIndex) ? (this.selectedPlayer1TeamIndex as number) : 0
      const player2 = Number.isFinite(this.selectedPlayer2TeamIndex) ? (this.selectedPlayer2TeamIndex as number) : 0

      return createBattleWorkbenchLaunch({
        selectedPlayer1TeamIndex: player1,
        selectedPlayer2TeamIndex: player2,
        battleConfig: {
          ...this.battleConfig,
          rngSeed: Number.isFinite(this.battleConfig.rngSeed)
            ? (this.battleConfig.rngSeed as number)
            : undefined,
          teamSelection: {
            ...this.battleConfig.teamSelection,
          },
        },
        timerConfig: cloneTimerConfig(this.timerConfig),
        resources: this.resources.map(resource => ({ ...resource })),
      })
    },
  },
})
