import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedSkillNumericReferences,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  SkillPhase,
  Category,
  Element,
  AttackTargetOpinion,
  effectAuthoring,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
type Id = keyof typeof generatedSkillNumericReferences
const ids = Object.keys(generatedSkillNumericReferences) as Id[]
const ledger = JSON.parse(
  readFileSync(
    new URL('../../../../docs/v4/validation/skill-numeric-references-candidates.json', import.meta.url),
    'utf8',
  ),
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
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    const d = parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
      Number(r.sourcePath.slice(1))
    ]
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    expect(() => EffectParser.parse(d)).toThrow()
    expect(d.apply.target.base).toBe('useSkillContext')
    d.apply.target.base = 'usingSkillContext'
    const paths = ['/apply/target/base']
    for (const [i, c] of d.condition.conditions.entries())
      if (c.target?.base === 'useSkillContext') {
        c.target.base = 'usingSkillContext'
        paths.push(`/condition/conditions/${i}/target/base`)
      }
    expect([...r.recipe.repairedPaths].sort()).toEqual(paths.sort())
    if (id === 'effect_skill_priority_plus_1_if_atk_over_500') {
      expect(() => EffectParser.parse(d)).toThrow()
      expect(d.condition.conditions[1].target.chain[0].arg).toBe('atk')
      d.condition.conditions[1].target.chain[0].arg = 'stat.atk'
      expect(r.recipe.pathRepairs).toEqual([
        { path: '/condition/conditions/1/target/chain/0/arg', before: 'atk', after: 'stat.atk' },
      ])
    }
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
function setup(id: Id, native: boolean, kind: 'mark' | 'skill') {
  const f = makeScenario(3101)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) for (const s of p.skills) s.effects.splice(0)
  const pet = f.a.activePet,
    opponent = f.b.activePet
  const owner = id === 'effect_ability_physical_evasion_boost_5_percent' ? opponent : pet
  const mark = new BaseMark('fixture/numeric' as baseMarkId, [], { ...f.debuff.config, duration: -1 }).createInstance()
  mark.setOwner(owner, f.battle.emitter)
  owner.marks.push(mark)
  const source = kind === 'mark' ? mark : owner.skills[0]
  source.effects.push(native ? generatedSkillNumericReferences[id] : oracles.get(id)!)
  for (const baseId of ['mark_aideminyi', 'mark_chaojipenti']) {
    const m = new BaseMark(baseId as baseMarkId, [], { ...f.debuff.config, duration: -1 }).createInstance()
    m.setOwner(owner, f.battle.emitter)
    owner.marks.push(m)
  }
  const field = new BaseMark('mark_global_chongqun' as baseMarkId, [], {
    ...f.debuff.config,
    duration: -1,
  }).createInstance()
  field.setOwner(f.battle, f.battle.emitter)
  f.battle.marks.push(field)
  const use = new UseSkillContext(new TurnContext(f.battle), f.a, pet, AttackTargetOpinion.opponent, pet.skills[0])
  use.updateActualTarget()
  use.category = id === 'effect_ability_physical_evasion_boost_5_percent' ? Category.Physical : Category.Climax
  use.element = Element.Light
  use.multihitResult = 2
  use.rage = 2
  use.priority = 0
  use.evasion = 3
  pet.attributeSystem.updateBaseValue('atk', 501)
  const fire = () => {
    if (id.includes('priority')) f.battle.applyEffects(use, EffectTrigger.BeforeSort, source)
    else if (id.includes('evasion')) f.battle.applyEffects(use, EffectTrigger.AfterUseSkillCheck, source)
    else f.battle.applyEffects(use, EffectTrigger.BeforeUseSkillCheck, source)
  }
  return { ...f, pet, opponent, owner, source, mark, use, fire }
}
const variants = [
  'match',
  'wrong-owner',
  'missing-marks',
  'wrong-category',
  'wrong-element',
  'one-hit',
  'atk500',
  'repeat',
  'late-change',
] as const
function run(id: Id, native: boolean, kind: 'mark' | 'skill', variant: (typeof variants)[number]) {
  const f = setup(id, native, kind)
  if (variant === 'wrong-owner') f.source.setOwner(f.owner === f.pet ? f.opponent : f.pet, f.battle.emitter)
  if (variant === 'missing-marks') {
    f.owner.marks.splice(1)
    f.battle.marks.splice(0)
  }
  if (variant === 'wrong-category') f.use.category = Category.Status
  if (variant === 'wrong-element') f.use.element = Element.Normal
  if (variant === 'one-hit') f.use.multihitResult = 1
  if (variant === 'atk500') f.pet.attributeSystem.updateBaseValue('atk', 500)
  const read = () => [f.use.priority, f.use.rage, f.use.evasion]
  f.fire()
  const trace = [read()]
  if (variant === 'repeat') {
    f.fire()
    trace.push(read())
  }
  if (variant === 'late-change') {
    f.use.category = Category.Status
    f.pet.attributeSystem.updateBaseValue('atk', 500)
    f.owner.marks.splice(1)
    f.battle.marks.splice(0)
    f.fire()
    trace.push(read())
  }
  return trace
}
for (const id of ids)
  for (const kind of ['mark', 'skill'] as const)
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => expect(run(id, true, kind, variant)).toEqual(run(id, false, kind, variant)))
it('independently verifies additive values without clamping and strict attack threshold', () => {
  expect(run('effect_skill_priority_plus_2_if_has_mark_chaojipenti', true, 'skill', 'repeat')).toEqual([
    [2, 2, 3],
    [4, 2, 3],
  ])
  expect(run('effect_ability_reduce_climax_skill_rage_cost_5', true, 'mark', 'repeat')).toEqual([
    [0, -3, 3],
    [0, -8, 3],
  ])
  expect(run('effect_ability_physical_evasion_boost_5_percent', true, 'mark', 'match')).toEqual([[0, 2, 8]])
  expect(run('effect_skill_priority_plus_1_if_atk_over_500', true, 'skill', 'atk500')[0][0]).toBe(0)
  expect(run('effect_skill_priority_plus_1_if_atk_over_500', true, 'skill', 'match')[0][0]).toBe(1)
})
it('reads delta once and reads each reference immediately before addition', () => {
  const f = setup('effect_skill_priority_plus_1', true, 'mark')
  const { compileEffect, defineEffect, selectFrom, targets, ops } = effectAuthoring
  let reads = 0
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/add-reference',
      on: 'BeforeSort',
      execute: selectFrom([f.use, f.use])
        .property('priority')
        .apply(
          ops.add(
            targets.ownerPet.first().map(() => {
              reads++
              f.use.priority = 10
              return 2
            }),
          ),
        ),
    }),
  )
  f.battle.executionBudget.run(0, () => effect.innerApply(new EffectContext(f.use, EffectTrigger.BeforeSort, f.source)))
  expect(reads).toBe(1)
  expect(f.use.priority).toBe(14)
})
it('preserves the legacy difference between rage eligibility and actual rage consumption', () => {
  const run = (native: boolean) => {
    const f = setup('effect_ability_reduce_climax_skill_rage_cost_5', native, 'mark')
    f.a.currentRage = 20
    f.use.rage = 5
    const afterConsumption: number[] = []
    f.source.effects.push(
      effectAuthoring.compileEffect(
        effectAuthoring.defineEffect({
          id: 'fixture/rage-consumed',
          on: 'AfterUseSkillCheck',
          execute() {
            afterConsumption.push(f.a.currentRage)
          },
        }),
      ),
    )
    const phase = new SkillPhase(
      f.battle,
      f.a,
      f.pet,
      AttackTargetOpinion.opponent,
      f.use.skill,
      new TurnContext(f.battle),
      f.use,
    )
    phase.initialize()
    phase.execute()
    expect(f.use.rage).toBe(0)
    expect(afterConsumption).toEqual([15])
    expect(f.a.currentRage).toBe(30) // Non-status skill hit rewards 15 rage after consumption.
    return [f.use.rage, f.a.currentRage]
  }
  expect(run(true)).toEqual(run(false))
})

