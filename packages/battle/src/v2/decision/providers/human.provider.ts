import type { PlayerSelection } from '@arcadia-eternity/const'
import type { DecisionProvider, DecisionContext } from '../types.js'

const POLL_INTERVAL_MS = 25

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class HumanDecisionProvider implements DecisionProvider {
  readonly capabilities = ['public'] as const

  async decide(ctx: DecisionContext): Promise<PlayerSelection> {
    while (true) {
      if (ctx.abortSignal?.aborted) {
        throw new Error(`Decision cancelled for player ${ctx.playerId}`)
      }

      const picked = ctx.selectionSystem.getSelection(ctx.world, ctx.playerId)
      if (picked) return picked

      const status = String(ctx.world.state.status ?? '')
      if (status === 'ended') {
        throw new Error(`Battle ended while waiting for human selection: ${ctx.playerId}`)
      }

      await sleep(POLL_INTERVAL_MS)
    }
  }
}
