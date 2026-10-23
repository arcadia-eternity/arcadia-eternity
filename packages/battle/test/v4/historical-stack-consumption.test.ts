import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { BaseSelector, Conditions } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  ConsumeStackContext,
  EffectContext,
  RemoveMarkContext,
  EffectTrigger,
  TurnContext,
  defineNativeEffect,
  BattleMessageType,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'cancel',
  'reduce',
  'over-request',
  'deplete',
  'inactive',
  'post-mutate',
  'post-cancel',
  'remove-cancel',
] as const
for (const variant of variants)
  it(`historical consumption: ${variant}`, () => {
    const { battle, a, b, debuff } = makeScenario(713)
    battles.push(battle)
    for (const pet of [...a.team, ...b.team]) {
      pet.marks.splice(0)
      for (const skill of pet.skills) skill.effects.splice(0)
    }
    const mark = new BaseMark('fixture/consume' as baseMarkId, [], { ...debuff.config, maxStacks: 10 }).createInstance()
    mark.setOwner(a.activePet, battle.emitter)
    mark.stack = 3
    a.activePet.marks.push(mark)
    const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, mark)
    const trace: unknown[] = []
    let cleanups = 0
    mark.addAttributeModifierCleanup(() => cleanups++)
    a.activePet.skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/consume-observer' as effectId,
        triggers: [EffectTrigger.OnBeforeConsumeStack, EffectTrigger.OnConsumeStack, EffectTrigger.OnRemoveMark],
        apply: ctx => {
          if (ctx.parent instanceof ConsumeStackContext) {
            const c = ctx.parent
            trace.push([ctx.trigger, c.requestedAmount, c.actualAmount, mark.stack])
            expect(c.mark).toBe(mark)
            expect(battle.phaseManager.getCurrentPhase()).toBeDefined()
            if (ctx.trigger === EffectTrigger.OnBeforeConsumeStack) {
              expect(Conditions.checkSelf()(ctx)).toBe(true)
              expect(BaseSelector.consumeStackContext.selector(ctx)).toEqual([c])
              if (variant === 'cancel') c.available = false
              if (variant === 'reduce') c.setActualAmount(1)
              if (variant === 'over-request') c.setActualAmount(100)
            } else {
              if (variant === 'post-mutate') c.setActualAmount(0)
              if (variant === 'post-cancel') c.available = false
            }
          } else if (variant === 'remove-cancel' && ctx.parent instanceof RemoveMarkContext)
            ctx.parent.available = false
        },
      }),
    )
    battle.registerListener(message => {
      if (message.type === BattleMessageType.MarkUpdate && message.data.mark.id === mark.id)
        trace.push(['message', message.data.mark.stack])
    })
    if (variant === 'inactive') mark.isActive = false
    const requested = variant === 'deplete' || variant === 'remove-cancel' ? 5 : 2
    const result = mark.consumeStack(parent, requested)
    expect(battle.phaseManager.getCurrentPhase()).toBeUndefined()
    if (variant === 'inactive') {
      expect(result).toBe(0)
      expect(mark.stack).toBe(3)
      expect(trace).toEqual([])
    } else if (variant === 'cancel') {
      expect(result).toBe(0)
      expect(mark.stack).toBe(3)
      expect(trace).toEqual([[EffectTrigger.OnBeforeConsumeStack, 2, 2, 3]])
    } else {
      const consumed = variant === 'reduce' ? 1 : Math.min(requested, 3)
      expect(mark.stack).toBe(3 - consumed)
      // Later V1 caches the debit before OnConsumeStack; a post hook can change the reported amount only.
      expect(result).toBe(variant === 'post-mutate' ? 0 : consumed)
      expect(trace).toEqual([
        [EffectTrigger.OnBeforeConsumeStack, requested, requested, 3],
        [EffectTrigger.OnConsumeStack, requested, consumed, 3],
        ['message', 3 - consumed],
      ])
    }
    expect(cleanups).toBe(['deplete', 'remove-cancel'].includes(variant) ? 1 : 0)
    expect(mark.isActive).toBe(!['deplete', 'remove-cancel', 'inactive'].includes(variant))
  })

it('pins the operation body to the later V1 reference, including inactive-mark admission', () => {
  const source = readFileSync(new URL('../../src/v4/phase/consumeStack.ts', import.meta.url), 'utf8')
  const body = source.slice(source.indexOf('export function executeConsumeStackOperation')).replace(/\s+/g, '')
  expect(createHash('sha256').update(body).digest('hex')).toBe(
    '7085132089434118970ca7eba0b40f5aa4266261e3f052290b6311f7b82fb6cd',
  )
})
