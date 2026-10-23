import { afterEach, expect, it } from 'vitest'
import {
  effectAuthoring,
  DamageContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { Operators } from '@arcadia-eternity/battle/v4/legacy'
import { makeScenario } from './scenario'
const battles: Battle[] = []
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
for (const variant of ['normal', 'empty', 'duplicate', 'foreign'] as const)
  it(`prevent damage ${variant}`, () => {
    const { battle, a, b } = makeScenario(902)
    battles.push(battle)
    const foreign = makeScenario(903)
    battles.push(foreign.battle)
    const source = a.activePet.skills[0]
    const ctx = new EffectContext<EffectTrigger>(new TurnContext(battle), EffectTrigger.TurnEnd, source)
    const damage = new DamageContext(ctx, source, b.activePet, 101)
    damage.damageResult = 81
    const other = new DamageContext(
      new EffectContext(new TurnContext(foreign.battle), EffectTrigger.TurnEnd, foreign.a.activePet.skills[0]),
      foreign.a.activePet.skills[0],
      foreign.b.activePet,
      1,
    )
    const selected =
      variant === 'empty'
        ? []
        : variant === 'duplicate'
          ? [damage, damage]
          : variant === 'foreign'
            ? [damage, other]
            : [damage]
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    const e = compileEffect(
      defineEffect({ id: 'fixture/prevent', on: 'TurnEnd', execute: selectFrom(selected).apply(ops.preventDamage()) }),
    )
    const apply = () =>
      battle.executionBudget.run(battle.currentTurn, () => {
        if (typeof e.apply !== 'function') throw new Error('Expected action')
        e.apply(ctx)
      })
    if (variant === 'foreign') {
      expect(apply).toThrow('Cross-battle damage context')
      expect(damage.available).toBe(true)
      expect(other.available).toBe(true)
    } else {
      apply()
      expect(damage.available).toBe(variant === 'empty')
      const result = damage.available
      damage.available = true
      Operators.preventDamage()(ctx, selected)
      expect(damage.available).toBe(result)
    }
    expect(damage.damageResult).toBe(81)
  })
