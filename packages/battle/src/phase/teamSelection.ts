import {
  BattleMessageType,
  BattlePhase,
  type TeamSelectionAction,
  type BattleTeamSelection,
} from '@arcadia-eternity/const'
import { InteractivePhase } from './base'
import { Context } from '../context'
import type { Battle } from '../battle'
import type { Player } from '../player'

// Team selection configuration interface
interface TeamSelectionConfig {
  enabled: boolean
  mode: 'VIEW_ONLY' | 'TEAM_SELECTION' | 'FULL_TEAM'
  maxTeamSize: number
  minTeamSize: number
  allowStarterSelection: boolean
  showOpponentTeam: boolean
  teamInfoVisibility: 'HIDDEN' | 'BASIC' | 'FULL'
  timeLimit: number
}

/**
 * TeamSelectionContext for team selection phase
 */
export class TeamSelectionContext extends Context {
  readonly type = 'team-selection'
  public readonly battle: Battle
  public readonly config: TeamSelectionConfig
  public readonly playerSelections: Map<string, BattleTeamSelection> = new Map()
  public readonly selectionProgress: Map<string, 'not_started' | 'in_progress' | 'completed'> = new Map()
  public readonly selectionStartTime: number = Date.now()
  public selectionEndTime?: number

  constructor(battle: Battle, config: TeamSelectionConfig) {
    super(null)
    this.battle = battle
    this.config = config

    // Initialize progress tracking for both players
    this.selectionProgress.set(battle.playerA.id, 'not_started')
    this.selectionProgress.set(battle.playerB.id, 'not_started')
  }

  /**
   * Check if all players have made their team selections
   */
  public areAllSelectionsComplete(): boolean {
    return (
      this.playerSelections.size >= 2 &&
      this.playerSelections.has(this.battle.playerA.id) &&
      this.playerSelections.has(this.battle.playerB.id)
    )
  }

  /**
   * Add a player's team selection
   */
  public addPlayerSelection(playerId: string, selection: BattleTeamSelection): void {
    this.playerSelections.set(playerId, selection)
    this.selectionProgress.set(playerId, 'completed')

    // Mark selection end time when all selections are complete
    if (this.areAllSelectionsComplete() && !this.selectionEndTime) {
      this.selectionEndTime = Date.now()
    }
  }

  /**
   * Get a player's team selection
   */
  public getPlayerSelection(playerId: string): BattleTeamSelection | undefined {
    return this.playerSelections.get(playerId)
  }

  /**
   * Mark player as starting selection
   */
  public markPlayerSelectionStarted(playerId: string): void {
    if (this.selectionProgress.get(playerId) === 'not_started') {
      this.selectionProgress.set(playerId, 'in_progress')
    }
  }

  /**
   * Get player selection progress
   */
  public getPlayerProgress(playerId: string): 'not_started' | 'in_progress' | 'completed' {
    return this.selectionProgress.get(playerId) || 'not_started'
  }

  /**
   * Get selection duration in milliseconds
   */
  public getSelectionDuration(): number {
    const endTime = this.selectionEndTime || Date.now()
    return endTime - this.selectionStartTime
  }

  /**
   * Get selection statistics
   */
  public getSelectionStats(): {
    totalDuration: number
    playerAProgress: string
    playerBProgress: string
    isComplete: boolean
  } {
    return {
      totalDuration: this.getSelectionDuration(),
      playerAProgress: this.getPlayerProgress(this.battle.playerA.id),
      playerBProgress: this.getPlayerProgress(this.battle.playerB.id),
      isComplete: this.areAllSelectionsComplete(),
    }
  }
}

/**
 * TeamSelectionPhase handles team selection before battle starts
 * This is an interactive phase that waits for both players to select their teams
 */
export class TeamSelectionPhase extends InteractivePhase<TeamSelectionContext> {
  private config: TeamSelectionConfig
  private timeoutHandler?: () => void

  constructor(battle: Battle, config: TeamSelectionConfig, id?: string) {
    super(battle, id)
    this.config = config
  }

  /**
   * Get default team selection for AI or timeout
   */
  private getDefaultTeamSelection(fullTeam: Player['fullTeam']): BattleTeamSelection {
    const { mode, maxTeamSize, minTeamSize } = this.config

    if (mode === 'VIEW_ONLY' || mode === 'FULL_TEAM') {
      // Use full team with first pet as starter
      return {
        selectedPets: fullTeam.map(pet => pet.id),
        starterPetId: fullTeam[0]?.id || ('' as any),
      }
    }

    // For TEAM_SELECTION mode, select required number of pets
    const targetSize = minTeamSize || Math.min(maxTeamSize || 6, fullTeam.length)
    const selectedPets = fullTeam.slice(0, targetSize).map(pet => pet.id)

    return {
      selectedPets,
      starterPetId: selectedPets[0] || ('' as any),
    }
  }

  protected createContext(): TeamSelectionContext {
    return new TeamSelectionContext(this.battle, this.config)
  }

