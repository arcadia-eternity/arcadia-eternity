// battle/src/v2/orchestrator.ts
// BattleOrchestrator — drives the top-level battle loop.

import type { World, EventBus, PhaseManager } from '@arcadia-eternity/engine'
import type { PlayerSelection, TeamInfo, TeamSelectionConfig, BattleTeamSelection, petId } from '@arcadia-eternity/const'
import type { BattleInstance } from './game.js'
import type { SelectionSystem } from './systems/selection.system.js'
import type { TimerSystem } from './systems/timer.system.js'
import { worldToBattleState } from './systems/state-serializer.js'
import { DecisionManager } from './decision/manager.js'

// ---------------------------------------------------------------------------
// BattleOrchestrator
// ---------------------------------------------------------------------------

export class BattleOrchestrator {
  private running = false
  private decisionManager: DecisionManager

  constructor(
    private battle: BattleInstance,
    private selectionSystem: SelectionSystem,
    timerSystem?: TimerSystem,
  ) {
    this.decisionManager = new DecisionManager(battle, selectionSystem, timerSystem)
  }

  get world(): World { return this.battle.world }
  get pm(): PhaseManager { return this.battle.phaseManager }
  get bus(): EventBus { return this.battle.eventBus }

  // -----------------------------------------------------------------------
  // Main loop
  // -----------------------------------------------------------------------

  async startBattle(options?: { resumeFromSnapshot?: boolean }): Promise<void> {
    if (this.running) return
    this.running = true

    const playerAId = this.world.state.playerAId as string
    const playerBId = this.world.state.playerBId as string

    if (!options?.resumeFromSnapshot) {
      await this.runTeamSelectionIfNeeded(playerAId, playerBId)
      if (this.isBattleEnded()) {
        this.running = false
        return
      }

      // Phase 1: BattleStart
      await this.pm.execute(this.world, 'battleStart', this.bus, { playerAId, playerBId })
    }

    // Phase 2: Main loop
    while (this.running && !this.isBattleEnded()) {
      // BattleSwitch — handle forced/faint switches
      await this.pm.execute(this.world, 'battleSwitch', this.bus, {
        selectionSystem: this.selectionSystem,
        decisionManager: this.decisionManager,
      })

      if (this.isBattleEnded()) break

      // Selection — wait for both players
      this.world.state.currentPhase = 'selection'
      this.selectionSystem.clearSelections(this.world)

      this.bus.emit(this.world, 'turnAction', {
        playerIds: [playerAId, playerBId],
      })
      const selections = await this.decisionManager.collectDecisions([playerAId, playerBId], 'selection')

      // Check for surrender
      for (const [playerId, sel] of Object.entries(selections)) {
        if (sel.type === 'surrender') {
          const reason = this.decisionManager.consumeTimeoutSurrender(playerId) ? 'timeout' : 'surrender'
          this.handleSurrender(playerId, reason)
          break
        }
      }

      if (this.isBattleEnded()) break

      // Turn — execute the turn with collected selections
      this.world.state.currentPhase = 'execution'
      await this.pm.execute(this.world, 'turn', this.bus, { selections })

      if (this.isBattleEnded()) break
    }

    // Emit battle end
    if (this.running) {
      const victor = this.world.state.victor as string | null
      const reason = this.world.state.endReason as string ?? 'all_pet_fainted'
      this.bus.emit(this.world, 'battleEnd', { winner: victor, reason })
      this.world.state.status = 'ended'
    }

    this.running = false
  }

  // -----------------------------------------------------------------------
  // Battle end detection
  // -----------------------------------------------------------------------

  isBattleEnded(): boolean {
    if (this.world.state.status === 'ended') return true
    if (this.world.state.victor) {
      this.world.state.status = 'ended'
      return true
    }

    const playerAId = this.world.state.playerAId as string
    const playerBId = this.world.state.playerBId as string

    const aAlive = this.battle.playerSystem.getAlivePets(this.world, playerAId)
    const bAlive = this.battle.playerSystem.getAlivePets(this.world, playerBId)

    if (aAlive.length === 0) {
      this.world.state.victor = playerBId
      this.world.state.endReason = 'all_pet_fainted'
      this.world.state.status = 'ended'
      return true
    }
    if (bAlive.length === 0) {
      this.world.state.victor = playerAId
      this.world.state.endReason = 'all_pet_fainted'
      this.world.state.status = 'ended'
      return true
    }

    return false
  }

  // -----------------------------------------------------------------------
  // Surrender
  // -----------------------------------------------------------------------

  handleSurrender(playerId: string, reason: 'surrender' | 'timeout' = 'surrender'): void {
    const playerAId = this.world.state.playerAId as string
    const playerBId = this.world.state.playerBId as string
    this.world.state.victor = playerId === playerAId ? playerBId : playerAId
    this.world.state.endReason = reason
    this.world.state.status = 'ended'
  }

  // -----------------------------------------------------------------------
  // Stop
  // -----------------------------------------------------------------------

  stop(): void {
    this.running = false
    this.decisionManager.cancelPendingDecisions()
    this.selectionSystem.cancelWaiting()
  }

