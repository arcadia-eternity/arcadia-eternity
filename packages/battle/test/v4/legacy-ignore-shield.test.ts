import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, Operators } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
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
const id = 'effect_skill_ignore_opponent_shield_if_has_shunliu'
const original = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
).find((d: { id: string }) => d.id === id)
const effect = EffectParser.parse(original)
for (const support of [false, true])
  for (const owner of ['same', 'other'] as const)
    it(`unchanged effect support=${support} owner=${owner}`, () => {
      const f = makeScenario()
      battles.push(f.battle)
      for (const p of [...f.a.team, ...f.b.team]) for (const s of p.skills) s.effects.splice(0)
      const source = f.a.activePet.skills[0]
      source.effects.push(effect)
      if (support) {
        const mark = new BaseMark('mark_shunliu' as baseMarkId, [], f.debuff.config).createInstance()
        mark.setOwner(f.a.activePet, f.battle.emitter)
        f.a.activePet.marks.push(mark)
      }
      const ctx = new UseSkillContext(
        new TurnContext(f.battle),
        f.a,
        owner === 'same' ? f.a.activePet : f.a.team[1],
        AttackTargetOpinion.opponent,
        source,
      )
      expect(ctx.ignoreShield).toBe(false)
      f.battle.applyEffects(ctx, EffectTrigger.AfterUseSkillCheck, source)
      expect(ctx.ignoreShield).toBe(support && owner === 'same')
      expect(source.ignoreShield).toBe(false)
    })
it('historical operator updates every selected context without changing skill defaults', () => {
  const f = makeScenario()
  battles.push(f.battle)
  const skill = f.a.activePet.skills[0]
  const make = () =>
    new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
  const first = make(),
    second = make(),
    ctx = new EffectContext(first, EffectTrigger.AfterUseSkillCheck, skill)
  Operators.setIgnoreShield()(ctx, [first, second])
  expect([first.ignoreShield, second.ignoreShield]).toEqual([true, true])
  expect(make().ignoreShield).toBe(false)
  Operators.setIgnoreShield()(ctx, [])
})
it('pins the historical operator body', () => {
  const s = readFileSync(new URL('../../src/v4/legacy/effectBuilder/src/operator.ts', import.meta.url), 'utf8')
  const body = s.slice(s.indexOf('  setIgnoreShield:'), s.indexOf('  setSkill:')).replace(/\s+/g, '')
  expect(createHash('sha256').update(body).digest('hex')).toBe(
    'b9b4083053aaf7032ecea3a912caad64e2820b4eea9c905f8a0fdbccc445652f',
  )
})
