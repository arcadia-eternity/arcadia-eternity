import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  BaseSkill,
  SkillInstance,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  SkillPhase,
  Category,
  Element,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  effectAuthoring,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedSkillDisabling } from '@arcadia-eternity/data-pack-base/native'

type Id = keyof typeof generatedSkillDisabling
const ids = Object.keys(generatedSkillDisabling) as Id[]
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/skill-disabling-candidates.json', import.meta.url), 'utf8'),
)
function normalize(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(normalize)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
        )
      : v
}
const oracles = new Map(
  ids.map(id => {
    const record = ledger.records.find((r: { id: string }) => r.id === id)
    const d = parse(readFileSync(new URL(`../../../../${record.sourceFile}`, import.meta.url), 'utf8'), {
      merge: true,
    })[Number(record.sourcePath.slice(1))]
    expect(record.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    expect(() => EffectParser.parse(d)).not.toThrow()
    expect(d.apply.target).toBe('useSkillContext')
    d.apply.target = 'usingSkillContext'
    const paths = ['/apply/target']
    if (id === 'effect_mark_taunt' || id === 'effect_mark_physical_stun') {
      expect(d.condition.conditions[1].target.base).toBe('useSkillContext')
      d.condition.conditions[1].target.base = 'usingSkillContext'
      paths.push('/condition/conditions/1/target/base')
    }
    expect([...record.recipe.repairedPaths].sort()).toEqual(paths.sort())
    expect(record.recipe.pathRepairs).toBeUndefined()
    return [id, EffectParser.parse(d)]
  }),
)
const battles: Battle[] = [],
  errors: unknown[][] = []
beforeAll(() =>
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      errors.push(args)
    },
  }),
)
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  expect(errors.splice(0)).toEqual([])
})
const variants = [
  'normal',
  'wrong-owner',
  'nested',
  'cancel',
  'late-owner',
  'late-category',
  'context-category',
  'repeat',
  'phase',
] as const
function run(
  id: Id,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
  category: Category,
  roll = 0.1,
) {
  const { battle, a, b, debuff } = makeScenario(2401)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const skill = new SkillInstance(
    new BaseSkill(
      'fixture/disabling' as baseSkillId,
      category,
      Element.Normal,
      40,
      100,
      10,
      0,
      AttackTargetOpinion.opponent,
      1,
      true,
    ),
  )
  skill.setOwner(a.activePet)
  a.activePet.skills[0] = skill
  battle.skillMap.set(skill.id, skill)
  const mark = new BaseMark('fixture/disabling' as baseMarkId, [], { ...debuff.config, duration: -1 }).createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(mark)
  const source = kind === 'mark' ? mark : skill
  source.effects.push(native ? generatedSkillDisabling[id] : oracles.get(id)!)
  const turn = new TurnContext(battle),
    use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  use.updateActualTarget()
  if (variant === 'context-category') use.category = category === Category.Status ? Category.Physical : Category.Status
  if (variant === 'wrong-owner') source.setOwner(b.activePet, battle.emitter)
  a.currentRage = 100
  const hp = b.activePet.currentHp
  let draws = 0,
    admitted = 0
  battle.random = () => {
    draws++
    return roll
  }
  const trace: string[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/disabling-observer' as effectId,
      triggers: [
        EffectTrigger.BeforeEffect,
        EffectTrigger.AfterUseSkillCheck,
        EffectTrigger.OnHit,
        EffectTrigger.OnDamage,
      ],
      when: c =>
        c.trigger !== EffectTrigger.BeforeEffect || (c.parent instanceof EffectContext && c.parent.effect?.id === id),
      apply(c) {
        if (c.trigger !== EffectTrigger.BeforeEffect) {
          trace.push(c.trigger)
          return
        }
        admitted++
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
        if (variant === 'late-owner') source.setOwner(a.team[1], battle.emitter)
        if (variant === 'late-category') use.category = Category.Special
      },
    }),
  )
  if (variant === 'phase') {
    const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn, use)
    phase.initialize()
    phase.execute()
  } else {
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeUseSkillCheck, source) : use
    battle.applyEffects<EffectTrigger>(parent, EffectTrigger.BeforeUseSkillCheck, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(parent, EffectTrigger.BeforeUseSkillCheck, source)
  }
  return {
    available: use.available,
    admitted,
    draws,
    rage: a.currentRage,
    lostHp: hp - b.activePet.currentHp,
    trace,
    cursor: use.currentHitCount,
    appeared: skill.appeared,
    uses: a.activePet.lastSkillUsedTimes,
  }
}
for (const id of ids)
  for (const kind of ['skill', 'mark'] as const)
    for (const category of [Category.Status, Category.Physical, Category.Special])
      for (const variant of variants)
        it(`${id}/${kind}/${category}/${variant}`, () =>
          expect(run(id, true, kind, variant, category)).toEqual(run(id, false, kind, variant, category)))
for (const id of ids)
  it(`actual skill lifecycle stops ${id}`, () => {
    const category = id === 'effect_mark_physical_stun' ? Category.Physical : Category.Status
    const result = run(id, true, 'mark', 'phase', category)
    expect(result).toMatchObject({
      available: false,
      admitted: 1,
      rage: 100,
      lostHp: 0,
      cursor: 1,
      trace: [],
      appeared: true,
      uses: 1,
    })
  })
for (const roll of [0, 0.399999, 0.4, 0.999])
  it(`probability boundary ${roll}`, () => {
    const id = 'effect_mark_40probability_stun',
      actual = run(id, true, 'mark', 'normal', Category.Status, roll)
    expect(actual).toEqual(run(id, false, 'mark', 'normal', Category.Status, roll))
    expect(actual.available).toBe(roll >= 0.4)
    expect(actual.draws).toBe(1)
  })
it('failed ownership check skips the probability draw', () =>
  expect(run('effect_mark_40probability_stun', true, 'mark', 'wrong-owner', Category.Status).draws).toBe(0))
it('cross-battle skill cancellation rejects before any write', () => {
  const { battle, a } = makeScenario(2402),
    foreign = makeScenario(2403)
  battles.push(battle, foreign.battle)
  const turn = new TurnContext(battle),
    skill = a.activePet.skills[0]
  const own = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  const other = new UseSkillContext(
    new TurnContext(foreign.battle),
    foreign.a,
    foreign.a.activePet,
    AttackTargetOpinion.opponent,
    foreign.a.activePet.skills[0],
  )
  const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/foreign-skill',
      triggers: [EffectTrigger.BeforeUseSkillCheck],
      apply: selectFrom([own, other]).apply(ops.disableContext()),
    }),
  )
  expect(() =>
    battle.executionBudget.run(battle.currentTurn, () =>
      effect.innerApply(new EffectContext(own, EffectTrigger.BeforeUseSkillCheck, skill, effect)),
    ),
  ).toThrow('Cross-battle')
  expect(own.available).toBe(true)
  expect(other.available).toBe(true)
})
