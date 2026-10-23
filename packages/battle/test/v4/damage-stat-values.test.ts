import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  DamageType,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedDamageModifierEffects } from '@arcadia-eternity/data-pack-base/native'

const ids = [
  'effect_skill_add_damage_spa_sixth',
  'effect_skill_fixed_damage_with_qianggong_stack_if_atk_over_500',
] as const
type Id = (typeof ids)[number]
const definitions = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const originals = new Map(ids.map(id => [id, definitions.find((d: { id: string }) => d.id === id)]))
function reference(id: Id) {
  const d = structuredClone(originals.get(id))
  if (id === ids[0]) d.apply.delta.selector.chain[0].arg.arg = 'stat.spa'
  else d.condition.conditions[1].target.chain[0].arg = 'stat.atk'
  return d
}
const oracles = new Map(ids.map(id => [id, EffectParser.parse(reference(id))]))
const battles: Battle[] = [],
  errors: unknown[][] = []
beforeAll(() =>
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      errors.push(args)
    },
  }),
)
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  expect(errors.splice(0)).toEqual([])
})
const variants = [
  'normal',
  'other-stats',
  'boundary500',
  'boundary501',
  'late-stat',
  'late-stack',
  'late-support',
  'late-owner',
  'wrong-owner',
  'cancel',
  'repeat',
  'phase',
] as const
function run(id: Id, native: boolean, markSource: boolean, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(2021)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const s of pet.skills) s.effects.splice(0)
  a.activePet.attributeSystem.updateBaseValue('atk', variant === 'boundary500' ? 500 : 601)
  if (variant === 'boundary501') a.activePet.attributeSystem.updateBaseValue('atk', 501)
  a.activePet.attributeSystem.updateBaseValue('spa', 601)
  a.team[1].attributeSystem.updateBaseValue('spa', 1205)
  if (variant === 'other-stats') {
    a.activePet.attributeSystem.updateBaseValue('spd', 1200)
    a.activePet.attributeSystem.updateBaseValue('spe', 2400)
  }
  function mark(pet: typeof a.activePet, id: string, stack: number) {
    const m = new BaseMark(id as baseMarkId, [], { ...debuff.config, maxStacks: 30, persistent: true }).createInstance()
    m.stack = stack
    m.setOwner(pet, battle.emitter)
    pet.marks.push(m)
    return m
  }
  const support = mark(a.activePet, 'mark_qianggong', 3)
  mark(a.activePet, 'mark_qianggong', 11)
  mark(a.team[1], 'mark_qianggong', 9)
  const sourceMark = mark(a.activePet, 'fixture/stat-value-source', 1),
    source = markSource ? sourceMark : a.activePet.skills[0]
  source.effects.push(native ? generatedDamageModifierEffects[id] : oracles.get(id)!)
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    a.activePet,
    AttackTargetOpinion.opponent,
    a.activePet.skills[0],
  )
  const damage = new DamageContext(use, a.activePet, b.activePet, 100)
  damage.damageType = DamageType.Special
  if (variant === 'wrong-owner') source.owner = a.team[1]
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/stat-value-admission' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'cancel') (c.parent as EffectContext<EffectTrigger>).available = false
        if (variant === 'late-stat') {
          a.activePet.attributeSystem.updateBaseValue('spa', 1205)
          a.activePet.attributeSystem.updateBaseValue('atk', 100)
        }
        if (variant === 'late-stack') support.stack = 5
        if (variant === 'late-support') a.activePet.marks = a.activePet.marks.filter(m => m.baseId !== 'mark_qianggong')
        if (variant === 'late-owner') source.owner = a.team[1]
      },
    }),
  )
  if (variant === 'phase') b.activePet.damage(damage)
  else {
    battle.applyEffects(damage, originals.get(id).trigger as EffectTrigger.OnDamage, source)
    if (variant === 'repeat') battle.applyEffects(damage, originals.get(id).trigger as EffectTrigger.OnDamage, source)
  }
  return {
    admitted,
    modified: damage.modified,
    result: damage.damageResult,
    hp: b.activePet.currentHp,
    next: battle.random(),
  }
}
for (const id of ids) {
  it(`${id}: exact stat-path correction`, () => {
    expect(() => EffectParser.parse(originals.get(id))).toThrow()
    const ledger = JSON.parse(
      readFileSync(new URL('../../../../docs/v4/validation/damage-modifiers-candidates.json', import.meta.url), 'utf8'),
    )
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    expect(r.recipe.additionalDecisions).toEqual(['C09'])
    expect(r.recipe.pathRepairs).toEqual(
      id === ids[0]
        ? [{ path: '/apply/delta/selector/chain/0/arg/arg', before: 'spa', after: 'stat.spa' }]
        : [{ path: '/condition/conditions/1/target/chain/0/arg', before: 'atk', after: 'stat.atk' }],
    )
  })
  for (const markSource of [false, true])
    for (const variant of variants)
      it(`${id} markSource=${markSource} ${variant}`, () => {
        const actual = run(id, true, markSource, variant)
        expect(actual).toEqual(run(id, false, markSource, variant))
        const stack = id === ids[1],
          eligible = variant !== 'wrong-owner' && !(stack && variant === 'boundary500'),
          count = variant === 'repeat' ? 2 : 1
        expect(actual.admitted).toBe(eligible ? count : 0)
        const delta = stack
          ? variant === 'late-support'
            ? 0
            : variant === 'late-owner'
              ? 315
              : variant === 'late-stack'
                ? 175
                : 105
          : ['late-owner', 'late-stat'].includes(variant)
            ? 200
            : 100
        expect(actual.modified).toEqual([0, eligible && variant !== 'cancel' ? delta * count : 0])
      }, 30000)
}