it('rejects foreign numeric references before reading a delta', () => {
  const f = setup('effect_skill_priority_plus_1', true, 'mark'),
    foreign = setup('effect_skill_priority_plus_1', true, 'mark')
  const { compileEffect, defineEffect, selectFrom, targets, ops } = effectAuthoring
  let reads = 0
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/numeric-guard',
      on: 'BeforeSort',
      execute: selectFrom([f.use, foreign.use])
        .property('priority')
        .apply(
          ops.add(
            targets.ownerPet.first().map(() => {
              reads++
              return 1
            }),
          ),
        ),
    }),
  )
  expect(() =>
    f.battle.executionBudget.run(0, () =>
      effect.innerApply(new EffectContext(f.use, EffectTrigger.BeforeSort, f.source)),
    ),
  ).toThrow('Cross-battle or unowned write target')
  expect(reads).toBe(0)
  expect(f.use.priority).toBe(0)
  expect(foreign.use.priority).toBe(0)
})
it('skips absent numeric inputs without overwriting the reference', () => {
  const f = setup('effect_skill_priority_plus_1', true, 'mark')
  const { compileEffect, defineEffect, contexts, targets, ops } = effectAuthoring
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/numeric-missing',
      on: 'BeforeSort',
      execute: contexts.skillUse.property('priority').apply(
        ops.add(
          targets.ownerMarks
            .where(() => false)
            .first()
            .attribute('stack'),
        ),
      ),
    }),
  )
  f.battle.executionBudget.run(0, () => effect.innerApply(new EffectContext(f.use, EffectTrigger.BeforeSort, f.source)))
  expect(f.use.priority).toBe(0)
})
