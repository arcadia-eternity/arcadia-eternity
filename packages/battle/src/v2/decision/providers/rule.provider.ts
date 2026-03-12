import type { PlayerSelection, UseSkillSelection } from '@arcadia-eternity/const'
import type { DecisionProvider, DecisionContext, AiStrategy } from '../types.js'

function pickRandom<T>(items: T[], rng?: { next: () => number }): T {
  const idx = Math.floor((rng?.next() ?? Math.random()) * items.length)
  return items[Math.max(0, Math.min(idx, items.length - 1))]
}

export class RuleDecisionProvider implements DecisionProvider {
  readonly capabilities = ['public'] as const

  constructor(private strategy: AiStrategy = 'simple') {}

  async decide(ctx: DecisionContext): Promise<PlayerSelection> {
    const available = ctx.selectionSystem.getAvailableSelections(ctx.world, ctx.playerId)
    if (available.length === 0) {
      throw new Error(`No available selections for AI player ${ctx.playerId}`)
    }

    const existing = ctx.selectionSystem.getSelection(ctx.world, ctx.playerId)
    if (existing) return existing

    if (this.strategy === 'random') {
      const rng = (ctx.world.systems as { rng?: { next: () => number } })?.rng
      const pool = available.filter(a => a.type !== 'surrender')
      return pickRandom(pool.length > 0 ? pool : available, rng)
    }

    const teamSelection = available.find(a => a.type === 'team-selection')
    if (teamSelection) return teamSelection

    const skillActions = available.filter((a): a is UseSkillSelection => a.type === 'use-skill')
    if (skillActions.length > 0) {
      return skillActions[0]
    }

    const switchAction = available.find(a => a.type === 'switch-pet')
    if (switchAction) return switchAction

    const doNothing = available.find(a => a.type === 'do-nothing')
    if (doNothing) return doNothing

    return available[0]
  }
}
