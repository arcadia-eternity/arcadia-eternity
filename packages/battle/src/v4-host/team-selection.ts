import {
  BattleMessageType,
  BattlePhase,
  type BattleTeamSelection,
  type PlayerSelection,
  type TeamSelectionConfig,
  type playerId,
} from '@arcadia-eternity/const'
import type { Battle } from '../v4/battle'
import { AIPlayer, type Player } from '../v4/player'

export interface NativeTeamSelectionOptions {
  enabled: boolean
  config?: Partial<TeamSelectionConfig>
}

/** Pre-battle input flow. Combat effects and turns still run on the existing Battle. */
export class NativeTeamSelection {
  private readonly config: Required<TeamSelectionConfig>
  private readonly choices = new Map<playerId, BattleTeamSelection>()
  private state: 'idle' | 'waiting' | 'complete' | 'cancelled' = 'idle'
  private complete?: () => void
  private timedOut = false

  constructor(
    private readonly battle: Battle,
    config: Partial<TeamSelectionConfig> = {},
  ) {
    this.config = {
      mode: config.mode ?? 'TEAM_SELECTION',
      minTeamSize: config.minTeamSize ?? 1,
      maxTeamSize: config.maxTeamSize ?? 6,
      allowStarterSelection: config.allowStarterSelection ?? true,
      showOpponentTeam: config.showOpponentTeam ?? false,
      teamInfoVisibility: config.teamInfoVisibility ?? 'HIDDEN',
      timeLimit: config.timeLimit ?? 60,
    }
    const c = this.config
    if (
      !['TEAM_SELECTION', 'FULL_TEAM', 'VIEW_ONLY'].includes(c.mode) ||
      !['FULL', 'BASIC', 'HIDDEN'].includes(c.teamInfoVisibility) ||
      !Number.isInteger(c.minTeamSize) ||
      !Number.isInteger(c.maxTeamSize) ||
      c.minTeamSize < 1 ||
      c.maxTeamSize > 6 ||
      c.minTeamSize > c.maxTeamSize ||
      !Number.isFinite(c.timeLimit) ||
      c.timeLimit < 0 ||
      (c.mode === 'TEAM_SELECTION' && this.players.some(player => player.team.length < c.minTeamSize))
    )
      throw new Error('Invalid native team selection configuration')
  }

  private get players(): Player[] {
    return [this.battle.playerA, this.battle.playerB]
  }
  get active(): boolean {
    return this.state === 'waiting'
  }
  get pending(): boolean {
    return this.state === 'idle' || this.active
  }

  run(): Promise<void> {
    if (this.state !== 'idle') throw new Error('Native team selection has already started')
    this.state = 'waiting'
    this.battle.currentPhase = BattlePhase.TeamSelectionPhase
    const waiting = new Promise<void>(resolve => {
      this.complete = resolve
    })
    if (this.config.mode !== 'VIEW_ONLY') {
      this.battle.timerManager.startTeamSelectionPhase(
        this.players.map(player => player.id),
        this.config.timeLimit,
        id => {
          if (!this.active) return '选队已结束'
          if (!this.timedOut) {
            this.timedOut = true
            this.battle.emitter.emit('teamSelectionTimeout', { timestamp: Date.now() })
          }
          this.submit({ type: 'team-selection', player: id, ...this.defaultChoice(this.battle.getPlayerByID(id)) })
          return '自动选择队伍'
        },
      )
    }
    const teamInfo = (player: Player) =>
      this.config.teamInfoVisibility === 'HIDDEN'
        ? null
        : {
            playerId: player.id,
            playerName: player.name,
            teamSize: player.team.length,
            pets: player.toMessage(undefined, this.config.teamInfoVisibility === 'FULL').team!,
          }
    this.battle.emitMessage(BattleMessageType.TeamSelectionStart, {
      config: { ...this.config },
      playerATeam: teamInfo(this.battle.playerA),
      playerBTeam: teamInfo(this.battle.playerB),
    })
    if (this.config.mode === 'VIEW_ONLY') {
      for (const player of this.players) this.choices.set(player.id, this.defaultChoice(player))
      this.finish()
    } else {
      for (const player of this.players)
        if (this.active && player instanceof AIPlayer && !this.choices.has(player.id))
          this.submit({ type: 'team-selection', player: player.id, ...this.defaultChoice(player) })
    }
    return waiting
  }

