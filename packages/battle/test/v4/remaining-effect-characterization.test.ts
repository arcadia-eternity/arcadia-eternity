import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  DamageContext,
  DamageType,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  RageContext,
  RagePhase,
  SwitchPetPhase,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const definitions = ['mark', 'skill', 'ability'].flatMap(kind =>
  parse(readFileSync(new URL(`../../../../packs/base/data/effect_${kind}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const definition = (id: string) => definitions.find((d: { id: string }) => d.id === id)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture(id: string, opponent = false) {
  const f = makeScenario()
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = opponent ? f.b.activePet : f.a.activePet
  const source = new BaseMark('fixture/remaining' as baseMarkId, [EffectParser.parse(definition(id))], {
    ...f.debuff.config,
    maxStacks: 10,
    persistent: true,
    duration: -1,
    keepOnSwitchOut: true,
  }).createInstance({ stack: 3 })
  source.setOwner(owner, f.battle.emitter)
  owner.marks.push(source)
  const turn = new TurnContext(f.battle)
  const use = new UseSkillContext(turn, f.a, f.a.activePet, AttackTargetOpinion.opponent, f.a.activePet.skills[0])
  return { ...f, source, turn, use }
}
it('legacy special reduction passes a reactive object into numeric addition', () => {
  const f = fixture('effect_mark_special_damage_reduction_with_stack', true)
  const damage = new DamageContext(f.use, f.use.skill, f.b.activePet, 40, DamageType.Special)
  f.battle.applyEffects(damage, EffectTrigger.OnBeforeCalculateDamage, f.source)
  expect(typeof damage.modified[1]).toBe('string')
  expect(damage.modified[1]).toBe('0[object Object]')
  damage.updateDamageResult()
  expect(damage.damageResult).toBeNaN()
})
it('legacy inverse-current effect has no damage context at its skill-check trigger', () => {
  const f = fixture('effect_skill_add_damage_30_per_niliu')
  const current = new BaseMark('mark_niliu' as baseMarkId, [], { ...f.debuff.config, maxStacks: 10 }).createInstance({
    stack: 2,
  })
  current.setOwner(f.a.activePet, f.battle.emitter)
  f.a.activePet.marks.push(current)
  f.battle.applyEffects(f.use, EffectTrigger.AfterUseSkillCheck, f.source)
  const damage = new DamageContext(f.use, f.use.skill, f.b.activePet, 40, DamageType.Special)
  f.battle.applyEffects(damage, EffectTrigger.OnBeforeCalculateDamage, f.source)
  expect(damage.modified).toEqual([0, 0])
})
it('legacy rage cap is overwritten by subsequent rage computation', () => {
  const f = fixture('effect_mark_limit_rage_gain')
  f.a.settingRage(0)
  const event = new RageContext(f.use, f.a, 'damage', 'add', 20)
  event.rageChangeResult = 10
  f.battle.applyEffects(event, EffectTrigger.BeforeRageGain, f.source)
  expect(event.rageChangeResult).toBe(3)
  const phase = new RagePhase(f.battle, f.turn, f.a, 'effect', 'add', 20, false, [0, 0], undefined, event)
  phase.initialize()
  phase.execute()
  expect(event.rageChangeResult).toBe(20)
  expect(f.a.currentRage).toBe(20)
})
it('legacy switching directly reduces rage without offering the protection trigger', () => {
  const f = fixture('effect_mark_prevent_rage_loss_on_switch')
  f.a.settingRage(100)
  const phase = new SwitchPetPhase(f.battle, f.a, f.a.team[1], f.turn)
  phase.initialize()
  phase.execute()
  expect(f.a.currentRage).toBe(80)
  expect(f.source.isActive).toBe(true)
})
it('legacy flying ability cannot select an element from the unsupported lastSkillId path', () => {
  expect(() => EffectParser.parse(definition('effect_ability_add_20_rage_when_use_fly_skill_twice'))).toThrow()
})
