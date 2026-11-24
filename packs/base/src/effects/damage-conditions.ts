import { contexts, DamageType } from '@arcadia-eternity/battle/authoring'

export function isPhysicalOrSpecial(type: DamageType) {
  return type === DamageType.Physical || type === DamageType.Special
}

export const physicalOrSpecialDamage = contexts.damage.condition((_, events) =>
  events.some(event => isPhysicalOrSpecial(event.damageType)),
)
export const nonEffectStrikeDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.origin.trigger !== 'effect' && isPhysicalOrSpecial(event.damageType)),
)
export const physicalDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Physical),
)
export const specialDamage = contexts.damage.condition((_, events) =>
  events.some(event => event.damageType === DamageType.Special),
)
export const criticalDamage = contexts.damage.condition((_, events) => events.some(event => event.crit))
