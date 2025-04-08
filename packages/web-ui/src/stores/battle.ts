import { defineStore } from 'pinia'
import {
  type BattleState,
  type BattleMessage,
  BattleMessageType,
  type petId,
  type playerId,
  type PlayerSelection,
} from '@test-battle/const'
import type { IBattleSystem } from '@test-battle/interface'
import { number } from 'zod'

export const useBattleStore = defineStore('battle', {
  state: () => ({
    battleInterface: null as IBattleSystem | null,
    state: null as BattleState | null,
    log: [] as BattleMessage[],
    renderIndex: -1 as number,
    availableActions: [] as PlayerSelection[],
    errorMessage: null as string | null,
    isBattleEnd: false,
    victor: '' as string | null,
    playerId: '',
  }),

  actions: {
    async initBattle(battleInterface: IBattleSystem, playerId: string) {
      this.battleInterface = battleInterface
      this.playerId = playerId
      this.state = await this.battleInterface.getState(playerId as playerId)
      this.isBattleEnd = false
      this.victor = null
      this.errorMessage = null
      this.battleInterface.BattleEvent(this.handleBattleMessage)
      this.availableActions = await this.fetchAvailableSelection()
      this.log = [] as BattleMessage[]
    },

    async sendplayerSelection(selection: PlayerSelection) {
      try {
        await this.battleInterface?.submitAction(selection)
        this.availableActions = []
      } catch (err) {
        this.errorMessage = (err as Error).message
      }
    },

    // 新增战斗事件处理器
    async handleBattleMessage(msg: BattleMessage) {
      this.log.push(msg)

      switch (msg.type) {
        case BattleMessageType.BattleState:
          this.state = msg.data
          break

        case BattleMessageType.TurnAction:
          if (msg.data.player.includes(this.playerId as playerId)) {
            this.availableActions = await this.fetchAvailableSelection()
          }
          break

        case BattleMessageType.ForcedSwitch:
          if (msg.data.player.includes(this.playerId as playerId)) {
            this.availableActions = await this.fetchAvailableSelection()
          }
        case BattleMessageType.FaintSwitch:
          if (msg.data.player === (this.playerId as playerId)) {
            this.availableActions = await this.fetchAvailableSelection()
          }
          break

        case BattleMessageType.BattleEnd:
          this.isBattleEnd = true
          this.victor = msg.data.winner
          break
      }
    },

    resetBattle() {
      if (!this.isBattleEnd) {
        this.sendplayerSelection({
          player: this.playerId as playerId,
          type: 'surrender',
        })
      }
      this.battleInterface = null
      this.playerId = ''
      this.isBattleEnd = false
      this.victor = null
      this.errorMessage = null
      this.state = null
      this.log = []
      this.availableActions = []
    },

    getPetById(petId: petId) {
      return this.state?.players
        .map(p => p.team)
        .flat()
        .find(p => p?.id === petId)
    },

    getPlayerById(playerId: playerId) {
      return this.state?.players.find(p => p.id === playerId)
    },

    getSkillInfo(skillId: string) {
      return this.state?.players
        .flatMap(p => p.team)
        .flatMap(p => p?.skills)
        .find(s => s?.id === skillId)
    },

    async fetchAvailableSelection() {
      const res = await this.battleInterface?.getAvailableSelection(this.playerId as playerId)
      return res as PlayerSelection[]
    },
  },

  getters: {
    currentPlayer: state => state.state?.players.find(p => p.id === state.playerId),
    opponent: state => state.state?.players.find(p => p.id !== state.playerId),
    petMap: state => {
      const pets = state.state?.players
        .map(p => p.team ?? [])
        .flat()
        .filter(p => !p.isUnknown)
        .map(p => [p.id, p] as [petId, typeof p])
      return new Map(pets)
    },
    skillMap: state => {
      const skills = state.state?.players
        .map(p => p.team ?? [])
        .flat()
        .filter((p): p is NonNullable<typeof p> => !!p && !p.isUnknown)
        .flatMap(p => p.skills ?? [])
        .filter((s): s is NonNullable<typeof s> => !!s && !s.isUnknown)
        .map(s => [s.id, s] as [string, typeof s])
      return new Map(skills ?? [])
    },
    playerMap: state => {
      const players = state.state?.players.map(p => [p.id, p] as [playerId, typeof p])
      return new Map(players ?? [])
    },
    markMap: state => {
      const marks = [
        ...(state.state?.players
          .map(p => p.team ?? [])
          .flat()
          .filter(p => !p.isUnknown)
          .map(p => p.marks ?? [])
          .flat()
          .map(m => [m.id, m] as [string, typeof m]) || []),
        ...(state.state?.marks.map(m => [m.id, m] as [string, typeof m]) ?? []),
      ]
      return new Map(marks)
    },
  },
})
