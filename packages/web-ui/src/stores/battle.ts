import { defineStore } from 'pinia'
import { battleClient } from '../utils/battleClient'
import type { BattleState, BattleMessage } from '@test-battle/const'

export const useBattleStore = defineStore('battle', {
  state: () => ({
    battleSessionId: null as string | null, // 新增会话ID
    state: null as BattleState | null,
    log: [] as BattleMessage[],
    availableActions: [] as any[],
  }),
  actions: {
    init() {
      battleClient.on('battleEvent', msg => {
        this.log.push(msg)
        if (msg.type === 'BATTLE_STATE') this.state = msg.data
      })
    },
    async joinMatchmaking(playerData: any) {
      await battleClient.joinMatchmaking(playerData)
    },
    resetBattle() {
      this.battleSessionId = null
      this.state = null
      this.log = []
      this.availableActions = []
    },
  },
})
