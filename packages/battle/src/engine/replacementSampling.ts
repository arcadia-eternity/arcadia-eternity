import { EffectTrigger } from '@arcadia-eternity/const'
import type { Battle, BattleRng } from './battle'
import type { DamageContext, EffectContext } from './context'

/** Each physical source instance gets its own application of an authored rule. */
export function damageRuleId(context: EffectContext<EffectTrigger>): string {
  return JSON.stringify([context.source.id, context.effect?.id])
}

export function isReplacementTrigger(trigger: EffectTrigger): boolean {
  return trigger === EffectTrigger.OnDamageReplacement || trigger === EffectTrigger.Shield
}

interface SamplingScope {
  readonly samples: number[]
  index: number
}

const samplesByDamage = new WeakMap<DamageContext, Map<string, number[]>>()
const active = new WeakMap<Battle, SamplingScope>()

/** Rechecking a candidate after redirection reads the same random draws, while its target and amounts stay live. */
export function runReplacementSample<T>(
  context: EffectContext<EffectTrigger>,
  stage: 'when' | 'before' | 'apply' | 'after',
  run: () => T,
): T {
  if (!isReplacementTrigger(context.trigger) || context.parent.type !== 'damage') return run()
  const damage = context.parent as DamageContext
  let candidates = samplesByDamage.get(damage)
  if (!candidates) samplesByDamage.set(damage, (candidates = new Map()))
  const key = JSON.stringify([context.source.id, context.effect?.id, context.trigger, stage])
  let samples = candidates.get(key)
  if (!samples) candidates.set(key, (samples = []))
  const previous = active.get(context.battle)
  active.set(context.battle, { samples, index: 0 })
  try {
    return run()
  } finally {
    if (previous) active.set(context.battle, previous)
    else active.delete(context.battle)
  }
}

export function sampleBattleRandom(battle: Battle, rng: BattleRng): number {
  const scope = active.get(battle)
  if (!scope) return rng.next()
  if (scope.index === scope.samples.length) scope.samples.push(rng.next())
  return scope.samples[scope.index++]
}

export function sampleBattleInteger(battle: Battle, rng: BattleRng, min: number, max: number): number {
  if (!active.has(battle)) return rng.nextInt(min, max)
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max || !Number.isSafeInteger(max - min + 1))
    throw new Error('Invalid RNG integer range')
  return min + Math.floor(sampleBattleRandom(battle, rng) * (max - min + 1))
}
