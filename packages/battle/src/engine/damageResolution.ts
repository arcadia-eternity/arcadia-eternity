import type { DamageIntent, DamageResult, DamageTraceEntry, EffectTrigger } from '@arcadia-eternity/const'
import type { DamageContext, EffectContext } from './context'
import type { Pet } from './pet'
import type { MarkInstance } from './mark'
import { DamagePayments } from './damagePayments'
import { evaluateEventMagnitude, type NumericModifierTerm } from './modifierMath'

export type { DamageOrigin, DamagePolicy, DamageIntent, DamageResult, DamageTraceEntry } from '@arcadia-eternity/const'

export interface DamageRule {
  readonly id: string
  readonly priority?: number
  readonly target?: Pet
  readonly cost?: { readonly mark: MarkInstance; readonly stacks: number | 'all' }
  readonly change:
    | { readonly kind: 'redirect'; readonly target: Pet }
    | { readonly kind: 'prevent'; readonly amount?: number; readonly fraction?: number }
    | { readonly kind: 'survive'; readonly hp: number }
    | { readonly kind: 'heal'; readonly source: EffectContext<EffectTrigger>; readonly fraction?: number }
}

export function damagePoints(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error('Damage amount must be finite')
  return Math.max(0, Math.floor(amount))
}

/** Exists for one proposal only. Persistent rules live on their skill or mark. */
export class DamageResolution {
  readonly payments: DamagePayments
  readonly applied = new Set<string>()
  readonly candidates = new Map<string, DamageRule>()
  readonly trace: DamageTraceEntry[] = []
  readonly modifiers: NumericModifierTerm[] = []
  remaining?: number
  intent?: DamageIntent
  result?: DamageResult

  constructor(readonly context: DamageContext) {
    this.payments = new DamagePayments(context)
  }

  assertOpen(): void {
    if (this.result) throw new Error('Damage already resolved')
  }

  evaluate(): number {
    return damagePoints(evaluateEventMagnitude(this.context.baseDamage * this.context.randomFactor, this.modifiers))
  }

  addModifiers(id: string, terms: NumericModifierTerm[]): void {
    this.assertOpen()
    if (this.remaining !== undefined) throw new Error('Damage modifiers have already been evaluated')
    if (terms.some(term => !Number.isFinite(term.value))) throw new Error('Damage modifier must be finite')
    const before = this.evaluate()
    this.modifiers.push(...terms)
    this.record('modifier', id, before, this.evaluate())
  }

  record(kind: DamageTraceEntry['kind'], id: string, before: number, after: number): void {
    this.trace.push(Object.freeze({ kind, id, targetId: this.context.target.id, before, after }))
  }

  addRule(rule: DamageRule): void {
    this.assertOpen()
    if (!rule.id || !Number.isFinite(rule.priority ?? 0)) throw new Error('Invalid damage rule')
    if (!this.applied.has(rule.id) && !this.candidates.has(rule.id))
      this.candidates.set(rule.id, { ...rule, target: rule.target ?? this.context.target })
  }

  savepoint(): () => void {
    const terms = this.modifiers.length
    const trace = this.trace.length
    const candidates = new Map(this.candidates)
    const restore = this.payments.savepoint()
    return () => {
      this.modifiers.length = terms
      this.trace.length = trace
      this.candidates.clear()
      for (const [id, rule] of candidates) this.candidates.set(id, rule)
      restore()
    }
  }
}