  private async runTeamSelectionIfNeeded(playerAId: string, playerBId: string): Promise<void> {
    const cfg = this.getTeamSelectionConfig()
    if (!cfg.enabled) return

    this.world.state.currentPhase = 'teamSelection'

    const playerATeam = this.buildTeamInfo(playerAId, cfg)
    const playerBTeam = this.buildTeamInfo(playerBId, cfg)

    this.bus.emit(this.world, 'teamSelectionStart', {
      config: cfg,
      playerATeam,
      playerBTeam,
    })

    // VIEW_ONLY: no input required, keep defaults.
    if (cfg.mode === 'VIEW_ONLY') {
      this.bus.emit(this.world, 'teamSelectionComplete', {
        playerASelection: this.getDefaultSelection(playerAId),
        playerBSelection: this.getDefaultSelection(playerBId),
      })
      return
    }

    this.selectionSystem.clearSelections(this.world)
    const selections = await this.decisionManager.collectDecisions(
      [playerAId, playerBId],
      'teamSelection',
      { turnTimeLimitOverrideSec: cfg.timeLimit },
    )

    for (const [pid, sel] of Object.entries(selections)) {
      if (sel.type === 'surrender') {
        const reason = this.decisionManager.consumeTimeoutSurrender(pid) ? 'timeout' : 'surrender'
        this.handleSurrender(pid, reason)
        return
      }
    }

    const playerASelection = this.normalizeTeamSelection(playerAId, selections[playerAId], cfg)
    const playerBSelection = this.normalizeTeamSelection(playerBId, selections[playerBId], cfg)

    this.battle.playerSystem.applyTeamSelection(
      this.world,
      playerAId,
      playerASelection.selectedPets,
      playerASelection.starterPetId,
    )
    this.battle.playerSystem.applyTeamSelection(
      this.world,
      playerBId,
      playerBSelection.selectedPets,
      playerBSelection.starterPetId,
    )

    this.bus.emit(this.world, 'teamSelectionComplete', {
      playerASelection,
      playerBSelection,
    })
  }

  private getTeamSelectionConfig(): TeamSelectionConfig & { enabled: boolean } {
    const raw = this.battle.config.teamSelection
    return {
      enabled: raw?.enabled ?? false,
      mode: raw?.config?.mode ?? 'TEAM_SELECTION',
      maxTeamSize: raw?.config?.maxTeamSize ?? 6,
      minTeamSize: raw?.config?.minTeamSize ?? 1,
      allowStarterSelection: raw?.config?.allowStarterSelection ?? true,
      showOpponentTeam: raw?.config?.showOpponentTeam ?? false,
      teamInfoVisibility: raw?.config?.teamInfoVisibility ?? 'HIDDEN',
      timeLimit: raw?.config?.timeLimit ?? 60,
    }
  }

  private buildTeamInfo(playerId: string, cfg: TeamSelectionConfig): TeamInfo | null {
    if (cfg.teamInfoVisibility === 'HIDDEN') return null

    const snapshot = worldToBattleState(this.world, {
      playerSystem: this.battle.playerSystem,
      petSystem: this.battle.petSystem,
      markSystem: this.battle.markSystem,
      skillSystem: this.battle.skillSystem,
      attrSystem: this.battle.attrSystem,
    }, undefined, cfg.teamInfoVisibility === 'FULL')

    const player = snapshot.players.find(p => p.id === playerId)
    if (!player || !player.team) return null

    return {
      playerId,
      playerName: player.name,
      teamSize: player.team.length,
      pets: player.team,
    }
  }

  private getDefaultSelection(playerId: string): BattleTeamSelection {
    const player = this.battle.playerSystem.getOrThrow(this.world, playerId)
    const selectedPets = [...player.fullTeamPetIds] as unknown as petId[]
    const starterPetId = (selectedPets[0] ?? '') as unknown as petId
    return { selectedPets, starterPetId }
  }

  private normalizeTeamSelection(
    playerId: string,
    selection: PlayerSelection | undefined,
    cfg: TeamSelectionConfig,
  ): BattleTeamSelection {
    const player = this.battle.playerSystem.getOrThrow(this.world, playerId)
    const fullTeam = [...player.fullTeamPetIds]

    if (cfg.mode === 'FULL_TEAM') {
      const starterPetId =
        selection?.type === 'team-selection' && selection.starterPetId
          ? selection.starterPetId
          : (fullTeam[0] ?? '')
      return {
        selectedPets: fullTeam as unknown as petId[],
        starterPetId: starterPetId as unknown as petId,
      }
    }

    if (!selection || selection.type !== 'team-selection') {
      throw new Error(`Invalid team selection for player ${playerId}: expected 'team-selection' action`)
    }

    const unique = Array.from(new Set(selection.selectedPets))
    const min = cfg.minTeamSize ?? 1
    const max = cfg.maxTeamSize ?? 6

    if (unique.length < min || unique.length > max) {
      throw new Error(`Invalid team size for player ${playerId}: got ${unique.length}, expected ${min}-${max}`)
    }
    for (const pid of unique) {
      if (!fullTeam.includes(pid)) {
        throw new Error(`Player ${playerId} selected pet not in full team: ${pid}`)
      }
    }

    const starterPetId = cfg.allowStarterSelection
      ? selection.starterPetId
      : unique[0]
    if (!starterPetId || !unique.includes(starterPetId)) {
      throw new Error(`Invalid starter selection for player ${playerId}`)
    }

    return {
      selectedPets: unique as unknown as petId[],
      starterPetId: starterPetId as unknown as petId,
    }
  }
}
