import { TimeoutType, type PlayerSelection } from '@arcadia-eternity/const'
import type { BattleInstance } from '../game.js'
import type { SelectionSystem } from '../systems/selection.system.js'
import type { TimerSystem } from '../systems/timer.system.js'
import { HumanDecisionProvider } from './providers/human.provider.js'
import { RuleDecisionProvider } from './providers/rule.provider.js'
import type {
  DecisionContext,
  DecisionPhase,
  DecisionProvider,
  DecisionProviderFactory,
  DecisionProviderSpec,
} from './types.js'

type PlayerSlot = 'playerA' | 'playerB'

interface DecisionConfig {
  playerA?: DecisionProviderSpec
  playerB?: DecisionProviderSpec
  registry?: Record<string, DecisionProviderFactory>
}

interface CollectDecisionOptions {
  turnTimeLimitOverrideSec?: number
}

export class DecisionManager {
  private activeAbortController: AbortController | null = null
  private readonly timeoutSurrenderPlayers = new Set<string>()

  constructor(
    private battle: BattleInstance,
    private selectionSystem: SelectionSystem,
    private timerSystem?: TimerSystem,
  ) {}

  async collectDecisions(
    playerIds: string[],
    phase: DecisionPhase,
    options: CollectDecisionOptions = {},
  ): Promise<Record<string, PlayerSelection>> {
    const abortController = new AbortController()
    this.activeAbortController = abortController

    if (this.timerSystem?.isEnabled()) {
      await this.timerSystem.startDecisionWindow({
        phase,
        playerIds,
        turnTimeLimitOverrideSec: options.turnTimeLimitOverrideSec,
        onTimeout: async (playerId, timeoutType) => this.handleTimeout(playerIds, playerId, phase, timeoutType),
      })
    }

    try {
      await Promise.all(playerIds.map(playerId => this.decideForPlayer(playerId, phase, abortController.signal)))
    } finally {
      this.timerSystem?.stopDecisionWindow()
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null
      }
    }

