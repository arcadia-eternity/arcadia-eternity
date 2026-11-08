import {
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  effectAuthoring,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/engine'
import { afterEach, expect, it } from 'vitest'
import { makeScenario } from './scenario'
const battles: Battle[] = []
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
for (const variant of ['detached', 'other-unowned', 'foreign'] as const)
  it(`remove source ${variant}`, () => {
    const { battle, a, debuff } = makeScenario(1102)
    battles.push(battle)
    const foreign = makeScenario(1103)
    battles.push(foreign.battle)
    const base = new BaseMark('fixture/remove-detached' as baseMarkId, [], { ...debuff.config, duration: -1 })
    const source = base.createInstance()
    source.owner = a.activePet
    a.activePet.marks.push(source)
    const other = base.createInstance()
    if (variant === 'detached') source.owner = null
    if (variant === 'foreign') other.owner = foreign.a.activePet
    const ctx = new EffectContext<EffectTrigger>(new TurnContext(battle), EffectTrigger.TurnEnd, source)
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    const e = compileEffect(
      defineEffect({
        id: 'fixture/remove-detached',
        triggers: [EffectTrigger.TurnEnd],
        apply: selectFrom(variant === 'detached' ? [source] : [source, other]).apply(ops.removeMark()),
      }),
    )
    const apply = () =>
      battle.executionBudget.run(battle.currentTurn, () => {
        if (typeof e.apply !== 'function') throw new Error('Expected action')
        e.apply(ctx)
      })
    if (variant === 'detached') {
      apply()
      expect(source.isActive).toBe(false)
    } else {
      expect(apply).toThrow('Cross-battle or unowned write target')
      expect(source.isActive).toBe(true)
      expect(other.isActive).toBe(true)
    }
  })

for (const variant of [
  'initial-unowned',
  'foreign-after-read',
  'removed-after-read',
  'active-detached',
  'reuse',
] as const)
  it(`consumption snapshot ownership remains invocation-local: ${variant}`, () => {
    const { battle, a, debuff } = makeScenario(1302)
    battles.push(battle)
    const foreign = makeScenario(1303)
    battles.push(foreign.battle)
    const mark = new BaseMark('fixture/snapshot-consume' as baseMarkId, [], {
      ...debuff.config,
      maxStacks: 20,
    }).createInstance()
    mark.stack = 10
    mark.setOwner(a.activePet, battle.emitter)
    a.activePet.marks.push(mark)
    if (variant === 'initial-unowned') {
      mark.owner = null
      mark.isActive = false
    }
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    let reads = 0
    const amount = selectFrom([3])
      .select(n => {
        reads++
        if (variant === 'foreign-after-read') mark.owner = foreign.a.activePet
        if (['removed-after-read', 'active-detached', 'reuse'].includes(variant)) {
          mark.owner = null
          mark.isActive = variant === 'active-detached'
        }
        return n
      })
      .first()
    const effect = compileEffect(
      defineEffect({
        id: 'fixture/consume-snapshot',
        triggers: [EffectTrigger.TurnEnd],
        apply: selectFrom([mark]).apply(ops.consumeStacks(amount)),
      }),
    )
    const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.activePet.skills[0], effect)
    const apply = () => battle.executionBudget.run(battle.currentTurn, () => effect.innerApply(context))
    if (['removed-after-read', 'reuse'].includes(variant)) {
      apply()
      // Later V1 ignores inactive marks, including a mark removed during the amount read.
      expect(mark.stack).toBe(10)
      if (variant === 'reuse') {
        expect(apply).toThrow('Cross-battle or unowned write target')
        // Later V1 ignores inactive marks, including a mark removed during the amount read.
        expect(mark.stack).toBe(10)
        expect(reads).toBe(1)
      }
    } else {
      expect(apply).toThrow('Cross-battle or unowned write target')
      expect(mark.stack).toBe(10)
      if (variant === 'initial-unowned') expect(reads).toBe(0)
    }
  })
