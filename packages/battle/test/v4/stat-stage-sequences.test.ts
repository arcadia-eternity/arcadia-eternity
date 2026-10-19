import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedStatStageSequences,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  EffectContext,
  RemoveMarkContext,
  DamageContext,
  Gender,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  SkillPhase,
  executeTurnOperation,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
interface RecordEntry {
  id: keyof typeof generatedStatStageSequences
  sourceFile: string
  definitionSha256: string
  recipe: {
    trigger: 'BeforeHit' | 'OnDamage'
    repairedPaths: string[]
    pathRepairs?: { path: string; before: string; after: string }[]
    actions: { sourcePath: string }[]
  }
}
const records: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/stat-stage-sequences-candidates.json', import.meta.url), 'utf8'),
).records
interface Definition {
  id: string
  apply: unknown[]
  condition: { conditions: { target: { chain: { arg: string }[] } }[] }
}
const definitions = new Map<string, Definition>()
for (const file of new Set(records.map(r => r.sourceFile)))
  for (const d of parse(readFileSync(new URL(`../../../../${file}`, import.meta.url), 'utf8'), { merge: true }))
    definitions.set(d.id, d)
function copy(value: unknown, paths: string[] = [], path = ''): unknown {
  if (Array.isArray(value)) return value.map((v, i) => copy(v, paths, `${path}/${i}`))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        const next = `${path}/${k}`
        if (['base', 'target'].includes(k) && v === 'useSkillContext') {
          paths.push(next)
          return [k, 'usingSkillContext']
        }
        return [k, copy(v, paths, next)]
      }),
    )
  return value
}
function reference(r: RecordEntry) {
  return copy(definitions.get(r.id)) as Definition
}
const oracles = new Map(records.map(r => [r.id, EffectParser.parse(reference(r))]))
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'missing-support',
  'late-support',
  'late-owner',
  'late-target',
  'late-stack',
  'cancel',
  'one-layer',
  'nested',
  'phase',
  'turn',
  'wrong-gender',
  'late-gender',
  'multi-mark',
  'repeat',
  'redirect',
  'switch-slot',
] as const
function run(r: RecordEntry, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(421)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const skill = new SkillInstance(
    new BaseSkill(
      'fixture/sequence' as baseSkillId,
      Category.Status,
      Element.Normal,
      100,
      50,
      0,
      0,
      AttackTargetOpinion.opponent,
    ),
  )
  skill.owner = a.activePet
  a.activePet.skills[0] = skill
  battle.skillMap.set(skill.id, skill)
  const support: typeof a.activePet.marks = []
  const add = (owner: typeof a.activePet, id: string, stack = 3) => {
    const mark = new BaseMark(id as baseMarkId, [], { ...debuff.config, maxStacks: 300, duration: -1 }).createInstance()
    mark.owner = owner
    mark.stack = stack
    owner.marks.push(mark)
    return mark
  }
  const sourceMark = add(
    a.activePet,
    'fixture/source',
    ['one-layer', 'redirect', 'switch-slot'].includes(variant) ? 1 : 3,
  )
  const female = r.id.includes('female')
  for (const pet of [...a.team, ...b.team])
    pet.gender = (variant === 'wrong-gender' ? !female : female) ? Gender.Female : Gender.Male
  const stages = () =>
    [...a.team, ...b.team].map(p =>
      p.marks
        .filter(m => m.baseId.startsWith('stat_stage_'))
        .map(m => ({ id: m.baseId, stack: m.stack }))
        .sort((x, y) => x.id.localeCompare(y.id)),
    )
  const source = kind === 'mark' ? sourceMark : skill
  const supportId = r.id.includes('heianwuzhi')
    ? 'mark_heianwuzhi'
    : r.id.includes('huanxiang')
      ? 'mark_huanxiang'
      : undefined
  if (supportId)
    for (const owner of [a.activePet, b.activePet]) {
      support.push(add(owner, supportId, ['one-layer', 'redirect', 'switch-slot'].includes(variant) ? 1 : 3))
      if (variant === 'multi-mark') support.push(add(owner, supportId, 2))
    }
  const clearSupports = () => {
    for (const owner of [a.activePet, b.activePet]) owner.marks = owner.marks.filter(m => !support.includes(m))
  }
  if (variant === 'missing-support') clearSupports()
  source.effects.push(native ? generatedStatStageSequences[r.id] : oracles.get(r.id)!)
  const turn = new TurnContext(battle)
  let use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  use.updateActualTarget()
  use.power = 100
  use.accuracy = 50
  use.critRate = 10
  let outer: EffectContext<EffectTrigger> | undefined
  const admitted: number[] = []
  const destruction: { id: string; stages: ReturnType<typeof stages> }[] = []
  for (const mark of [sourceMark, ...support])
    mark.effects.push(
      defineNativeEffect({
        id: `fixture/destroy-${mark.id}` as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply(c) {
          if (!(c.parent instanceof RemoveMarkContext) || c.parent.parent !== outer) return
          destruction.push({
            id: mark.baseId,
            stages: stages(),
          })
          if (variant === 'redirect') use.actualTarget = b.team[1]
          if (variant === 'switch-slot') b.activePet = b.team[1]
        },
      }),
    )
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/sequence-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === r.id,
      apply(c) {
        outer = c.parent as EffectContext<EffectTrigger>
        if (variant === 'turn' && outer.parent instanceof UseSkillContext) use = outer.parent
        admitted.push(sourceMark.stack)
        if (variant === 'late-support') clearSupports()
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-target') use.actualTarget = b.team[1]
        if (variant === 'late-stack') sourceMark.stack = 7
        if (variant === 'late-gender')
          for (const p of [...a.team, ...b.team]) p.gender = female ? Gender.Male : Gender.Female
        if (variant === 'cancel') outer.available = false
      },
    }),
  )
  if (variant === 'phase' || variant === 'turn') {
    let reached = 0
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/sequence-stage' as effectId,
        triggers: [EffectTrigger[r.recipe.trigger]],
        when: c => c.parent instanceof UseSkillContext && c.parent.skill === skill,
        apply() {
          reached++
        },
      }),
    )
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/sequence-hit' as effectId,
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        when: c => c.parent instanceof UseSkillContext && c.parent.skill === skill,
        apply(c) {
          if (c.parent instanceof UseSkillContext && r.recipe.trigger === 'BeforeHit')
            c.parent.hitOverrides.push({ willHit: true, priority: 1000 })
        },
      }),
    )
    a.currentRage = a.maxRage
    if (variant === 'phase') {
      const p = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, turn, use)
      p.initialize()
      p.execute()
    } else {
      a.selection = { player: a.id, type: 'use-skill', skill: skill.id, target: skill.target }
      b.selection = { player: b.id, type: 'do-nothing' }
      executeTurnOperation(turn, battle)
      use = turn.appledContexts.find((c): c is UseSkillContext => c instanceof UseSkillContext)!
    }
    expect(reached).toBe(1)
  } else {
    const event = r.recipe.trigger === 'OnDamage' ? new DamageContext(use, skill, a.activePet, 10) : use
    const parent = variant === 'nested' ? new EffectContext(event, EffectTrigger.BeforeEffect, source) : event
    battle.applyEffects<EffectTrigger>(parent, EffectTrigger[r.recipe.trigger], source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(parent, EffectTrigger[r.recipe.trigger], source)
  }
  const state = (event: UseSkillContext) => ({
    power: event.power,
    accuracy: event.accuracy,
    critRate: event.critRate,
    hit: event.hitOverrides,
    crit: event.critOverrides,
  })
  return {
    admitted,
    destruction,
    source: { stack: sourceMark.stack, active: sourceMark.isActive },
    support: support.map(m => ({ id: m.baseId, stack: m.stack, active: m.isActive })),
    use: state(use),
    stages: stages(),
    next: battle.random(),
  }
}

