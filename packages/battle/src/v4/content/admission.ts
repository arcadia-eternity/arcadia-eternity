import type { EffectTrigger } from '@arcadia-eternity/const'
import type { Effect } from '../effect'

// Definition metadata only. Per-dispatch results belong to the collector, never this registry.
const singleAdmission = new WeakSet<Effect<EffectTrigger>>()
export function registerSingleAdmission(effect: Effect<EffectTrigger>): void {
  singleAdmission.add(effect)
}
export function usesSingleAdmission(effect: Effect<EffectTrigger>): boolean {
  return singleAdmission.has(effect)
}
