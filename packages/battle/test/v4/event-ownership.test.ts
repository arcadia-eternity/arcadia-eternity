import { afterEach, beforeAll, expect, it } from 'vitest'
import { Conditions } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  AddMarkContext,
  DamageContext,
  HealContext,
  RageContext,
  StackContext,
  SwitchPetContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  StackStrategy,
  BaseMark,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
for (const kind of ['actor', 'recipient', 'global'] as const)
  it(`event ownership matches every legacy direct-context branch: ${kind}`, () => {
    const { battle, a, b, debuff } = makeScenario()
    battles.push(battle)
    const skill = a.activePet.skills[0],
      other = b.activePet.skills[0],
      turn = new TurnContext(battle)
    const use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
    const setup = new EffectContext(use, EffectTrigger.BeforeHit, other)
    const base = new BaseMark('fixture/ownership' as baseMarkId, [], debuff.config),
      mark = base.createInstance()
    mark.owner = b.activePet
    const add = new AddMarkContext(setup, b.activePet, base, 2)
    const global = base.createInstance()
    global.owner = battle
    const source = kind === 'actor' ? skill : kind === 'recipient' ? other : global
    const entries = [
      { parent: use, expected: kind === 'actor' },
      { parent: new DamageContext(use, skill, b.activePet, 1), expected: kind === 'recipient' },
      { parent: new HealContext(setup, other, b.activePet, 1), expected: kind === 'recipient' },
      { parent: new RageContext(use, b, 'damage', 'add', 1), expected: kind === 'recipient' },
      { parent: new RageContext(use, b, 'effect', 'add', 1), expected: false },
      { parent: setup, expected: kind === 'recipient' },
      { parent: new EffectContext(use, EffectTrigger.BeforeHit, global), expected: kind === 'global' },
      { parent: new SwitchPetContext(turn, b, b.activePet), expected: kind === 'recipient' },
      { parent: new StackContext(add, mark, mark, 1, 1, 2, 1, StackStrategy.stack), expected: kind === 'recipient' },
      { parent: add, expected: false },
      { parent: turn, expected: false },
    ]
    for (const { parent, expected } of entries) {
      const observed: boolean[] = []
      const effect = effectAuthoring.compileEffect(
        effectAuthoring.defineEffect({
          id: 'fixture/ownership',
          triggers: [EffectTrigger.BeforeHit],
          apply(ctx) {
            observed.push(effectAuthoring.conditions.sourceOwnsEvent(ctx))
          },
        }),
      )
      source.effects.splice(0, source.effects.length, effect)
      battle.applyEffects<EffectTrigger>(parent, EffectTrigger.BeforeHit, source)
      expect(observed).toEqual([expected])
      expect(Conditions.checkSelf()(new EffectContext<EffectTrigger>(parent, EffectTrigger.BeforeHit, source))).toBe(
        expected,
      )
    }
  })
