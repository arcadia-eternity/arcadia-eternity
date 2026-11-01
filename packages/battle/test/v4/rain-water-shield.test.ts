import {
  AttackTargetOpinion,
  BaseMark,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  effectAuthoring,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { createOfficialWaterShieldCandidate } from '@arcadia-eternity/data-pack-base/native'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
const alias = 'effect_skill_add_mark_shuiwenpingzhang.multiply_value'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
it('samples a scoped assignment once, rejects foreign writes, and validates base values', () => {
  const { battle, a, b, debuff } = makeScenario()
  const foreign = makeScenario()
  battles.push(battle, foreign.battle)
  const shield = createOfficialWaterShieldCandidate(
    new BaseMark('mark_shuiwenpingzhang' as baseMarkId, [], debuff.config),
  )
  shield.parameters.install(battle.configSystem)
  const { compileEffect, defineEffect, ops, values, targets } = effectAuthoring
  let reads = 0
  let checked = false
  const amount = values.choose(
    () => {
      reads++
      return true
    },
    2,
    1,
  )
  const assign = ops.setParameter(shield.parameters, alias, amount)
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/scoped-assignment',
      triggers: [EffectTrigger.BeforeHit],
      apply: ctx => {
        expect(() => assign(ctx, [a.activePet, foreign.a.activePet])).toThrow('Cross-battle')
        expect(reads).toBe(0)
        assign(ctx, [a.activePet, b.activePet])
        expect(reads).toBe(1)
        assign(ctx, [])
        expect(reads).toBe(2)
        ops.setParameter(
          shield.parameters,
          alias,
          targets.sourceMark.select(mark => mark.stack).first(),
        )(ctx, [a.activePet])
        expect(shield.parameters.read(battle.configSystem, alias, a.activePet)).toBe(2)
        expect(() => ops.setParameter(shield.parameters, alias, NaN)(ctx, [a.activePet])).toThrow()
        checked = true
      },
    }),
  )
  const source = a.activePet.skills[0]
  source.effects.splice(0, source.effects.length, effect)
  battle.applyEffects(
    new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, source),
    EffectTrigger.BeforeHit,
    source,
  )
  expect(checked).toBe(true)
  expect(shield.parameters.read(battle.configSystem, alias, b.activePet)).toBe(2)
  expect(() => shield.parameters.set(battle.configSystem, alias, 'bad', a.activePet)).toThrow('Invalid base')
  expect(() => shield.parameters.set(foreign.battle.configSystem, alias, 3)).toThrow('not installed')
})
