import { defineStore } from 'pinia'
import { DEFAULT_TIMER_CONFIG } from '@arcadia-eternity/const'
import { createBattleConfiguration } from '@/services/battleConfiguration'

/** Editable for the lifetime of this window. Each LocalBattleSession captures its own launch inputs. */
export const useLocalBattleSetupStore = defineStore('localBattleSetup', {
  state: () => ({
    selectedEnvironmentId: undefined as string | undefined,
    playerTeamId: '',
    opponentTeamId: '',
    battleConfig: createBattleConfiguration(),
    timerConfig: { ...DEFAULT_TIMER_CONFIG },
  }),
  actions: {
    reconcileTeams(available: readonly { id: string }[], currentId?: string) {
      const find = (id?: string) => available.find(team => team.id === id)
      const first = find(this.playerTeamId) ?? find(currentId) ?? available[0]
      const second = find(this.opponentTeamId) ?? available.find(team => team.id !== first?.id) ?? first
      this.playerTeamId = first?.id ?? ''
      this.opponentTeamId = second?.id ?? ''
    },
  },
})
