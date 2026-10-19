import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedSkillOutcomeSequences,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  EffectContext,
  RemoveMarkContext,
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
  id: keyof typeof generatedSkillOutcomeSequences
  sourceFile: string
  definitionSha256: string
  recipe: {
    trigger: 'BeforeUseSkillCheck' | 'AfterUseSkillCheck' | 'BeforeHit'
    repairedPaths: string[]
    pathRepairs?: { path: string; before: string; after: string }[]
    actions: { sourcePath: string }[]
  }
}
const records: RecordEntry[] = JSON.parse(
  readFileSync(
    new URL('../../../../docs/v4/validation/skill-outcome-sequences-candidates.json', import.meta.url),
    'utf8',
  ),
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
  const d = copy(definitions.get(r.id)) as Definition
  if (r.id === 'effect_mark_next_non_status_skill_sure_crit') {
    expect(d.condition.conditions[2].target.chain[0].arg).toBe('skillId')
    d.condition.conditions[2].target.chain[0].arg = 'skill'
  }
  return d
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
  'event-status',
  'skill-status',
  'multi-mark',
  'repeat',
  'redirect',
] as const
const powerVariants = ['stack-99', 'stack-100', 'stack-199', 'stack-200', 'wrong-element', 'late-element'] as const
function run(
  r: RecordEntry,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number] | (typeof powerVariants)[number],
) {
  const { battle, a, b, debuff } = makeScenario(421)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const skill = new SkillInstance(
    new BaseSkill(
      'fixture/sequence' as baseSkillId,
      variant === 'skill-status' ? Category.Status : Category.Physical,
      r.id === 'effect_mark_amplify_next_electric_skill' ? Element.Electric : Element.Normal,
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
  const sourceMark = add(a.activePet, 'fixture/source', variant === 'one-layer' || variant === 'redirect' ? 1 : 3)
  if (variant.startsWith('stack-')) sourceMark.stack = Number(variant.slice(6))
  const source = kind === 'mark' ? sourceMark : skill
  const supportId = r.id.includes('shuiwenzhenji')
    ? 'mark_shuiwenzhenji'
    : r.id.includes('shazhidanke')
      ? 'mark_shazhidanke'
      : r.id.includes('heimowuzhi') || r.id.includes('heianwuzhi')
        ? 'mark_heianwuzhi'
        : r.id.includes('huanxiang')
          ? 'mark_huanxiang'
          : r.id.includes('dongqifuti')
            ? 'mark_dongqifuti'
            : undefined
  if (supportId)
    for (const owner of [a.activePet, b.activePet]) {
      support.push(
        add(
          owner,
          supportId,
          variant === 'one-layer' || variant === 'redirect' ? (r.id.includes('heimowuzhi') ? 2 : 1) : 3,
        ),
      )
      if (variant === 'multi-mark') support.push(add(owner, supportId, 2))
    }
  const clearSupports = () => {
    for (const owner of [a.activePet, b.activePet]) owner.marks = owner.marks.filter(m => !support.includes(m))
  }
  if (variant === 'missing-support') clearSupports()
  source.effects.push(native ? generatedSkillOutcomeSequences[r.id] : oracles.get(r.id)!)
  const turn = new TurnContext(battle)
  let use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  use.updateActualTarget()
  use.power = 100
  use.accuracy = 50
  use.critRate = 10
  use.category = variant === 'event-status' ? Category.Status : Category.Physical
  if (variant === 'wrong-element') use.element = Element.Normal
  let outer: EffectContext<EffectTrigger> | undefined
  const admitted: number[] = []
  const destruction: { id: string; hit: number; crit: number; power: number; accuracy: number }[] = []
  for (const mark of [sourceMark, ...support])
    mark.effects.push(
      defineNativeEffect({
        id: `fixture/destroy-${mark.id}` as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply(c) {
          if (!(c.parent instanceof RemoveMarkContext) || c.parent.parent !== outer) return
          destruction.push({
            id: mark.baseId,
            hit: use.hitOverrides.length,
            crit: use.critOverrides.length,
            power: use.power,
            accuracy: use.accuracy,
          })
          if (variant === 'redirect' && outer) use.actualTarget = b.team[1]
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
        if (variant === 'late-stack')
          sourceMark.stack = r.id === 'effect_mark_amplify_next_damage_skill_power_with_stack' ? 150 : 7
        if (variant === 'late-element') use.element = Element.Normal
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
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeEffect, source) : use
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
    next: battle.random(),
  }
}
for (const r of records) {
  it(`${r.id} audits full ordered source and correction nodes`, () => {
    expect(() => EffectParser.parse(definitions.get(r.id))).toThrow()
    const paths: string[] = []
    copy(definitions.get(r.id), paths)
    expect(r.recipe.repairedPaths).toEqual(paths)
    expect(r.recipe.actions.map(a => a.sourcePath)).toEqual(
      definitions.get(r.id)!.apply.map((_: unknown, i: number) => `/apply/${i}`),
    )
    expect(r.recipe.pathRepairs ?? []).toEqual(
      r.id === 'effect_mark_next_non_status_skill_sure_crit'
        ? [{ path: '/condition/conditions/2/target/chain/0/arg', before: 'skillId', after: 'skill' }]
        : [],
    )
    const normalize = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(normalize)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b, 'en'))
                .map(([k, value]) => [k, normalize(value)]),
            )
          : v
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definitions.get(r.id))))
        .digest('hex'),
    ).toBe(r.definitionSha256)
  })
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${r.id} ${kind}: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      if (
        [
          'normal',
          'late-support',
          'late-owner',
          'late-target',
          'late-stack',
          'cancel',
          'one-layer',
          'phase',
          'turn',
          'multi-mark',
          'redirect',
        ].includes(variant)
      )
        expect(actual.admitted).toHaveLength(1)
      if (variant === 'normal') {
        if (r.id === 'effect_mark_amplify_next_electric_skill') expect(actual.use.power).toBe(200)
        if (r.id === 'effect_mark_amplify_next_damage_skill_power_with_stack') expect(actual.use.power).toBe(100)
        if (r.id === 'effect_skill_add_power_10_consume_shazhidanke') expect(actual.use.power).toBe(110)
        if (r.id === 'effect_skill_add_power_50_consume_heianwuzhi') {
          expect(actual.use.power).toBe(150)
          expect(actual.support.map(m => m.stack)).toEqual([3, 2])
        }
        if (kind === 'mark' && r.id.startsWith('effect_mark_amplify_next')) expect(actual.source.active).toBe(false)
        if (r.id.includes('add_crit_rate')) expect(actual.use.critRate).toBe(15)
        if (r.id.includes('damage_increase')) {
          expect(actual.use.power).toBe(150)
          expect(actual.use.hit).toEqual([{ willHit: true, priority: 1 }])
        }
        if (r.id.includes('reduce_accuracy')) {
          expect(actual.use.accuracy).toBe(kind === 'mark' ? 47 : 50)
          expect(actual.source.active).toBe(kind !== 'mark')
        }
        if (r.id.includes('sure_crit'))
          expect(actual.use.crit).toEqual([{ willCrit: true, priority: r.id.includes('dongqifuti') ? 0 : 1 }])
        if (r.id.includes('huanxiang')) expect(actual.use.hit).toEqual([{ willHit: true, priority: 99 }])
        if (r.id === 'effect_skill_sure_hit_consume_shazhidanke')
          expect(actual.use.hit).toEqual([{ willHit: true, priority: 2 }])
        if (r.id.includes('dongqifuti')) expect(actual.support.map(m => m.active)).toEqual([true, false])
        if (r.id.includes('heimowuzhi')) expect(actual.support.map(m => m.stack)).toEqual([3, 1])
        if (r.id.includes('huanxiang') || r.id.includes('shazhidanke'))
          expect(actual.support.map(m => m.stack)).toEqual([2, 3])
      }
      if (variant === 'missing-support')
        expect(actual.admitted).toHaveLength(
          /shuiwenzhenji|shazhidanke|heimowuzhi|heianwuzhi|huanxiang|dongqifuti/.test(r.id) ? 0 : 1,
        )
      if (r.id.includes('dongqifuti') && ['normal', 'one-layer', 'phase', 'turn'].includes(variant)) {
        expect(actual.destruction).toHaveLength(1)
        expect(actual.destruction[0].crit).toBe(1)
      }
      if (variant === 'late-stack' && r.id === 'effect_mark_amplify_next_damage_skill_power_with_stack')
        expect(actual.use.power).toBe(kind === 'mark' ? 200 : 100)
      if (variant === 'one-layer') {
        if (r.id.includes('add_power')) {
          expect(actual.destruction).toHaveLength(1)
          expect(actual.destruction[0].power).toBe(r.id.includes('power_10') ? 110 : 150)
          expect(actual.destruction[0].hit).toBe(0)
        }
        if (/shazhidanke|huanxiang|heimowuzhi/.test(r.id) && !r.id.includes('add_power')) {
          expect(actual.destruction).toHaveLength(1)
          expect(actual.destruction[0].hit).toBe(r.id.includes('shazhidanke') ? 1 : 0)
          expect(actual.destruction[0].crit).toBe(0)
          expect(actual.use.hit.length + actual.use.crit.length).toBe(1)
        }
        if (r.id.includes('dongqifuti')) {
          expect(actual.destruction).toHaveLength(1)
          expect(actual.destruction[0].crit).toBe(1)
          expect(actual.support.map(m => m.active)).toEqual([true, false])
        }
        if (kind === 'mark' && r.id.includes('damage_increase')) {
          expect(actual.destruction[0]).toMatchObject({ hit: 0, power: 100 })
          expect(actual.use.power).toBe(150)
          expect(actual.use.hit).toEqual([{ willHit: true, priority: 1 }])
        }
        if (kind === 'mark' && r.id.includes('reduce_accuracy')) expect(actual.destruction[0].accuracy).toBe(49)
      }
      if (variant === 'event-status')
        expect(actual.admitted).toHaveLength(/damage_increase|damage_skill_power/.test(r.id) ? 0 : 1)
      if (variant === 'skill-status') expect(actual.admitted).toHaveLength(r.id.includes('non_status') ? 0 : 1)
      if (variant === 'cancel') {
        expect(actual.use.hit).toEqual([])
        expect(actual.use.crit).toEqual([])
        expect(actual.source.stack).toBe(3)
        expect(actual.destruction).toEqual([])
      }
    })
}
it('audits exact generated sequence ID coverage', () =>
  expect(Object.keys(generatedSkillOutcomeSequences).sort()).toEqual(records.map(r => r.id).sort()))

for (const kind of ['skill', 'mark'] as const) {
  for (const variant of powerVariants) {
    const id = variant.includes('element')
      ? 'effect_mark_amplify_next_electric_skill'
      : 'effect_mark_amplify_next_damage_skill_power_with_stack'
    const r = records.find(r => r.id === id)!
    it(`${id} ${kind} power boundary: ${variant}`, () => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      const admitted = variant !== 'wrong-element'
      expect(actual.admitted).toHaveLength(admitted ? 1 : 0)
      const expected =
        variant === 'wrong-element'
          ? 100
          : variant === 'late-element'
            ? 200
            : kind === 'skill'
              ? 100
              : 100 * (Math.floor(Number(variant.slice(6)) * 0.01) + 1)
      expect(actual.use.power).toBe(expected)
      if (kind === 'mark') {
        expect(actual.source.active).toBe(!admitted)
        if (admitted) expect(actual.destruction[0].power).toBe(expected)
      }
    })
  }
}