  protected async executeOperation(): Promise<void> {
    const battle = this.battle
    const context = this._context!
    const config = this.config

    // Clear any previous selections
    battle.clearSelections()

    // Emit team selection start message
    battle.emitMessage(BattleMessageType.TeamSelectionStart, {
      config: {
        mode: config.mode,
        maxTeamSize: config.maxTeamSize,
        minTeamSize: config.minTeamSize,
        allowStarterSelection: config.allowStarterSelection,
        showOpponentTeam: config.showOpponentTeam,
        teamInfoVisibility: config.teamInfoVisibility,
        timeLimit: config.timeLimit,
      },
      playerATeam: this.getTeamInfo(battle.playerA, config.teamInfoVisibility),
      playerBTeam: this.getTeamInfo(battle.playerB, config.teamInfoVisibility),
    })

    // Handle different modes
    if (config.mode === 'VIEW_ONLY') {
      await this.handleViewOnlyMode(context)
    } else {
      await this.handleSelectionMode(context)
    }

    // Apply team selections to players
    this.applyTeamSelections(context)

    // Emit team selection complete message
    const playerASelection = context.getPlayerSelection(battle.playerA.id)
    const playerBSelection = context.getPlayerSelection(battle.playerB.id)

    if (playerASelection && playerBSelection) {
      battle.emitMessage(BattleMessageType.TeamSelectionComplete, {
        playerASelection,
        playerBSelection,
      })
    }
  }

  /**
   * Handle view-only mode (just show teams for a time limit)
   */
  private async handleViewOnlyMode(context: TeamSelectionContext): Promise<void> {
    const config = this.config
    const timeLimit = config.timeLimit || 10

    // Wait for the time limit
    await new Promise(resolve => setTimeout(resolve, timeLimit * 1000))

    // Generate default selections for both players
    const playerASelection = this.getDefaultTeamSelection(this.battle.playerA.fullTeam)
    const playerBSelection = this.getDefaultTeamSelection(this.battle.playerB.fullTeam)

    context.addPlayerSelection(this.battle.playerA.id, playerASelection)
    context.addPlayerSelection(this.battle.playerB.id, playerBSelection)
  }

  /**
   * Handle selection mode (wait for player inputs)
   */
  private async handleSelectionMode(context: TeamSelectionContext): Promise<void> {
    const config = this.config
    const timeLimit = config.timeLimit || 60

    // Set up timeout handler
    this.timeoutHandler = () => {
      this.handleTimeout(context)
    }

    // Listen for timeout events from TimerManager
    const timeoutListener = (_event: any) => {
      if (this.timeoutHandler) {
        this.timeoutHandler()
      }
    }

    // Start timer if configured
    if (timeLimit > 0) {
      this.battle.timerManager.startTeamSelectionTimer(timeLimit)
      this.battle.emitter.on('teamSelectionTimeout', timeoutListener)
    }

    try {
      // Wait for both players to make team selections using the same pattern as turnPhase
      await this.waitForBothPlayersTeamSelectionReady(context)
    } finally {
      // Clean up
      if (timeLimit > 0) {
        this.battle.timerManager.stopTeamSelectionTimer()
        this.battle.emitter.off('teamSelectionTimeout', timeoutListener)
      }
      this.timeoutHandler = undefined
    }
  }

