import {
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  effectAuthoring,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
it('reuses nearest mark queries independently while admission keeps the direct-event boundary', () => {
  const { battle, a, debuff } = makeScenario()
  battles.push(battle)
  const skill = a.activePet.skills[0],
    observed: unknown[] = []
  const { compileEffect, defineEffect, contexts, conditions } = effectAuthoring
  const query = contexts.addMark.select(event => event.stack).first()
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/query',
      triggers: [EffectTrigger.TurnStart],
      apply(ctx) {
        observed.push(ctx.read(query), conditions.ownerAddsMark(ctx))
        const event = ctx.read(contexts.addMark.first())
        if (event) event.stack = 5
        observed.push(ctx.read(query))
      },
    }),
  )
  skill.effects.splice(0, skill.effects.length, effect)
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const event = new AddMarkContext(setup, a.activePet, debuff, 2)
  battle.applyEffects<EffectTrigger>(
    new EffectContext(event, EffectTrigger.BeforeEffect, skill),
    EffectTrigger.TurnStart,
    skill,
  )
  battle.applyEffects<EffectTrigger>(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  expect(observed).toEqual([2, false, 5, undefined, false, undefined])
})
