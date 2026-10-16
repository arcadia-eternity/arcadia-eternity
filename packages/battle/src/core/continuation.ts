import type { SkillContext } from './context.js'
import type { BattleAction } from './battle.js'

/** Persisted continuation, rather than a serialized call stack or host Promise. */
export type SkillPlan = Pick<
  SkillContext,
  | 'selectTarget'
  | 'available'
  | 'power'
  | 'accuracy'
  | 'rage'
  | 'category'
  | 'element'
  | 'priority'
  | 'ignoreStageStrategy'
  | 'petAccuracy'
  | 'critRate'
  | 'evasion'
  | 'ignoreShield'
  | 'multihit'
  | 'hitOverrides'
  | 'critOverrides'
> & { skillId: string }
export interface QueuedAction {
  action: BattleAction
  actorPetId: string
  skillPlan?: SkillPlan
}
export type PhaseKind = 'created' | 'selection' | 'turn-start' | 'action' | 'turn-end' | 'switch' | 'ended'
export class BattleContinuation {
  constructor(
    public kind: PhaseKind = 'created',
    public queue: QueuedAction[] = [],
    public pending: BattleAction[] = [],
    public forced: string[] = [],
    public reward: string | null = null,
  ) {}
  getState() {
    return { kind: this.kind, queue: this.queue, pending: this.pending, forced: this.forced, reward: this.reward }
  }
}