for (const r of records) {
  it(`${r.id} audits unchanged source and full ordered mapping`, () => {
    expect(r.recipe.repairedPaths).toEqual([])
    expect(r.recipe.actions.map(a => a.sourcePath)).toEqual(definitions.get(r.id)!.apply.map((_, i) => `/apply/${i}`))
    const normalize = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(normalize)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
            )
          : v
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definitions.get(r.id))))
        .digest('hex'),
    ).toBe(r.definitionSha256)
  })
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants) {
      if (r.recipe.trigger === 'OnDamage' && ['phase', 'turn'].includes(variant)) continue
      it(`${r.id} ${kind} ${variant}`, () => {
        const actual = run(r, true, kind, variant)
        expect(actual).toEqual(run(r, false, kind, variant))
        if (variant === 'normal') {
          expect(actual.admitted).toHaveLength(1)
          const expected: Record<string, [number, string, number][]> = {
            effect_mark_raise_def_1_when_hit_and_remove_self: [[0, 'def', 1]],
            effect_skill_consume_heianwuzhi_reduce_opponent_spd_1_stage: [[2, 'spd', -1]],
            effect_skill_consume_huanxiang_raise_spa_1_stage: [[0, 'spa', 1]],
            effect_skill_consume_huanxiang_raise_def_1_stage: [[0, 'def', 1]],
            effect_skill_consume_huanxiang_raise_spd_1_stage: [[0, 'spd', 1]],
            effect_skill_raise_both_spe_1_stage: [
              [0, 'spe', 1],
              [2, 'spe', 1],
            ],
            effect_skill_reduce_both_spa_1_stage: [
              [0, 'spa', -1],
              [2, 'spa', -1],
            ],
            effect_skill_raise_spa_spd_1_stage_if_female: [
              [0, 'spa', 1],
              [0, 'spd', 1],
            ],
            effect_skill_raise_atk_def_1_stage_if_male: [
              [0, 'atk', 1],
              [0, 'def', 1],
            ],
            effect_skill_reduce_opponent_spa_spd_1_stage_if_opponent_female: [
              [2, 'spa', -1],
              [2, 'spd', -1],
            ],
            effect_skill_reduce_opponent_atk_def_1_stage_if_opponent_male: [
              [2, 'atk', -1],
              [2, 'def', -1],
            ],
          }
          for (const [pet, stat, amount] of expected[r.id])
            expect(actual.stages[pet]).toContainEqual({
              id: `stat_stage_${stat}_${amount > 0 ? 'up' : 'down'}`,
              stack: Math.abs(amount),
            })
        }
        if (variant === 'cancel') expect(actual.stages.flat()).toEqual([])
        if (variant === 'wrong-gender' && /female|male/.test(r.id)) expect(actual.admitted).toEqual([])
        if (variant === 'late-gender' && /female|male/.test(r.id)) expect(actual.stages.flat().length).toBe(2)
        if (['redirect', 'switch-slot'].includes(variant) && r.id.includes('consume_')) {
          expect(actual.destruction).toHaveLength(1)
          expect(actual.destruction[0].stages.flat()).toEqual([])
          if (r.id.includes('heianwuzhi')) {
            expect(actual.stages[variant === 'switch-slot' ? 2 : 3]).toEqual([])
            expect(actual.stages[variant === 'switch-slot' ? 3 : 2]).toEqual([{ id: 'stat_stage_spd_down', stack: 1 }])
          }
        }
      })
    }
}
it('exports exactly the stat-stage sequence ledger', () =>
  expect(Object.keys(generatedStatStageSequences).sort()).toEqual(records.map(r => r.id).sort()))
