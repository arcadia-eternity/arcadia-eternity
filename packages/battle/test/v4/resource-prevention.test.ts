import {
  AttackTargetOpinion,
  BaseMark,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { createResourcePrevention } from '@arcadia-eternity/data-pack-base/native'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'

const candidates = createResourcePrevention()
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
it('preventing automatic consumption does not cancel the effect body, and removal takes effect on the next use', () => {
  const { battle, a, b, debuff } = makeScenario(742)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const protector = new BaseMark(
    'fixture/protector' as baseMarkId,
    [candidates.effect_mark_zhenshihuanxiang_prevent_consume],
    debuff.config,
  ).createInstance()
  const fantasy = new BaseMark('mark_huanxiang' as baseMarkId, [], { ...debuff.config, maxStacks: 20 }).createInstance()
  for (const mark of [protector, fantasy]) {
    mark.setOwner(a.activePet, battle.emitter)
    a.activePet.marks.push(mark)
  }
  fantasy.stack = 5
  let executions = 0
  fantasy.effects.push(
    defineNativeEffect({
      id: 'fixture/auto-consumer' as effectId,
      triggers: [EffectTrigger.OnHit],
      consumesStacks: 2,
      apply() {
        executions++
      },
    }),
  )
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    a.activePet,
    AttackTargetOpinion.opponent,
    a.activePet.skills[0],
  )
  battle.applyEffects(use, EffectTrigger.OnHit, fantasy)
  expect(fantasy.stack).toBe(5)
  expect(executions).toBe(1)
  protector.isActive = false
  battle.applyEffects(use, EffectTrigger.OnHit, fantasy)
  expect(fantasy.stack).toBe(3)
  expect(executions).toBe(2)
})
