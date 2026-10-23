import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { Conditions } from '@arcadia-eternity/battle/v4/legacy'
import {
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  SwitchPetContext,
  SkillPhase,
  SwitchPetPhase,
  AttackTargetOpinion,
  effectAuthoring,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
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
for (const kind of ['direct', 'damage', 'nested-effect', 'missing'] as const)
  for (const position of ['first', 'last', 'empty'] as const)
    it(`${kind}/${position} queries historical ancestors without capturing the previous turn view`, () => {
      const f = fixture()
      const rival = new UseSkillContext(
        f.turn,
        f.b,
        f.b.activePet,
        AttackTargetOpinion.opponent,
        f.b.activePet.skills[0],
      )
      if (position !== 'empty') {
        const order = position === 'first' ? [f.use, rival] : [rival, f.use]
        f.turn.appledContexts.push(...order)
        f.turn.contexts.push(...[...order].reverse())
      }
      const damage = new DamageContext(f.use, f.a.activePet, f.b.activePet, 10)
      const parent =
        kind === 'direct'
          ? f.use
          : kind === 'damage'
            ? damage
            : kind === 'nested-effect'
              ? new EffectContext(damage, EffectTrigger.OnDamage, f.skill)
              : f.turn
      const ctx = new EffectContext(parent, EffectTrigger.BeforeEffect, f.skill)
      const answers: boolean[][] = []
      const { compileEffect, defineEffect, conditions } = effectAuthoring
      const effect = compileEffect(
        defineEffect({
          id: 'fixture/order-query',
          on: 'BeforeEffect',
          execute(frame) {
            answers.push([conditions.firstSkillThisTurn(frame), conditions.lastSkillThisTurn(frame)])
          },
        }),
      )
      const fire = () => {
        f.battle.executionBudget.run(0, () => effect.innerApply(ctx))
        expect(answers.at(-1)).toEqual([
          Conditions.isFirstSkillUsedThisTurn()(ctx),
          Conditions.isLastSkillUsedThisTurn()(ctx),
        ])
      }
      fire()
      expect(answers[0]).toEqual([
        kind !== 'missing' && position === 'first',
        kind !== 'missing' && position === 'last',
      ])
      f.turn.appledContexts.reverse()
      f.turn.contexts.reverse()
      fire()
      expect(answers[1]).toEqual([
        kind !== 'missing' && position === 'last',
        kind !== 'missing' && position === 'first',
      ])
    })
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
it('pins both historical recursive predicate bodies', () => {
  const text = readFileSync(new URL('../../src/v4/legacy/effectBuilder/src/condition.ts', import.meta.url), 'utf8')
  for (const [name, hash] of [
    ['isFirstSkillUsedThisTurn', '8b1c8bc40632dba42d636d839ba85332981f1e1f434317ebfb4091842cddafb0'],
    ['isLastSkillUsedThisTurn', '7b5a13c81f62c4fac67607304dce65696985d1811ec722c6b93596c303daaf1b'],
  ]) {
    const body = text.match(new RegExp(`  ${name}:[\\s\\S]*?\\n  },`))![0].replace(/\s+/g, '')
    expect(createHash('sha256').update(body).digest('hex')).toBe(hash)
  }
})
