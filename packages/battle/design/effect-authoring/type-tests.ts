/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unused-expressions -- Compile-only positive and negative type assertions intentionally do not execute. */
/** Compile only. @ts-expect-error must fail if its misuse ever becomes accepted. */
import type { DamageContext, UseSkillContext } from '../../src/v4/context'
import type { Pet } from '../../src/v4/pet'
import type { MarkInstance } from '../../src/v4/mark'
import {
  actions,
  bindings,
  selectFrom,
  booleanParam,
  contexts,
  defineEffect,
  numberParam,
  ops,
  targets,
  values,
  type Action,
  type BindingValue,
  type EffectFrame,
  type Selector,
  type Value,
} from './api'
import { consumeFantasyForDefense } from './examples/fantasy-defense'
import { damageBoostByHp } from './examples/damage-by-hp'
import { timeRebirth } from './examples/time-rebirth'
import {
  capturedInstancePenalty,
  entryStackPenalty,
  followingInstancePenalty,
  weaknessSpeedPenalty,
} from './examples/weakness-speed'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
function exact<T extends true>(_value: T): void {}

// Positive inference tests also guard against accidental `any` or widening to every event.
export type ExampleInference = [
  Expect<Equal<Parameters<typeof consumeFantasyForDefense.execute>[0]['event'], UseSkillContext>>,
  Expect<Equal<Parameters<typeof damageBoostByHp.execute>[0]['event'], DamageContext>>,
  Expect<Equal<Parameters<typeof timeRebirth.execute>[0]['event'], DamageContext>>,
  Expect<Equal<Parameters<typeof weaknessSpeedPenalty.execute>[0]['on'], 'OnMarkCreated'>>,
  Expect<Equal<typeof capturedInstancePenalty, BindingValue<number, 'optional'>>>,
  Expect<Equal<typeof followingInstancePenalty, typeof capturedInstancePenalty>>,
  Expect<Equal<typeof entryStackPenalty, typeof capturedInstancePenalty>>,
  Expect<Equal<typeof targets.ownerPet, Selector<Pet>>>,
  Expect<Equal<typeof targets.ownerMarks, Selector<MarkInstance>>>,
]

const hit = defineEffect({
  id: 'type-test/hit',
  on: 'OnHit',
  parameters: {
    chance: numberParam({ default: 20, tags: ['skill_effect_probability'] }),
    enabled: booleanParam({ default: true }),
  },
  when(ctx, params) {
    exact<Equal<typeof ctx.event, UseSkillContext>>(true)
    const enabled = ctx.read(params.enabled)
    exact<Equal<typeof enabled, boolean>>(true)
    return enabled
  },
  execute(ctx, params) {
    const chance = ctx.read(params.chance)
    exact<Equal<typeof chance, number>>(true)
    const owner = ctx.read(targets.ownerPet.first())
    exact<Equal<typeof owner, Pet | undefined>>(true)
    const skillUse = contexts.nearestSkillUse(ctx)
    exact<Equal<typeof skillUse, UseSkillContext | undefined>>(true)
    // @ts-expect-error A skill event is not a damage event.
    ctx.event.damageResult
    // @ts-expect-error Parameter names are inferred, not an open dictionary.
    params.missing
    // @ts-expect-error A required number parameter does not become a string.
    const bad: string = chance
    // @ts-expect-error Explicit optionality must be narrowed.
    owner.currentHp
    // @ts-expect-error Ancestor lookup is fallible.
    skillUse.skill
    // @ts-expect-error Selector collections cannot be silently read as scalar values.
    ctx.read(targets.ownerPet)
    // @ts-expect-error Persistent binding plans cannot be read as instantaneous values.
    ctx.read(capturedInstancePenalty)
    const branch = values.choose(
      () => true,
      1,
      values.choose(() => false, 2, 3),
    )
    exact<Equal<typeof branch, Value<number>>>(true)
    exact<Equal<ReturnType<typeof hit.execute>, void>>(true)
  },
})

// Conditional type correlation survives a union of triggers.
defineEffect({
  id: 'type-test/union',
  on: ['OnHit', 'OnDamage'],
  execute(ctx) {
    // @ts-expect-error Cannot access damage before narrowing the trigger.
    ctx.event.damageResult
    if (ctx.on === 'OnDamage') exact<Equal<typeof ctx.event, DamageContext>>(true)
    else exact<Equal<typeof ctx.event, UseSkillContext>>(true)
  },
})

