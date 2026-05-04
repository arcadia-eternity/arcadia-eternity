import type { TimerConfig, petId } from '@arcadia-eternity/const'
import type { TeamSelectionConfig, BattleTeamSelection } from '@arcadia-eternity/const'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { Team, RuleContext, BattleConfigModifications } from '../../interfaces/Rule'
import { ValidationResultBuilder, ValidationErrorType, type ValidationResult } from '../../interfaces/ValidationResult'
import { AbstractRule } from '../../core/AbstractRule'

/**
 * Team Selection Rule
 * Configures team selection behavior before battle starts
 * This rule enables team viewing, filtering, ordering, and starter selection
 */
export class TeamSelectionRule extends AbstractRule {
  private config: TeamSelectionConfig

  constructor(
    id: string = 'team_selection_rule',
    name: string = '队伍选择规则',
    config: TeamSelectionConfig,
    options: {
      description?: string
      priority?: number
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
    } = {},
  ) {
    super(id, name, {
      description: options.description ?? '配置战斗前的队伍选择行为',
      ...options,
      tags: ['special', 'team-selection', 'pre-battle', ...(options.tags ?? [])],
    })

    this.config = { ...config }
    this.validateConfig()
  }

  /**
   * Validate the team selection configuration
   */
  private validateConfig(): void {
    const { mode, maxTeamSize, minTeamSize, timeLimit } = this.config

    if (mode === 'TEAM_SELECTION') {
      if (maxTeamSize !== undefined && maxTeamSize < 1) {
        throw new Error('maxTeamSize must be at least 1')
      }
      if (minTeamSize !== undefined && minTeamSize < 1) {
        throw new Error('minTeamSize must be at least 1')
      }
      if (maxTeamSize !== undefined && minTeamSize !== undefined && minTeamSize > maxTeamSize) {
        throw new Error('minTeamSize cannot be greater than maxTeamSize')
      }
    }

    if (timeLimit !== undefined && timeLimit < 1) {
      throw new Error('timeLimit must be at least 1 second')
    }
  }

  /**
   * Validate team selection result
   */
  validateTeamSelection(teamSelection: BattleTeamSelection, fullTeam: Team): ValidationResult {
    const builder = new ValidationResultBuilder()
    const { selectedPets, starterPetId } = teamSelection
    const { mode, maxTeamSize, minTeamSize } = this.config

    // Only validate if in team selection mode
    if (mode !== 'TEAM_SELECTION') {
      return builder.build()
    }

    // Check team size constraints
    if (maxTeamSize !== undefined && selectedPets.length > maxTeamSize) {
      builder.addError(
        ValidationErrorType.TEAM_VALIDATION,
        'TOO_MANY_SELECTED_PETS',
        `选择的精灵过多，最多允许 ${maxTeamSize} 只，当前选择了 ${selectedPets.length} 只`,
        undefined,
        'team',
        { maxSize: maxTeamSize, currentSize: selectedPets.length },
      )
    }

    if (minTeamSize !== undefined && selectedPets.length < minTeamSize) {
      builder.addError(
        ValidationErrorType.TEAM_VALIDATION,
        'TOO_FEW_SELECTED_PETS',
        `选择的精灵过少，至少需要 ${minTeamSize} 只，当前选择了 ${selectedPets.length} 只`,
        undefined,
        'team',
        { minSize: minTeamSize, currentSize: selectedPets.length },
      )
    }

    // Check that all selected pets exist in full team
    const fullTeamIds = new Set(fullTeam.map(pet => pet.id))
    for (const petId of selectedPets) {
      if (!fullTeamIds.has(petId)) {
        builder.addError(
          ValidationErrorType.PET_VALIDATION,
          'INVALID_SELECTED_PET',
          `选择的精灵 ${petId} 不在完整队伍中`,
          petId,
          'pet',
          { petId },
        )
      }
    }

    // Check that starter pet is in selected pets
    if (!selectedPets.includes(starterPetId)) {
      builder.addError(
        ValidationErrorType.PET_VALIDATION,
        'INVALID_STARTER_PET',
        `首发精灵 ${starterPetId} 必须在选择的精灵中`,
        starterPetId,
        'pet',
        { starterPetId, selectedPets },
      )
    }

    // Check for duplicate selections
    const uniquePets = new Set(selectedPets)
    if (uniquePets.size !== selectedPets.length) {
      builder.addError(
        ValidationErrorType.TEAM_VALIDATION,
        'DUPLICATE_SELECTED_PETS',
        '选择的精灵中有重复',
        undefined,
        'team',
        { selectedPets },
      )
    }

    return builder.build()
  }