    const result: Record<string, PlayerSelection> = {}
    for (const playerId of playerIds) {
      let selection = this.selectionSystem.getSelection(this.battle.world, playerId)
      if (!selection) {
        selection = this.pickFallbackSelection(playerId, phase)
        this.selectionSystem.setSelection(this.battle.world, playerId, selection)
      }
      result[playerId] = selection
    }
    return result
  }

  cancelPendingDecisions(): void {
    this.activeAbortController?.abort()
    this.activeAbortController = null
    this.timerSystem?.stopDecisionWindow()
  }

  consumeTimeoutSurrender(playerId: string): boolean {
    const had = this.timeoutSurrenderPlayers.has(playerId)
    if (had) {
      this.timeoutSurrenderPlayers.delete(playerId)
    }
    return had
  }

  private async decideForPlayer(
    playerId: string,
    phase: DecisionPhase,
    abortSignal: AbortSignal,
  ): Promise<PlayerSelection> {
    const existing = this.selectionSystem.getSelection(this.battle.world, playerId)
    if (existing) {
      this.timerSystem?.markPlayerResolved(playerId)
      return existing
    }

    const provider = this.resolveProvider(playerId)
    const ctx: DecisionContext = {
      world: this.battle.world,
      playerId,
      phase,
      selectionSystem: this.selectionSystem,
      abortSignal,
    }
    const decided = await provider.decide(ctx)

    const overridden = this.selectionSystem.getSelection(this.battle.world, playerId)
    if (overridden) {
      this.timerSystem?.markPlayerResolved(playerId)
      return overridden
    }

    this.selectionSystem.setSelection(this.battle.world, playerId, decided)
    this.timerSystem?.markPlayerResolved(playerId)
    return decided
  }

  private async handleTimeout(
    windowPlayerIds: string[],
    timeoutPlayerId: string,
    phase: DecisionPhase,
    timeoutType: TimeoutType,
  ): Promise<string | undefined> {
    if (timeoutType === TimeoutType.Total) {
      this.timeoutSurrenderPlayers.add(timeoutPlayerId)
      for (const playerId of windowPlayerIds) {
        const existing = this.selectionSystem.getSelection(this.battle.world, playerId)
        if (existing) continue
        const selection = playerId === timeoutPlayerId
          ? this.pickSurrenderSelection(playerId, phase)
          : this.pickTurnTimeoutSelection(playerId, phase)
        this.selectionSystem.setSelection(this.battle.world, playerId, selection)
        this.timerSystem?.markPlayerResolved(playerId)
      }
      return `自动选择: ${this.describeSelection(this.pickSurrenderSelection(timeoutPlayerId, phase))}`
    }

    const selection = this.pickTurnTimeoutSelection(timeoutPlayerId, phase)
    this.selectionSystem.setSelection(this.battle.world, timeoutPlayerId, selection)
    this.timerSystem?.markPlayerResolved(timeoutPlayerId)
    return `自动选择: ${this.describeSelection(selection)}`
  }

  private pickFallbackSelection(playerId: string, phase: DecisionPhase): PlayerSelection {
    if (this.timeoutSurrenderPlayers.has(playerId)) {
      return this.pickSurrenderSelection(playerId, phase)
    }
    return this.pickTurnTimeoutSelection(playerId, phase)
  }

  private pickTurnTimeoutSelection(playerId: string, phase: DecisionPhase): PlayerSelection {
    const available = this.selectionSystem.getAvailableSelections(this.battle.world, playerId)
    if (available.length === 0) {
      throw new Error(`No available selections for player ${playerId} at phase ${phase}`)
    }

    if (phase === 'teamSelection') {
      return (
        available.find(selection => selection.type === 'team-selection') ??
        available.find(selection => selection.type !== 'surrender') ??
        available[0]
      )
    }

    if (phase === 'switch') {
      return (
        available.find(selection => selection.type === 'switch-pet') ??
        available.find(selection => selection.type === 'do-nothing') ??
        available.find(selection => selection.type !== 'surrender') ??
        available[0]
      )
    }

    return (
      available.find(selection => selection.type === 'use-skill') ??
      available.find(selection => selection.type === 'switch-pet') ??
      available.find(selection => selection.type === 'do-nothing') ??
      available.find(selection => selection.type === 'team-selection') ??
      available[0]
    )
  }

  private pickSurrenderSelection(playerId: string, phase: DecisionPhase): PlayerSelection {
    const available = this.selectionSystem.getAvailableSelections(this.battle.world, playerId)
    if (available.length === 0) {
      throw new Error(`No available selections for player ${playerId} at phase ${phase}`)
    }
    return available.find(selection => selection.type === 'surrender') ?? available[0]
  }

  private describeSelection(selection: PlayerSelection): string {
    switch (selection.type) {
      case 'use-skill':
        return `使用技能 ${selection.skill}`
      case 'switch-pet':
        return `切换精灵 ${selection.pet}`
      case 'do-nothing':
        return '什么都不做'
      case 'surrender':
        return '投降'
      case 'team-selection':
        return `队伍选择 (${selection.selectedPets.length})`
      default:
        return 'unknown'
    }
  }

  private resolveProvider(playerId: string): DecisionProvider {
    const spec = this.getProviderSpec(playerId)
    if (!spec || spec.type === 'human') return new HumanDecisionProvider()
    if (spec.type === 'rule') return new RuleDecisionProvider(spec.strategy ?? 'simple')

    const cfg = this.getDecisionConfig()
    const factory = cfg.registry?.[spec.key]
    if (!factory) {
      throw new Error(`Custom decision provider not found: ${spec.key}`)
    }
    return factory(spec.options)
  }

  private getProviderSpec(playerId: string): DecisionProviderSpec | undefined {
    const cfg = this.getDecisionConfig()
    if (cfg.playerA || cfg.playerB) {
      const slot = this.getPlayerSlot(playerId)
      if (!slot) return { type: 'human' }
      return slot === 'playerA' ? cfg.playerA : cfg.playerB
    }

    // Legacy ai config fallback
    const legacyAi = this.battle.config.ai
    if (legacyAi?.enabled === true) {
      const slot = this.getPlayerSlot(playerId)
      const players = new Set(legacyAi.players ?? ['playerB'])
      if (slot && players.has(slot)) {
        return { type: 'rule', strategy: legacyAi.strategy ?? 'simple' }
      }
    }

    return { type: 'human' }
  }

  private getDecisionConfig(): DecisionConfig {
    return (this.battle.config as { decision?: DecisionConfig }).decision ?? {}
  }

  private getPlayerSlot(playerId: string): PlayerSlot | null {
    const playerAId = this.battle.world.state.playerAId as string
    const playerBId = this.battle.world.state.playerBId as string
    if (playerId === playerAId) return 'playerA'
    if (playerId === playerBId) return 'playerB'
    return null
  }
}