// @ts-expect-error Unknown or undispatched trigger.
defineEffect({ id: 'invalid-trigger', on: 'ImaginaryTrigger', execute() {} })
// @ts-expect-error Values cannot be used as writable references.
targets.ownerPet.select(pet => pet.currentHp).apply(ops.assign(20))
// @ts-expect-error Arbitrary keys, including identity, are not writable fields.
targets.ownerPet.property('id')
// @ts-expect-error Pet write fields cannot be selected on a mark.
targets.ownerMarks.property('currentHp')
// @ts-expect-error Mark operations cannot be applied to pets.
targets.ownerPet.apply(ops.consumeStacks(1))
// @ts-expect-error Pet operations cannot be applied to marks.
targets.ownerMarks.apply(ops.heal(20))
// @ts-expect-error Attribute names are inferred from the input entity.
targets.ownerMarks.first().attribute('def')
// @ts-expect-error Unknown Pet attribute.
targets.ownerPet.first().attribute('notAnAttribute')
// @ts-expect-error Numeric operators cannot consume string-valued queries.
ops.heal(targets.ownerPet.select(pet => pet.name).first())
// @ts-expect-error Number defaults must be numbers.
numberParam({ default: '20' })
// @ts-expect-error Capture scope is bounded.
targets.ownerPet.first().capture({ key: 'owner', scope: 'forever' })

const unconfiguredStep = targets.ownerMarks.first().follow({ key: 'mark' }).attribute('stack')
ops.bindAttribute({
  key: 'incomplete',
  attribute: 'spe',
  operation: 'delta',
  lifetime: 'sourceMark',
  missing: 'detach',
  // @ts-expect-error A newly selected attribute must explicitly choose capture/follow.
  value: unconfiguredStep,
})
ops.bindAttribute({
  key: 'instant',
  attribute: 'spe',
  operation: 'delta',
  lifetime: 'sourceMark',
  missing: 'detach',
  // @ts-expect-error An instant value is not a persistent binding plan.
  value: targets.ownerPet.first().attribute('spe'),
})
ops.bindAttribute({
  key: 'string',
  attribute: 'spe',
  operation: 'delta',
  lifetime: 'sourceMark',
  missing: 'detach',
  // @ts-expect-error Numeric attribute modifiers require numeric binding values.
  value: capturedInstancePenalty.map(String),
})

const damageOnly: Action<'OnDamage'> = ctx => {
  ctx.event.damageResult
}
// @ts-expect-error A damage-only callback cannot run for every trigger.
const everyTrigger: Action = damageOnly
const damageSequence = actions.sequence(damageOnly)
exact<Equal<typeof damageSequence, Action<'OnDamage'>>>(true)
defineEffect({ id: 'damage-sequence', on: 'OnDamage', execute: damageSequence })
defineEffect({
  id: 'wrong-context',
  on: 'OnHit',
  // @ts-expect-error OnHit cannot run a damage-only callback.
  execute: damageOnly,
})

// This branch proves the event/frame itself does not lose the discriminant.
export function narrowFrame(ctx: EffectFrame<'OnHit' | 'OnDamage'>): void {
  if (ctx.on === 'OnHit') exact<Equal<typeof ctx.event, UseSkillContext>>(true)
}

const damageOperator = targets.ownerPet.apply((ctx: EffectFrame<'OnDamage'>, pets) => {
  exact<Equal<typeof pets, readonly Pet[]>>(true)
  ctx.event.damageResult
})
exact<Equal<typeof damageOperator, Action<'OnDamage'>>>(true)
defineEffect({
  id: 'wrong-selection-context',
  on: 'OnHit',
  // @ts-expect-error Applying a selector retains the operator's event requirement.
  execute: damageOperator,
})

const scalar = targets.ownerPet.select(pet => pet.currentHp).first()
// @ts-expect-error Scalar values do not acquire entity attributes.
scalar.attribute('stack')
const hp = targets.ownerPet
  .select(pet => pet.stat.maxHp)
  .first()
  .map(value => Math.floor(value / 4))
exact<Equal<typeof hp, Value<number, 'optional'>>>(true)
const petDefense = targets.ownerPet.first().attribute('def')
exact<Equal<typeof petDefense, Value<number, 'optional'>>>(true)

const specialDefense = targets.ownerPet.first().attribute('spd') // 特防
const speed = targets.ownerPet.first().attribute('spe') // 速度
exact<Equal<typeof specialDefense, Value<number, 'optional'>>>(true)
exact<Equal<typeof speed, Value<number, 'optional'>>>(true)
ops.changeStatStage('spd', 1)
ops.changeStatStage('spe', 1)
const capturedMark = targets.sourceMark.first().capture({ key: 'source', scope: 'binding' })
// @ts-expect-error Entity property reads must pass through an explicit temporal step.
capturedMark.map(mark => mark.stack)

