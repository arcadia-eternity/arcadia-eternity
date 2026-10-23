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
  'effect_ability_damage_boost_10_percent_when_first',
  'effect_ability_damage_reduction_10_percent_when_last',
  'effect_skill_damage_increase_30_percent_if_first',
  'effect_skill_damage_increase_30_percent_if_last',
  'effect_skill_add_fixed_damage_50_if_first',
  'effect_skill_add_fixed_damage_50_if_last',
  'effect_skill_add_damage_50_percent_if_last',
] as const
type Id = (typeof ids)[number]
const definitions = ['ability', 'skill'].flatMap(kind =>
  parse(readFileSync(new URL(`./fixtures/effect-regression/effect_${kind}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const originals = new Map(ids.map(id => [id, definitions.find(d => d.id === id)]))
const oracles = new Map(ids.map(id => [id, EffectParser.parse(originals.get(id))]))
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
const variants = ['first', 'last', 'empty-order', 'nested', 'wrong-owner', 'cancel', 'phase', 'repeat'] as const
function run(id: Id, native: boolean, markSource: boolean, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(2019)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const defensive = id === 'effect_ability_damage_reduction_10_percent_when_last'
  const owner = defensive ? b.activePet : a.activePet
  const mark = new BaseMark('fixture/damage-order' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
  }).createInstance()
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  const source = markSource ? mark : owner.skills[0]
  source.effects.push(native ? generatedDamageModifierEffects[id] : oracles.get(id)!)
  const turn = new TurnContext(battle)
  const use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, a.activePet.skills[0])
  const rival = new UseSkillContext(turn, b, b.activePet, AttackTargetOpinion.opponent, b.activePet.skills[0])
  const order = variant === 'last' ? [rival, use] : [use, rival]
  if (variant !== 'empty-order') {
    turn.appledContexts.push(...order)
    turn.contexts.push(...[...order].reverse())
  }
  const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeEffect, source) : use
  const damage = new DamageContext(parent, a.activePet, b.activePet, 100)
  damage.damageType = DamageType.Physical
  if (variant === 'wrong-owner') source.owner = owner.owner!.team[1]
  let admitted = 0
  a.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/damage-order-admission' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'cancel') (c.parent as EffectContext<EffectTrigger>).available = false
      },
    }),
  )
  if (variant === 'phase') b.activePet.damage(damage)
  else {
    battle.applyEffects(damage, originals.get(id).trigger as EffectTrigger.OnDamage, source)
    if (variant === 'repeat') battle.applyEffects(damage, originals.get(id).trigger as EffectTrigger.OnDamage, source)
  }
  return {
    modified: damage.modified,
    admitted,
    result: damage.damageResult,
    hp: b.activePet.currentHp,
    next: battle.random(),
  }
}
for (const id of ids)
  for (const markSource of [false, true])
    for (const variant of variants)
      it(`${id} markSource=${markSource} ${variant}`, () => {
        const actual = run(id, true, markSource, variant)
        expect(actual).toEqual(run(id, false, markSource, variant))
        const first = variant !== 'empty-order' && variant !== 'last'
        const last = variant === 'last'
        const defensive = id === 'effect_ability_damage_reduction_10_percent_when_last'
        const eligible = variant !== 'wrong-owner' && (defensive ? !last : id.endsWith('_first') ? first : last)
        const count = variant === 'repeat' ? 2 : 1
        expect(actual.admitted).toBe(eligible ? count : 0)
        const applied = eligible && variant !== 'cancel' ? count : 0
        const fixed = id.includes('fixed_damage')
        const percent = defensive ? -10 : id.includes('boost_10') ? 10 : id.includes('50_percent') ? 50 : 30
        expect(actual.modified).toEqual([!fixed && applied ? percent * applied : 0, fixed ? 50 * applied : 0])
      }, 30000)
