import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  Element,
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

const specs = {
  effect_ability_reduce_damage_10_percent_when_opponent_has_cuimian: -10,
  effect_mark_increase_self_element_damage_10_percent: 10,
  effect_mark_increase_self_element_damage_20_percent: 20,
} as const
type Id = keyof typeof specs
const ids = Object.keys(specs) as Id[]
const definitions = ['ability', 'mark'].flatMap(kind =>
  parse(readFileSync(new URL(`./fixtures/effect-regression/effect_${kind}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const originals = new Map(ids.map(id => [id, definitions.find(d => d.id === id)]))
function reference(id: Id) {
  const d = structuredClone(originals.get(id))
  if (specs[id] > 0) d.condition.conditions[1].target.base = 'usingSkillContext'
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
  'mismatch',
  'wrong-actor',
  'missing-support',
  'late-element',
  'late-support',
  'late-slot',
  'late-owner',
  'slot-before',
  'nested',
  'cancel',
  'repeat',
  'phase',
] as const
function run(id: Id, native: boolean, markSource: boolean, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(2023)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  const defensive = specs[id] < 0,
    owner = defensive ? b.activePet : a.activePet
  const mark = new BaseMark('fixture/element-source' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
  }).createInstance()
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  const source = markSource ? mark : owner.skills[0]
  source.effects.push(native ? generatedDamageModifierEffects[id] : oracles.get(id)!)
  const support = new BaseMark('mark_cuimian' as baseMarkId, [], debuff.config).createInstance()
  support.setOwner(a.activePet, battle.emitter)
  if (variant !== 'missing-support') a.activePet.marks.push(support)
  const actor = variant === 'wrong-actor' ? b : a
  const use = new UseSkillContext(
    new TurnContext(battle),
    actor,
    actor.activePet,
    AttackTargetOpinion.opponent,
    actor.activePet.skills[0],
  )
  use.element = variant === 'mismatch' ? Element.Fire : Element.Normal
  owner.element = Element.Normal
  const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeEffect, source) : use
  const damage = new DamageContext(parent, actor.activePet, b.activePet, 100)
  damage.damageType = DamageType.Physical
  if (variant === 'slot-before') a.activePet = a.team[1]
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/element-admission' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'cancel') (c.parent as EffectContext<EffectTrigger>).available = false
        if (variant === 'late-element') {
          use.element = Element.Fire
          owner.element = Element.Water
        }
        if (variant === 'late-support') a.activePet.marks = a.activePet.marks.filter(m => m !== support)
        if (variant === 'late-slot') a.activePet = a.team[1]
        if (variant === 'late-owner') source.owner = owner.owner!.team[1]
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
  if (specs[id] > 0)
    it(`${id}: C07 spelling repair`, () => {
      expect(() => EffectParser.parse(originals.get(id))).not.toThrow()
      const ledger = JSON.parse(
        readFileSync(
          new URL('../../../../docs/v4/validation/damage-modifiers-candidates.json', import.meta.url),
          'utf8',
        ),
      )
      expect(ledger.records.find((r: { id: string }) => r.id === id).recipe.selectorRepairs).toEqual([
        '/condition/conditions/1/target/base',
      ])
    })
  for (const markSource of [false, true])
    for (const variant of variants)
      it(`${id} markSource=${markSource} ${variant}`, () => {
        const actual = run(id, true, markSource, variant)
        expect(actual).toEqual(run(id, false, markSource, variant))
        const defensive = specs[id] < 0,
          eligible =
            variant !== 'wrong-actor' &&
            !(defensive ? ['missing-support', 'slot-before'].includes(variant) : variant === 'mismatch'),
          count = variant === 'repeat' ? 2 : 1
        expect(actual.admitted).toBe(eligible ? count : 0)
        expect(actual.modified).toEqual([eligible && variant !== 'cancel' ? specs[id] * count : 0, 0])
      }, 30000)
}