exact<Equal<typeof contexts.damage, Selector<DamageContext>>>(true)
contexts.damage.apply(ops.modifyDamage({ percent: 10, delta: targets.ownerPet.first().attribute('maxHp') }))
// @ts-expect-error Damage operations require contexts, not pets.
targets.ownerPet.apply(ops.modifyDamage({ percent: 10, delta: 0 }))
// @ts-expect-error A persistent plan is not an action-time damage amount.
ops.modifyDamage({ percent: capturedInstancePenalty, delta: 0 })

const requiredSum = values.combine(numberParam({ default: 2 }), numberParam({ default: 3 }), (a, b) => a + b)
exact<Equal<typeof requiredSum, Value<number>>>(true)
const optionalSum = values.combine(
  targets.ownerPet.select(p => p.currentHp).first(),
  numberParam({ default: 3 }),
  (a, b) => a + b,
)
exact<Equal<typeof optionalSum, Value<number, 'optional'>>>(true)
// @ts-expect-error Persistent plans must not be consumed as immediate inputs.
values.combine(capturedInstancePenalty, numberParam({ default: 3 }), (a, b) => b)

contexts.heal.apply(ops.modifyHeal({ percent: 20, delta: 0 }))
// @ts-expect-error Healing modifiers require heal contexts.
contexts.damage.apply(ops.modifyHeal({ percent: 20, delta: 0 }))

const allStacks = targets.ownerMarks.select(mark => mark.stack).all()
exact<Equal<typeof allStacks, Value<readonly number[]>>>(true)
contexts.skillUse.apply(ops.addPower(allStacks))
contexts.skillUse.apply(ops.amplifyPower(numberParam({ default: 1.5 })))
// @ts-expect-error Power operations require skill contexts.
contexts.heal.apply(ops.addPower(20))
// @ts-expect-error Numeric collection, not pets.
contexts.skillUse.apply(ops.addPower(targets.ownerPet.all()))

const selectedBaseMark = targets.ownerMarks.select(mark => mark.base).first()
targets.ownerPet.apply(ops.addMark(selectedBaseMark, { stack: requiredSum, duration: optionalSum }))
contexts.battle.apply(ops.addMark(selectedBaseMark))
// @ts-expect-error Mark instances are not mark definitions.
ops.addMark(targets.sourceMark.first())
// @ts-expect-error Mark application requires an owner, not a skill context.
contexts.skillUse.apply(ops.addMark(selectedBaseMark))
// @ts-expect-error Persistent plans are not instant stack inputs.
ops.addMark(selectedBaseMark, { stack: capturedInstancePenalty })

ops.addMark(selectedBaseMark, { stack: targets.ownerPet.select(pet => pet.weight).first() })
// @ts-expect-error A nullable property is not a numeric mark option.
ops.addMark(selectedBaseMark, { stack: targets.ownerPet.select(() => null).first() })

const fieldMarks = contexts.battle.flatMap(battle => battle.marks)
exact<Equal<typeof fieldMarks, Selector<MarkInstance>>>(true)
const expandedNumbers = targets.ownerPet.flatMap(pet => [pet.currentHp, pet.stat.maxHp] as const).all()
exact<Equal<typeof expandedNumbers, Value<readonly number[]>>>(true)
// @ts-expect-error Collection expansion requires an array, not a scalar.
targets.ownerPet.flatMap(pet => pet.currentHp)

const randomNumbers = selectFrom([1, 2, 3] as const)
  .shuffled()
  .where(n => n > 1)
  .first()
exact<Equal<typeof randomNumbers, Value<1 | 2 | 3, 'optional'>>>(true)
const randomMarks = targets.ownerMarks
  .shuffled()
  .select(mark => mark.base)
  .first()
ops.addMark(randomMarks)
// @ts-expect-error A fixed selector needs a collection.
selectFrom(3)

const incomingPet = contexts.switchPet.select(event => event.switchInPet)
exact<Equal<typeof incomingPet, Selector<Pet>>>(true)
incomingPet.apply(ops.addMark(selectedBaseMark))
// @ts-expect-error Switch contexts are not mark owners; select the incoming pet first.
contexts.switchPet.apply(ops.addMark(selectedBaseMark))

const combinedBinding = bindings.combine(
  targets.sourceMark.first().capture({ key: 'source', scope: 'binding' }).attribute('stack').follow({ key: 'stack' }),
  numberParam({ default: 20 }).capture({ key: 'factor', scope: 'binding' }),
  (stack, factor) => stack * factor,
)
exact<Equal<typeof combinedBinding, BindingValue<number, 'optional'>>>(true)
// @ts-expect-error A persistent combination cannot return a domain entity.
bindings.combine(combinedBinding, combinedBinding, () => ({}))
// @ts-expect-error Immediate values must explicitly select capture or follow first.
bindings.combine(targets.sourceMark.first(), combinedBinding, () => 1)

