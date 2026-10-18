import { Type } from '@sinclair/typebox'
import { EffectTrigger } from '@arcadia-eternity/const'
import { SkillInstance } from '../skill'
import { Pet } from '../pet'
import { ConfigModifierType } from '../config'
import { CapabilityRegistry, defineAction, definePredicate } from './capabilities'
import { defineTrigger } from './triggers'

const ratio = Type.Number({ minimum: 0, maximum: 1, default: 0.5 })
const amount = Type.Number({ minimum: 0, default: 90 })
const operations = [ConfigModifierType.delta, ConfigModifierType.override] as const

const selfSkillHit = defineTrigger({
  id: 'core.selfSkillHit',
  trigger: EffectTrigger.OnHit,
  params: Type.Object({}, { additionalProperties: false }),
  provides: { skill: ['ownerPet'], petMark: ['ownerPet'] },
  matches: context =>
    context.source.owner === context.parent.pet &&
    (!(context.source instanceof SkillInstance) || context.source === context.parent.skill),
  resolve: context => (context.source.owner instanceof Pet ? { ownerPet: context.source.owner } : {}),
})

const selfSkillHitTarget = defineTrigger({
  id: 'core.selfSkillHitTarget',
  trigger: EffectTrigger.OnHit,
  params: Type.Object({}, { additionalProperties: false }),
  provides: { skill: ['ownerPet', 'skillTarget'], petMark: ['ownerPet', 'skillTarget'] },
  matches: context =>
    context.source.owner === context.parent.pet &&
    (!(context.source instanceof SkillInstance) || context.source === context.parent.skill) &&
    context.parent.actualTarget instanceof Pet,
  resolve: context => ({
    ownerPet: context.source.owner instanceof Pet ? context.source.owner : undefined,
    skillTarget: context.parent.actualTarget,
  }),
})

const healOwner = defineAction({
  id: 'core.healOwner',
  needs: ['ownerPet'],
  params: Type.Object({ amount }, { additionalProperties: false }),
  publicParams: { amount: { effectiveSchema: amount, operations, tags: ['healing_amount'] } },
  execute: (context, args) => context.ops.heal(context.ownerPet, args.amount),
})
const healOwnerByMaxHp = defineAction({
  id: 'core.healOwnerByMaxHp',
  needs: ['ownerPet'],
  params: Type.Object({ ratio }, { additionalProperties: false }),
  publicParams: { ratio: { effectiveSchema: ratio, operations, tags: ['healing_ratio'] } },
  execute: (context, args) =>
    context.ops.heal(context.ownerPet, Math.floor(context.readMaxHp(context.ownerPet) * args.ratio)),
})
const ownerHpBelowRatio = definePredicate({
  id: 'core.ownerHpBelowRatio',
  needs: ['ownerPet'],
  params: Type.Object({ ratio }, { additionalProperties: false }),
  publicParams: { ratio: { effectiveSchema: ratio, operations, tags: ['hp_threshold'] } },
  test: (context, args) => context.ownerPet.currentHp < context.ownerPet.stat.maxHp * args.ratio,
})

/** Finite authoring vocabulary. Trusted hosts can combine these definitions with their own registry entries. */
export const coreCapabilities = Object.freeze({
  triggers: Object.freeze([selfSkillHit, selfSkillHitTarget]),
  actions: Object.freeze([healOwner, healOwnerByMaxHp]),
  predicates: Object.freeze([ownerHpBelowRatio]),
})
export function createCoreCapabilityRegistry(): CapabilityRegistry {
  return new CapabilityRegistry(coreCapabilities.actions, coreCapabilities)
}
