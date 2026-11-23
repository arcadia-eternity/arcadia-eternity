import type { Category } from './category'
import type { DamageType } from './const'
import type { Element } from './element'

export interface DamageOrigin {
  readonly trigger: 'skill' | 'effect' | 'deferred'
  readonly executorId: string
  readonly petId?: string
  readonly skillId?: string
  readonly skillInstanceId?: string
  readonly skillCategory?: Category
  readonly skillElement?: Element
  readonly skillTags?: readonly string[]
  readonly hitCount?: number
  readonly holderId?: string
  readonly effectId?: string
  readonly causeId?: string
}

export interface DamagePolicy {
  readonly skillModifiers: boolean
  readonly shields: boolean
  readonly skillReactions: boolean
}

export interface DamageIntent {
  readonly id: string
  readonly targetId: string
  readonly baseDamage: number
  readonly randomFactor: number
  readonly crit: boolean
  readonly effectiveness: number
  readonly damageType: DamageType
  readonly element?: Element
  readonly origin: DamageOrigin
  readonly policy: DamagePolicy
}

export interface DamageTraceEntry {
  readonly kind: 'modifier' | 'redirect' | 'prevent' | 'survive' | 'heal' | 'shield'
  readonly id: string
  readonly targetId: string
  readonly before: number
  readonly after: number
}

export interface DamagePayment {
  readonly markId: string
  readonly stacks: number
  readonly reason: 'rule' | 'modifier' | 'shield'
}

export interface DamageResult {
  readonly id: string
  readonly causeId?: string
  readonly intent: DamageIntent
  readonly origin: DamageOrigin
  readonly targetId: string
  readonly status: 'committed' | 'replaced' | 'cancelled' | 'failed'
  readonly reason?: 'disabled' | 'target-defeated' | 'payment-unavailable' | 'reaction-cycle' | 'heal-failed'
  readonly originalDamage: number
  readonly modifiedDamage: number
  readonly preventedDamage: number
  readonly shieldAbsorbed: number
  /** Damage after prevention and shields, including overkill. */
  readonly dealtDamage: number
  readonly hpBefore: number
  readonly hpAfter: number
  readonly hpLoss: number
  readonly trace: readonly DamageTraceEntry[]
  readonly payments: readonly DamagePayment[]
}