const skillBinding = ops.bindSkillAttribute({
  key: 'skill-power',
  attribute: 'power',
  operation: 'delta',
  value: combinedBinding,
  stacking: 'append',
  lifetime: 'sourceMark',
  missing: 'detach',
})
targets.selfSkills.apply(skillBinding)
// @ts-expect-error Skill bindings cannot write Pet attributes.
targets.ownerPet.apply(skillBinding)
ops.bindSkillAttribute({
  key: 'invalid',
  // @ts-expect-error Defense belongs to Pet attributes, not skill attributes.
  attribute: 'def',
  operation: 'delta',
  value: combinedBinding,
  lifetime: 'sourceMark',
  missing: 'detach',
})

contexts.skillUse.property('priority').apply(ops.add(1))
contexts.skillUse.property('rage').apply(ops.assign(5))
// @ts-expect-error Skill context references are limited to the declared writable keys.
contexts.skillUse.property('power')
// @ts-expect-error A Pet is not a writable skill context.
targets.ownerPet.property('priority')
declare const mixedNumericTargets: Selector<Pet | UseSkillContext>
// @ts-expect-error Mixed targets cannot claim a key absent from some members.
mixedNumericTargets.property('priority')

declare const branchDamage: Action<'OnDamage'>
declare const branchHit: Action<'OnHit'>
actions.choose<'OnDamage'>(() => true, branchDamage)
// @ts-expect-error A branch action must accept the conditional action's trigger frame.
actions.choose<'OnDamage'>(() => true, branchDamage, branchHit)
// @ts-expect-error Branch conditions return boolean.
actions.choose(() => 1, branchDamage)

const randomAmount: Value<number> = values.randomInt(30, 70)
contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: randomAmount }))
// @ts-expect-error Random range bounds are numeric, not strings.
values.randomInt('30', 70)

contexts.rage.apply(ops.modifyRage({ percent: 20, delta: 0 }))
// @ts-expect-error A heal context is not a rage context.
contexts.heal.apply(ops.modifyRage({ percent: 20, delta: 0 }))

targets.selfSkills.apply(ops.setSkillSureHit(true))
targets.ownerPet.apply(ops.setRage(25))
targets.selfPlayer.apply(ops.setRage(25))
// @ts-expect-error Rage belongs to a pet's player, not a skill instance.
targets.selfSkills.apply(ops.setRage(25))
contexts.skillUse.apply(ops.setIgnoreShield())
// @ts-expect-error Shield bypass is a use-context flag, not a persistent skill assignment.
targets.selfSkills.apply(ops.setIgnoreShield())
// @ts-expect-error Persistent skill assignment does not accept a use context.
contexts.skillUse.apply(ops.setSkillSureHit(true))
// @ts-expect-error Skill flags require booleans.
ops.setSkillSureHit(1)

const consumptionEvent = defineEffect({
  id: 'type-test/consumption-context',
  on: 'OnBeforeConsumeStack',
  execute(ctx) {
    exact<Equal<typeof ctx.event, import('../../src/v4/context').ConsumeStackContext>>(true)
    contexts.consumeStack.apply(ops.disableContext())(ctx)
  },
})
contexts.rage.apply(ops.disableContext())
// @ts-expect-error Pet is not a cancellable context.
targets.ownerPet.apply(ops.disableContext())

const parameterContribution = targets.sourceMark
  .first()
  .capture({ key: 'mark', scope: 'binding' })
  .attribute('stack')
  .follow({ key: 'stack' })
targets.ownerPet.apply(
  ops.bindTaggedParameter({ key: 'probability', tag: 'chance', operation: 'delta', value: parameterContribution }),
)
ops.bindTaggedParameter({
  key: 'probability',
  tag: 'chance',
  operation: 'delta',
  // @ts-expect-error An immediate value must choose capture/follow before persistent installation.
  value: targets.sourceMark.first().attribute('stack'),
})
targets.sourceMark.apply(
  // @ts-expect-error Parameter scopes are pets or players, not marks.
  ops.bindTaggedParameter({ key: 'probability', tag: 'chance', operation: 'delta', value: parameterContribution }),
)

targets.opponentActive.apply(ops.executeKill())
// @ts-expect-error Execution accepts pets, not source marks.
targets.sourceMark.apply(ops.executeKill())

contexts.skillUse.apply(ops.setSkill(targets.selfAvailableSkills.shuffled().first(), true))
// @ts-expect-error Replacement requires a skill, not a pet.
ops.setSkill(targets.ownerPet.first(), true)
// @ts-expect-error setSkill mutates a skill-use context, not a skill instance.
targets.selfSkills.apply(ops.setSkill(targets.selfAvailableSkills.first()))
