import { SynchronousPhase } from './base'
import type { DamageContext } from '../context'
import type { Battle } from '../battle'
import { resolveDamage } from '../eventResolver'

/** A single execution/cleanup scope, including all synchronous result reactions. */
export class DamagePhase extends SynchronousPhase<DamageContext> {
  constructor(
    battle: Battle,
    private readonly proposal: DamageContext,
  ) {
    super(battle)
  }

  protected createContext(): DamageContext {
    return this.proposal
  }

  protected executeOperation(): void {
    resolveDamage(this.proposal)
  }
}
