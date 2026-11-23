import {
  Category,
  DamageType,
  ELEMENT_CHART,
  elementMultiplier,
  type Element,
  type IgnoreStageStrategy,
} from '@arcadia-eternity/const'
import { DamageContext, UseSkillContext, type EffectContext } from './context'
import type { EffectTrigger } from '@arcadia-eternity/const'
import type { DamageOrigin } from './damageResolution'
import type { SkillInstance } from './skill'
import type { Battle } from './battle'
import type { Pet } from './pet'

export interface SkillDamageFormula {
  category: Category
  power: number
  element: Element
  ignoreStageStrategy: IgnoreStageStrategy
  crit: boolean
  stabMultiplier: number
  critMultiplier: number
}

/** A one-shot view of the current combatants, shared by immediate hits and mark expiry. */
export function calculateSkillDamage(battle: Battle, attacker: Pet, target: Pet, formula: SkillDamageFormula) {
  const attack = attacker.actualStat
  const defense = target.getEffectiveStat(false, formula.ignoreStageStrategy)
  const physical =
    formula.category === Category.Physical || (formula.category === Category.Climax && attack.atk > attack.spa)
  const ratio = physical ? attack.atk / defense.def : attack.spa / defense.spd
  const damageType = physical ? DamageType.Physical : DamageType.Special
  const typeMultiplier = elementMultiplier(battle.elementMultipliers ?? ELEMENT_CHART, formula.element, target.element)
  const base = Math.floor((((2 * target.level) / 5 + 2) * formula.power * ratio) / 50 + 2)
  const stab = attacker.element === formula.element ? formula.stabMultiplier : 1
  const critical = formula.crit ? formula.critMultiplier : 1
  return {
    damageType,
    typeMultiplier,
    baseDamage: Math.floor(base * typeMultiplier * stab * critical),
    randomFactor: battle.random() * 0.15 + 0.85,
  }
}

/** Construct one skill-formula strike; the parent can equally be an identity-bearing mark expiry. */
export function makeSkillDamageContext(
  parent: UseSkillContext | EffectContext<EffectTrigger>,
  skill: SkillInstance,
  target: Pet,
  hit: ReturnType<typeof calculateSkillDamage> & Pick<UseSkillContext, 'crit' | 'ignoreShield' | 'element'>,
  origin?: DamageOrigin,
): DamageContext {
  const proposal = new DamageContext(
    parent,
    skill,
    target,
    hit.baseDamage,
    hit.damageType,
    hit.crit,
    hit.typeMultiplier,
    hit.ignoreShield,
    hit.randomFactor,
    undefined,
    undefined,
    undefined,
    hit.element,
    origin,
  )
  if (parent instanceof UseSkillContext) {
    for (const { sourceId, delta } of parent.paidDamageBonuses.splice(0)) proposal.addModified(0, delta, sourceId)
  }
  return proposal
}
