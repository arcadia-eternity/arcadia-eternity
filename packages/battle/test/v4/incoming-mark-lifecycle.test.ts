import { beforeAll, expect, it } from 'vitest'
import {
  AddMarkContext,
  AttributeSystem,
  BaseMark,
  BaseStatLevelMark,
  Effect,
  EffectContext,
  EffectTrigger,
  StackContext,
  StackStrategy,
  StatTypeWithoutHp,
  TurnContext,
  setGlobalLogger,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
it.each(['stack', 'none', 'remove', 'stage'] as const)(
  'cleans incoming %s mark attributes without assigning an owner',
  async variant => {
    const baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
    const { battle, a, debuff } = makeScenario()
    const observed: number[] = []
    const base =
      variant === 'stage'
        ? new BaseStatLevelMark(StatTypeWithoutHp.atk, 1, 'stat_stage_atk_up' as baseMarkId)
        : new BaseMark('fixture/incoming-lifetime' as baseMarkId, [], {
            ...debuff.config,
            maxStacks: 10,
            stackable: true,
            stackStrategy: StackStrategy[variant],
          })
    a.activePet.skills[0].effects.push(
      new Effect<EffectTrigger>(
        'fixture/incoming-owner' as effectId,
        [EffectTrigger.OnStackBefore],
        ctx => {
          if (!(ctx.parent instanceof StackContext)) throw new Error('Expected stack context')
          expect(ctx.parent.incomingMark.owner).toBeNull()
          observed.push(ctx.parent.incomingMark.stack)
        },
        0,
      ),
    )
    try {
      const turn = new TurnContext(battle)
      const setup = new EffectContext(turn, EffectTrigger.TurnStart, a.activePet.skills[0])
      battle.addMark(new AddMarkContext(setup, a.activePet, base, 1))
      battle.addMark(new AddMarkContext(setup, a.activePet, base, 1))
      if (variant === 'stack') expect(observed).toEqual([1])
      else expect(observed).toEqual([])
    } finally {
      await battle.cleanup()
    }
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  },
)