  available(id: playerId): PlayerSelection[] {
    const player = this.players.find(player => player.id === id)
    if (!this.active || !player || this.config.mode === 'VIEW_ONLY') return []
    return [
      { type: 'team-selection', player: id, ...this.defaultChoice(player) },
      { type: 'surrender', player: id },
    ]
  }

  submit(selection: PlayerSelection): void {
    const player = this.players.find(player => player.id === selection.player)
    if (!this.active || !player) throw new Error('Invalid native team selection player or phase')
    if (selection.type === 'surrender') {
      this.battle.abandonPlayer(player.id)
      this.cancel()
      return
    }
    if (selection.type !== 'team-selection') throw new Error('Expected a team-selection action')
    const fullTeam = player.team.map(pet => pet.id)
    const selectedPets = this.config.mode === 'FULL_TEAM' ? fullTeam : [...new Set(selection.selectedPets)]
    if (
      this.config.mode === 'TEAM_SELECTION' &&
      (selectedPets.length < this.config.minTeamSize || selectedPets.length > this.config.maxTeamSize)
    )
      throw new Error('Invalid selected team size')
    if (selectedPets.some(id => !fullTeam.includes(id))) throw new Error('Selected pet is not in this player team')
    const starterPetId = this.config.allowStarterSelection ? selection.starterPetId : selectedPets[0]
    if (!selectedPets.includes(starterPetId)) throw new Error('Invalid selected starter')
    this.choices.set(player.id, { selectedPets, starterPetId })
    this.battle.timerManager.handlePlayerSelectionChange(player.id, true)
    if (this.players.every(player => this.choices.has(player.id))) this.finish()
  }

  private defaultChoice(player: Player): BattleTeamSelection {
    const selectedPets = player.team
      .slice(0, this.config.mode === 'TEAM_SELECTION' ? this.config.maxTeamSize : undefined)
      .map(pet => pet.id)
    return { selectedPets, starterPetId: selectedPets[0] }
  }

  private finish(): void {
    if (!this.active) return
    // Validate both choices before changing either team. Keep the actual selected instances and their IDs.
    for (const player of this.players) {
      const choice = this.choices.get(player.id)!
      const selected = choice.selectedPets.map(id => player.team.find(pet => pet.id === id)!)
      for (const pet of player.team) {
        pet.appeared = pet.id === choice.starterPetId
        if (!selected.includes(pet)) {
          this.battle.petMap.delete(pet.id)
          for (const skill of pet.skills) this.battle.skillMap.delete(skill.id)
        }
      }
      player.team.splice(0, player.team.length, ...selected)
      player.activePet = selected.find(pet => pet.id === choice.starterPetId)!
    }
    this.state = 'complete'
    this.stopTimers()
    this.battle.emitMessage(BattleMessageType.TeamSelectionComplete, {
      playerASelection: structuredClone(this.choices.get(this.battle.playerA.id)!),
      playerBSelection: structuredClone(this.choices.get(this.battle.playerB.id)!),
    })
    this.complete?.()
  }

  cancel(): void {
    if (!this.pending) return
    const wasActive = this.active
    this.state = 'cancelled'
    if (wasActive) this.stopTimers()
    this.complete?.()
  }

  private stopTimers(): void {
    this.battle.timerManager.finishDecisionPhase()
    if (this.battle.isTimerEnabled() && this.config.mode !== 'VIEW_ONLY')
      this.battle.emitter.emit('teamSelectionTimerStop', { timestamp: Date.now() })
  }
}
