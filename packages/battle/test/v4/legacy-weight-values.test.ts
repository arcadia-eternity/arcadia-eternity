import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  DamageContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const ids = [
  'effect_mark_reduce_damage_with_weight',
  'effect_skill_fixed_damage_by_weight',
  'effect_skill_damage_by_opponent_weight',
] as const
const definitions = ['mark', 'skill']
  .flatMap(kind =>
    parse(readFileSync(new URL(`../../../../packs/base/data/effect_${kind}.yaml`, import.meta.url), 'utf8'), {
      merge: true,
    }),
  )
  .filter((d: { id: string }) => ids.includes(d.id as (typeof ids)[number]))
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
for (const id of ids)
  for (const weight of [undefined, 0, 12.5])
    it(`${id} reads raw weight ${weight}`, () => {
      const { battle, a, b, debuff } = makeScenario()
      battles.push(battle)
      for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
      const owner = id.startsWith('effect_mark') ? b.activePet : a.activePet
      const queried = id === 'effect_skill_damage_by_opponent_weight' ? b.activePet : owner
      Object.defineProperty(queried, 'weight', { value: weight, configurable: true })
      queried.attributeSystem.updateBaseValue('weight', 99)
      const source = new BaseMark('fixture/weight-source' as baseMarkId, [], {
        ...debuff.config,
        maxStacks: 2,
      }).createInstance({ stack: 2 })
      source.setOwner(owner, battle.emitter)
      owner.marks.push(source)
      source.effects.push(EffectParser.parse(definitions.find((d: { id: string }) => d.id === id)))
      const use = new UseSkillContext(
        new TurnContext(battle),
        a,
        a.activePet,
        AttackTargetOpinion.opponent,
        a.activePet.skills[0],
      )
      const damage = new DamageContext(use, a.activePet, b.activePet, 83)
      battle.applyEffects(damage, EffectTrigger.OnBeforeCalculateDamage, source)
      expect(queried.stat.weight).toBe(99)
      expect(damage.modified[0]).toBe(0)
      if (weight === undefined) expect(damage.modified[1]).toBeNaN()
      else expect(damage.modified[1]).toBe(weight)
      expect(source.stack).toBe(id.startsWith('effect_mark') ? 1 : 2)
    })
