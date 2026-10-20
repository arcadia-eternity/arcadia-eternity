import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  SkillPhase,
  AttackTargetOpinion,
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
const cases = [
  { name: 'zero', total: 0, hits: [], misses: [], cursor: 1, resolved: 0 },
  { name: 'negative', total: -1, hits: [], misses: [], cursor: 1, resolved: -1 },
  { name: 'one', total: 1, hits: [1], misses: [], cursor: 2, resolved: 1 },
  { name: 'three', total: 3, hits: [1, 2, 3], misses: [], cursor: 4, resolved: 3 },
  { name: 'fractional', total: 2.5, hits: [1, 2], misses: [], cursor: 3, resolved: 2.5 },
  { name: 'extend', total: 2, hits: [1, 2, 3], misses: [], cursor: 4, resolved: 3 },
  { name: 'shorten-second', total: 4, hits: [1, 2], misses: [], cursor: 3, resolved: 2 },
  { name: 'cursor-write', total: 3, hits: [1, 3], misses: [], cursor: 4, resolved: 3 },
  { name: 'initial-miss', total: 3, hits: [], misses: [1], cursor: 1, resolved: 3 },
  { name: 'late-miss', total: 3, hits: [1], misses: [2], cursor: 2, resolved: 3 },
  { name: 'disabled', total: 3, hits: [], misses: [], cursor: 1, resolved: 1 },
]
for (const spec of cases)
  it(`historical cursor and total: ${spec.name}`, () => {
    const { battle, a } = makeScenario(241)
    battles.push(battle)
    for (const p of [...battle.playerA.team, ...battle.playerB.team]) {
      p.marks.splice(0)
      for (const s of p.skills) s.effects.splice(0)
    }
    const skill = a.activePet.skills[0]
    const turn = new TurnContext(battle)
    const use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
    expect(use.currentHitCount).toBe(1)
    use.multihit = spec.total
    use.available = spec.name !== 'disabled'
    use.hitOverrides.push({ willHit: spec.name !== 'initial-miss', priority: 1000 })
    a.currentRage = a.maxRage
    const trace: { on: string; cursor: number; total: number }[] = []
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/cursor-observer' as effectId,
        triggers: [
          EffectTrigger.BeforeUseSkillCheck,
          EffectTrigger.AfterUseSkillCheck,
          EffectTrigger.BeforeMultiHit,
          EffectTrigger.BeforeHit,
          EffectTrigger.OnHit,
          EffectTrigger.OnMiss,
        ],
        apply(ctx) {
          const u = ctx.parent
          trace.push({ on: ctx.trigger, cursor: u.currentHitCount, total: u.multihitResult })
          if (ctx.trigger === EffectTrigger.OnHit) {
            if (spec.name === 'extend' && u.currentHitCount === 1) u.multihitResult++
            if (spec.name === 'shorten-second' && u.currentHitCount === 2) u.multihitResult = 2
            if (spec.name === 'cursor-write' && u.currentHitCount === 1) u.currentHitCount = 2
            if (spec.name === 'late-miss') u.hitResult = false
          }
        },
      }),
    )
    const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn, use)
    phase.initialize()
    phase.execute()
    expect(trace[0]).toEqual({ on: 'BeforeUseSkillCheck', cursor: 1, total: 1 })
    expect(trace.filter(e => e.on === 'BeforeMultiHit')).toEqual(
      spec.name === 'disabled' ? [] : [{ on: 'BeforeMultiHit', cursor: 1, total: spec.total }],
    )
    expect(trace.filter(e => e.on === 'OnHit').map(e => e.cursor)).toEqual(spec.hits)
    expect(trace.filter(e => e.on === 'OnMiss').map(e => e.cursor)).toEqual(spec.misses)
    expect(use.currentHitCount).toBe(spec.cursor)
    expect(use.multihitResult).toBe(spec.resolved)
    if (spec.name === 'three') expect(trace.filter(e => e.on === 'BeforeHit').map(e => e.total)).toEqual([3, 3, 3])
  })
