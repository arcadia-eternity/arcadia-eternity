import { defineStore } from 'pinia'
import { Subject, ReplaySubject } from 'rxjs'
import {
  type BattleState,
  type BattleMessage,
  BattleMessageType,
  type petId,
  type playerId,
  type PlayerSelection,
} from '@test-battle/const'
import type { IBattleSystem } from '@test-battle/interface'
import * as jsondiffpatch from 'jsondiffpatch'

export const useBattleStore = defineStore('battle', {
  state: () => ({
    battleInterface: null as IBattleSystem | null,
    state: null as BattleState | null,
    log: [] as BattleMessage[],
    availableActions: [] as PlayerSelection[],
    errorMessage: null as string | null,
    isBattleEnd: false,
    victor: '' as string | null,
    playerId: '',
    // RxJS相关状态
    _messageSubject: new Subject<BattleMessage>(),
    animateQueue: new Subject<() => Promise<void>>(),
  }),

  actions: {
    async initBattle(battleInterface: IBattleSystem, playerId: string) {
      this.battleInterface = battleInterface
      this.playerId = playerId
      this.state = await this.battleInterface.getState(playerId as playerId)
      this.isBattleEnd = false
      this.victor = null
      this.errorMessage = null
      // 初始化RxJS流
      this.log = [] as BattleMessage[]
      this._messageSubject = new Subject<BattleMessage>()
      this.battleInterface.BattleEvent(msg => {
        this.handleBattleMessage(msg)
      })
      this.availableActions = await this.fetchAvailableSelection()
    },

    async sendplayerSelection(selection: PlayerSelection) {
      try {
        await this.battleInterface?.submitAction(selection)
        this.availableActions = []
      } catch (err) {
        this.errorMessage = (err as Error).message
      }
    },

    async applyStateDelta(msg: BattleMessage) {
      if (!this.state) this.state = {} as BattleState
      jsondiffpatch.patch(this.state, msg.stateDelta)
      this.log.push(msg)
      console.debug(msg.stateDelta)

      switch (msg.type) {
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

    async handleBattleMessage(msg: BattleMessage) {
      this._messageSubject.next(msg)
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
      // 清理RxJS资源
      this._messageSubject.complete()
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