for (const variant of ['missing-weight', 'zero-weight', 'reactive-stack'] as const)
  it(`records unmapped legacy numeric behavior: ${variant}`, () => {
    const { battle, a, b, debuff } = makeScenario(2022)
    battles.push(battle)
    for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
    const reactive = variant === 'reactive-stack'
    const sourceMark = new BaseMark('fixture/unmapped-stack' as baseMarkId, [], {
      ...debuff.config,
      maxStacks: 20,
    }).createInstance()
    const source = reactive ? sourceMark : a.activePet.skills[0]
    if (reactive) {
      sourceMark.setOwner(b.activePet, battle.emitter)
      b.activePet.marks.push(sourceMark)
      sourceMark.stack = 7
    } else
      Object.defineProperty(a.activePet, 'weight', {
        value: variant === 'zero-weight' ? 0 : undefined,
        configurable: true,
      })
    const sourceDefinitions = reactive
      ? parse(readFileSync(new URL('./fixtures/effect-regression/effect_mark.yaml', import.meta.url), 'utf8'), {
          merge: true,
        })
      : definitions
    const definition = sourceDefinitions.find(
      (d: { id: string }) =>
        d.id === (reactive ? 'effect_mark_special_damage_reduction_with_stack' : 'effect_skill_fixed_damage_by_weight'),
    )
    source.effects.push(EffectParser.parse(definition))
    const use = new UseSkillContext(
      new TurnContext(battle),
      a,
      a.activePet,
      AttackTargetOpinion.opponent,
      a.activePet.skills[0],
    )
    const damage = new DamageContext(use, a.activePet, b.activePet, 100)
    damage.damageType = DamageType.Special
    battle.applyEffects(damage, definition.trigger, source)
    damage.updateDamageResult()
    if (variant === 'zero-weight') {
      expect(damage.modified).toEqual([0, 0])
      expect(damage.damageResult).toBe(100)
    } else {
      expect(Number.isNaN(damage.damageResult)).toBe(true)
      if (reactive) expect(typeof damage.modified[1]).toBe('string')
      else expect(Number.isNaN(damage.modified[1])).toBe(true)
    }
  })