  /**
   * Get timer configuration modifications
   */
  getTimerConfigModifications(_context?: RuleContext): Partial<TimerConfig> {
    // Team selection timer is handled separately in the battle system
    // Return empty modifications for now
    return {}
  }

  /**
   * Check if this rule is applicable in the current context
   */
  isApplicable(context?: RuleContext): boolean {
    // Team selection rule is only applicable during battle preparation
    return context?.phase === 'battle_preparation' || context?.phase === undefined
  }

  /**
   * Get the team selection configuration
   */
  getConfig(): TeamSelectionConfig {
    return { ...this.config }
  }

  /**
   * Update team selection configuration
   */
  updateConfig(updates: Partial<TeamSelectionConfig>): void {
    this.config = { ...this.config, ...updates }
    this.validateConfig()
  }

  /**
   * Check if team selection is required
   */
  requiresTeamSelection(): boolean {
    return this.config.mode === 'TEAM_SELECTION' || this.config.mode === 'VIEW_ONLY'
  }

  /**
   * Check if team viewing is enabled
   */
  allowsTeamViewing(): boolean {
    return this.config.showOpponentTeam && this.config.teamInfoVisibility !== 'HIDDEN'
  }

  /**
   * Check if starter selection is allowed
   */
  allowsStarterSelection(): boolean {
    return this.config.allowStarterSelection
  }

  /**
   * Get battle configuration modifications
   */
  getBattleConfigModifications(_context?: RuleContext): BattleConfigModifications {
    return {
      customConfig: {
        teamSelection: {
          enabled: true,
          config: this.config,
        },
      },
    }
  }

  /**
   * Get default team selection for AI or timeout
   */
  getDefaultTeamSelection(fullTeam: Team): BattleTeamSelection {
    const { mode, maxTeamSize, minTeamSize } = this.config

    if (mode === 'VIEW_ONLY' || mode === 'FULL_TEAM') {
      // Use full team with first pet as starter
      return {
        selectedPets: fullTeam.map(pet => pet.id as petId),
        starterPetId: (fullTeam[0]?.id || '') as petId,
      }
    }

    // For TEAM_SELECTION mode, select required number of pets
    const targetSize = minTeamSize || Math.min(maxTeamSize || 6, fullTeam.length)
    const selectedPets = fullTeam.slice(0, targetSize).map(pet => pet.id as petId)

    return {
      selectedPets,
      starterPetId: (selectedPets[0] || '') as petId,
    }
  }
}

/**
 * Create a view-only team selection rule
 */
export function createViewOnlyRule(timeLimit: number = 10): TeamSelectionRule {
  return new TeamSelectionRule('view_only_rule', '队伍查看规则', {
    mode: 'VIEW_ONLY',
    allowStarterSelection: false,
    showOpponentTeam: true,
    teamInfoVisibility: 'BASIC',
    timeLimit,
  })
}

/**
 * Create a starter selection rule (full team, choose starter)
 */
export function createStarterSelectionRule(timeLimit: number = 30): TeamSelectionRule {
  return new TeamSelectionRule('starter_selection_rule', '首发选择规则', {
    mode: 'FULL_TEAM',
    allowStarterSelection: true,
    showOpponentTeam: true,
    teamInfoVisibility: 'BASIC',
    timeLimit,
  })
}

/**
 * Create a 6v3 competitive team selection rule
 */
export function createCompetitive6v3Rule(timeLimit: number = 60): TeamSelectionRule {
  return new TeamSelectionRule('competitive_6v3_rule', '竞技6选3规则', {
    mode: 'TEAM_SELECTION',
    maxTeamSize: 3,
    minTeamSize: 3,
    allowStarterSelection: true,
    showOpponentTeam: false,
    teamInfoVisibility: 'HIDDEN',
    timeLimit,
  })
}

/**
 * Create a 6v4 casual team selection rule
 */
export function createCasual6v4Rule(timeLimit: number = 90): TeamSelectionRule {
  return new TeamSelectionRule('casual_6v4_rule', '休闲6选4规则', {
    mode: 'TEAM_SELECTION',
    maxTeamSize: 4,
    minTeamSize: 4,
    allowStarterSelection: true,
    showOpponentTeam: true,
    teamInfoVisibility: 'FULL',
    timeLimit,
  })
}

/**
 * Create a competitive full team selection rule
 * All 6 pets participate, but players can choose starter
 */
export function createCompetitiveFullTeamRule(timeLimit: number = 60): TeamSelectionRule {
  return new TeamSelectionRule('competitive_full_team_rule', '竞技全队参战规则', {
    mode: 'FULL_TEAM',
    allowStarterSelection: true,
    showOpponentTeam: true,
    teamInfoVisibility: 'BASIC',
    timeLimit,
  })
}