  /**
   * Wait for both players to make team selections
   */
  private async waitForBothPlayersTeamSelectionReady(context: TeamSelectionContext): Promise<void> {
    // Continue waiting until both players have made team selections
    while (true) {
      // Check if already ready
      if (context.areAllSelectionsComplete()) {
        return
      }

      // 检查战斗是否已结束，避免无限等待
      if (this.battle.isBattleEnded()) {
        return
      }

      // Process any pending team selections first
      this.processPlayerSelections(context)

      // Check again after processing
      if (context.areAllSelectionsComplete()) {
        console.log('Team selections complete after processing, exiting wait loop')
        return
      }

      // Wait a short time before checking again
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  /**
   * Process player selections from battle
   */
  private processPlayerSelections(context: TeamSelectionContext): void {
    const battle = this.battle

    // Check player A selection
    if (battle.playerA.selection?.type === 'team-selection' && !context.getPlayerSelection(battle.playerA.id)) {
      console.log('Processing Player A team selection:', battle.playerA.selection)
      // Mark as in progress if not already
      context.markPlayerSelectionStarted(battle.playerA.id)

      const selection = battle.playerA.selection as TeamSelectionAction
      const teamSelection: BattleTeamSelection = {
        selectedPets: selection.selectedPets,
        starterPetId: selection.starterPetId,
      }

      // Validate selection
      const validationResult = battle.validateTeamSelection(battle.playerA.id, teamSelection)
      if (validationResult.isValid) {
        console.log('Player A team selection valid, adding to context')
        context.addPlayerSelection(battle.playerA.id, teamSelection)
        battle.playerA.selection = null // Clear selection
      } else {
        console.log('Player A team selection invalid:', validationResult.errors)
        // Emit validation error
        battle.emitMessage(BattleMessageType.Error, {
          message: `Player A team selection invalid: ${validationResult.errors.join(', ')}`,
        })
        battle.playerA.selection = null // Clear invalid selection
      }
    }

    // Check player B selection
    if (battle.playerB.selection?.type === 'team-selection' && !context.getPlayerSelection(battle.playerB.id)) {
      console.log('Processing Player B team selection:', battle.playerB.selection)
      // Mark as in progress if not already
      context.markPlayerSelectionStarted(battle.playerB.id)

      const selection = battle.playerB.selection as TeamSelectionAction
      const teamSelection: BattleTeamSelection = {
        selectedPets: selection.selectedPets,
        starterPetId: selection.starterPetId,
      }

      // Validate selection
      const validationResult = battle.validateTeamSelection(battle.playerB.id, teamSelection)
      if (validationResult.isValid) {
        console.log('Player B team selection valid, adding to context')
        context.addPlayerSelection(battle.playerB.id, teamSelection)
        battle.playerB.selection = null // Clear selection
      } else {
        console.log('Player B team selection invalid:', validationResult.errors)
        // Emit validation error
        battle.emitMessage(BattleMessageType.Error, {
          message: `Player B team selection invalid: ${validationResult.errors.join(', ')}`,
        })
        battle.playerB.selection = null // Clear invalid selection
      }
    }
  }

  /**
   * Handle timeout by generating default selections
   */
  private handleTimeout(context: TeamSelectionContext): void {
    const battle = this.battle

    // Generate default selection for player A if not selected
    if (!context.getPlayerSelection(battle.playerA.id)) {
      const defaultSelection = this.getDefaultTeamSelection(battle.playerA.fullTeam)
      context.addPlayerSelection(battle.playerA.id, defaultSelection)
    }

    // Generate default selection for player B if not selected
    if (!context.getPlayerSelection(battle.playerB.id)) {
      const defaultSelection = this.getDefaultTeamSelection(battle.playerB.fullTeam)
      context.addPlayerSelection(battle.playerB.id, defaultSelection)
    }

    // No timeout message needed - just use default selections
  }

  /**
   * Apply team selections to players
   */
  private applyTeamSelections(context: TeamSelectionContext): void {
    const battle = this.battle

    // Apply player A selection
    const playerASelection = context.getPlayerSelection(battle.playerA.id)
    if (playerASelection) {
      battle.playerA.applyTeamSelection(playerASelection)
      const afterTeamSize = battle.playerA.battleTeam.length

      // Validate that battleTeam was updated correctly
      if (afterTeamSize !== playerASelection.selectedPets.length) {
        console.warn(
          `Player A battleTeam size mismatch: expected ${playerASelection.selectedPets.length}, got ${afterTeamSize}`,
        )
      }

      // Validate that starter pet is correct
      if (battle.playerA.activePet.id !== playerASelection.starterPetId) {
        console.warn(
          `Player A starter pet mismatch: expected ${playerASelection.starterPetId}, got ${battle.playerA.activePet.id}`,
        )
      }
    }

    // Apply player B selection
    const playerBSelection = context.getPlayerSelection(battle.playerB.id)
    if (playerBSelection) {
      battle.playerB.applyTeamSelection(playerBSelection)
      const afterTeamSize = battle.playerB.battleTeam.length

      // Validate that battleTeam was updated correctly
      if (afterTeamSize !== playerBSelection.selectedPets.length) {
        console.warn(
          `Player B battleTeam size mismatch: expected ${playerBSelection.selectedPets.length}, got ${afterTeamSize}`,
        )
      }

      // Validate that starter pet is correct
      if (battle.playerB.activePet.id !== playerBSelection.starterPetId) {
        console.warn(
          `Player B starter pet mismatch: expected ${playerBSelection.starterPetId}, got ${battle.playerB.activePet.id}`,
        )
      }
    }

    // Emit battleTeam update event for debugging/monitoring
    battle.emitMessage(BattleMessageType.Info, {
      message: `Team selections applied - Player A: ${battle.playerA.battleTeam.length} pets (starter: ${battle.playerA.activePet.id}), Player B: ${battle.playerB.battleTeam.length} pets (starter: ${battle.playerB.activePet.id})`,
    })
  }

  /**
   * Get team information based on visibility level
   */
  private getTeamInfo(player: Player, visibility: 'FULL' | 'BASIC' | 'HIDDEN'): any {
    switch (visibility) {
      case 'HIDDEN':
        return null
      case 'BASIC':
        return {
          playerId: player.id,
          playerName: player.name,
          teamSize: player.fullTeam.length,
          pets: player.fullTeam.map(pet => ({
            id: pet.id,
            name: pet.name,
            species: pet.species,
            level: pet.level,
          })),
        }
      case 'FULL':
        return {
          playerId: player.id,
          playerName: player.name,
          teamSize: player.fullTeam.length,
          pets: player.fullTeam.map(pet => ({
            id: pet.id,
            name: pet.name,
            species: pet.species,
            level: pet.level,
            currentHp: pet.currentHp,
            maxHp: pet.stat.maxHp,
            skills: pet.skills.map(skill => ({
              id: skill.id,
              name: skill.base.id, // Use base skill id as name
              rage: skill.rage,
            })),
          })),
        }
      default:
        return null
    }
  }
}
