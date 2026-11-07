import type { Effect } from '../effect'
import type { EffectTrigger } from '@arcadia-eternity/const'

// Trusted contribution initializers are rebuilt by content loading, never read from saved data.
const initializers = new WeakSet<Effect<EffectTrigger>>()
export function registerOwnerContribution(effect: Effect<EffectTrigger>): void {
  initializers.add(effect)
}
export function isOwnerContribution(effect: Effect<EffectTrigger> | undefined): boolean {
  return !!effect && initializers.has(effect)
}
