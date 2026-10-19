import { afterEach, expect, it } from 'vitest'
import {
  effectAuthoring,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { Operators } from '@arcadia-eternity/battle/v4/legacy'
import { makeScenario } from './scenario'
const battles: Battle[] = []
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
for (const variant of ['detached', 'other-unowned', 'foreign', 'reattach-foreign', 'detach-during-value'] as const)
  it(`consume source ${variant}`, () => {
    const { battle, a, debuff } = makeScenario(1002)
    battles.push(battle)
    const foreign = makeScenario(1003)
    battles.push(foreign.battle)
    const base = new BaseMark('fixture/consume' as baseMarkId, [], { ...debuff.config, maxStacks: 200, duration: -1 })
    const source = base.createInstance()
    source.stack = 150
    source.owner = a.activePet
    a.activePet.marks.push(source)
    const other = base.createInstance()
    other.stack = 150
    const ctx = new EffectContext<EffectTrigger>(new TurnContext(battle), EffectTrigger.TurnEnd, source)
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    if (variant === 'detached') source.owner = null
    if (variant === 'foreign') other.owner = foreign.a.activePet
    const selected = ['other-unowned', 'foreign'].includes(variant) ? [source, other] : [source]
    const amount = selectFrom([100])
      .select(n => {
        if (variant === 'reattach-foreign') source.owner = foreign.a.activePet
        if (variant === 'detach-during-value') source.owner = null
        return n
      })
      .first()
    const e = compileEffect(
      defineEffect({
        id: 'fixture/consume',
        on: 'TurnEnd',
        execute: selectFrom(selected).apply(ops.consumeStacks(amount)),
      }),
    )
    const apply = () =>
      battle.executionBudget.run(battle.currentTurn, () => {
        if (typeof e.apply !== 'function') throw new Error('Expected action')
        e.apply(ctx)
      })
    if (['detached', 'detach-during-value'].includes(variant)) {
      apply()
      expect(source.stack).toBe(50)
      source.stack = 150
      Operators.consumeStacks(100)(ctx, [source])
      expect(source.stack).toBe(50)
    } else {
      expect(apply).toThrow('Cross-battle or unowned write target')
      expect(source.stack).toBe(150)
      expect(other.stack).toBe(150)
    }
  })
