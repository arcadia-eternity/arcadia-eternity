import {
  AttackTargetOpinion,
  defineNativeEffect,
  EffectTrigger,
  setGlobalLogger,
  SkillPhase,
  SwitchPetContext,
  SwitchPetPhase,
  TurnContext,
  UseSkillContext,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
function fixture() {
  const f = makeScenario(241)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) {
    p.marks.splice(0)
    for (const s of p.skills) s.effects.splice(0)
  }
  const turn = new TurnContext(f.battle)
  const skill = f.a.activePet.skills[0]
  const use = new UseSkillContext(turn, f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
  return { ...f, turn, skill, use }
}

for (const denied of [false, true])
  it(`direct skill phase records its attempt before hooks, denied=${denied}`, () => {
    const f = fixture()
    f.use.available = !denied
    f.use.rage = 0
    const observed: boolean[] = []
    f.skill.effects.push(
      defineNativeEffect({
        id: 'fixture/direct-skill-attempt' as effectId,
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        apply(ctx) {
          observed.push(f.turn.appledContexts[0] === ctx.parent)
        },
      }),
    )
    const phase = new SkillPhase(f.battle, f.a, f.a.activePet, AttackTargetOpinion.opponent, f.skill, f.turn, f.use)
    phase.initialize()
    phase.execute()
    expect(observed).toEqual([true])
    expect(f.turn.appledContexts).toEqual([f.use])
  })
it('direct switch phase records its context before outgoing effects', () => {
  const f = fixture()
  const context = new SwitchPetContext(f.turn, f.a, f.a.team[1])
  const observed: boolean[] = []
  f.skill.effects.push(
    defineNativeEffect({
      id: 'fixture/direct-switch-attempt' as effectId,
      triggers: [EffectTrigger.OnSwitchOut],
      apply(ctx) {
        observed.push(f.turn.appledContexts[0] === ctx.parent)
      },
    }),
  )
  const phase = new SwitchPetPhase(f.battle, f.a, f.a.team[1], f.turn, context)
  phase.initialize()
  phase.execute()
  expect(observed).toEqual([true])
  expect(f.turn.appledContexts).toEqual([context])
})
