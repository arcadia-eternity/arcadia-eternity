import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  createGeneratedMarkApplications,
  generatedMarkApplicationDependencies,
  defineNativeEffect,
  BaseMark,
  Pet,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  setGlobalLogger,
  type Battle,
  type effectId,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

type Candidates = ReturnType<typeof createGeneratedMarkApplications>
interface RecordEntry {
  id: keyof Candidates
  status: string
  sourceFile: string
  definitionSha256: string
  recipe: {
    target: 'self' | 'opponent'
    markId: string
    stack?: number
    duration?: number
    triggers: ('OnHit' | 'OnMiss')[]
  }
  dependency: { id: string; sourceFile: string; definitionSha256: string; effectIds: string[] }
}
const records: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
).records.filter((record: RecordEntry) => record.status === 'generated-candidate')
const files = new Map<string, { id: string; effect?: string[] }[]>()
for (const record of records)
  for (const path of [record.sourceFile, record.dependency.sourceFile]) {
    if (!files.has(path))
      files.set(path, parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'), { merge: true }))
  }
// Explicit dependency test doubles: preserve official normalized config/tags, replace downstream
// mark behavior with an observable creation hook. No downstream effect migration is claimed here.
const baseMarks = new Map<string, BaseMark>()
for (const record of records)
  if (!baseMarks.has(record.recipe.markId)) {
    const definition = files.get(record.dependency.sourceFile)!.find(d => d.id === record.recipe.markId)!
    baseMarks.set(record.recipe.markId, MarkParser.parse({ ...definition, effect: [] }))
  }
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'wrong-skill',
  'late-owner',
  'late-opponent',
  'cancel-effect',
  'cancel-add',
  'modify',
  'existing',
] as const
function run(
  record: RecordEntry,
  native: boolean,
  kind: 'skill' | 'mark',
  trigger: 'OnHit' | 'OnMiss',
  variant: (typeof variants)[number],
) {
  const f = makeScenario(269),
    { battle, a, b } = f
  battles.push(battle)
  const owner = a.activePet,
    skill = owner.skills[0]
  skill.effects.splice(0)
  const events: unknown[] = [],
    inputs: { target: string; stack: number; duration: number }[] = []
  const base = baseMarks.get(record.recipe.markId)!
  const mark = new BaseMark(
    base.id,
    [
      defineNativeEffect({
        id: 'fixture/application-created' as effectId,
        triggers: [EffectTrigger.OnMarkCreated],
        apply(context) {
          events.push({
            created: context.parent.baseMark.id,
            target: context.parent.target instanceof Pet ? context.parent.target.id : 'battle',
            stack: context.parent.stack,
            duration: context.parent.duration,
          })
        },
      }),
    ],
    base.config,
    base.tags,
  )
  const dependencies = new Map(baseMarks)
  dependencies.set(mark.id, mark)
  const repository = DataRepository.getInstance(),
    previous = repository.marks.get(mark.id)
  repository.marks.set(mark.id, mark)
  try {
    const candidates = native ? createGeneratedMarkApplications(dependencies) : undefined
    dependencies.clear() // Published candidates retain the exact validated dependency objects.
    const effect = candidates
      ? candidates[record.id]
      : EffectParser.parse(files.get(record.sourceFile)!.find(d => d.id === record.id))
    const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
    let source: typeof skill | (typeof owner.marks)[number] = skill
    if (kind === 'mark') {
      const sourceMark = new BaseMark('fixture/application-source' as baseMarkId, [], f.debuff.config)
      battle.addMark(new AddMarkContext(setup, owner, sourceMark))
      source = owner.marks.find(m => m.base === sourceMark)!
    }
    source.effects.push(effect)
    if (variant === 'existing')
      battle.addMark(new AddMarkContext(setup, record.recipe.target === 'self' ? owner : b.activePet, mark, 1))
    events.length = 0
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/application-hook' as effectId,
        triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
        when: context =>
          context.trigger !== EffectTrigger.BeforeEffect ||
          (context.parent instanceof EffectContext && context.parent.effect?.id === record.id),
        apply(context) {
          if (context.trigger === EffectTrigger.BeforeEffect && context.parent instanceof EffectContext) {
            if (variant === 'cancel-effect') context.parent.available = false
            if (variant === 'late-owner') source.owner = b.activePet
            if (variant === 'late-opponent') b.activePet = b.team[1]
          }
          if (context.trigger === EffectTrigger.OnBeforeAddMark && context.parent.baseMark === mark) {
            inputs.push({
              target: context.parent.target instanceof Pet ? context.parent.target.id : 'battle',
              stack: context.parent.stack,
              duration: context.parent.duration,
            })
            if (variant === 'cancel-add') context.parent.available = false
            if (variant === 'modify') {
              context.parent.setStack(2)
              context.parent.setDuration(7)
            }
          }
        },
      }),
    )
    const parent = new UseSkillContext(
      new TurnContext(battle),
      a,
      owner,
      AttackTargetOpinion.opponent,
      variant === 'wrong-skill' ? b.activePet.skills[0] : skill,
    )
    battle.applyEffects(parent, EffectTrigger[trigger], source)
    return {
      marks: [...a.team, ...b.team].map(pet =>
        pet.marks
          .filter(m => m.baseId === mark.id)
          .map(m => ({
            id: m.baseId,
            stack: m.stack,
            duration: m.duration,
            active: m.isActive,
            owner: m.owner instanceof Pet ? m.owner.id : undefined,
          })),
      ),
      inputs,
      events,
      nextRandom: battle.random(),
    }
  } finally {
    if (previous) repository.marks.set(mark.id, previous)
    else repository.marks.delete(mark.id)
  }
}
for (const record of records)
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${record.id} ${kind} matches YAML for %s`, variant => {
      for (const trigger of record.recipe.triggers) {
        const actual = run(record, true, kind, trigger, variant)
        expect(actual).toEqual(run(record, false, kind, trigger, variant))
        if (variant === 'normal') {
          const base = baseMarks.get(record.recipe.markId)!,
            target = record.recipe.target === 'self' ? 0 : 2
          expect(actual.inputs).toEqual([
            {
              target: target === 0 ? 'A/lead' : 'B/lead',
              stack: record.recipe.stack ?? base.config.maxStacks,
              duration: record.recipe.duration ?? base.config.duration,
            },
          ])
          expect(actual.marks[target]).toHaveLength(1)
          expect(actual.events.length).toBeGreaterThan(0)
        }
        if (variant === 'cancel-effect' || (variant === 'wrong-skill' && kind === 'skill'))
          expect(actual.inputs).toEqual([])
        if (variant === 'cancel-add') expect(actual.marks.flat()).toEqual([])
      }
    })
it('requires all exact dependencies before publishing any candidate and captures the supplied catalog', () => {
  expect(() => createGeneratedMarkApplications(new Map())).toThrow('Missing or mismatched')
  const invalid = new Map(baseMarks)
  invalid.set(generatedMarkApplicationDependencies[0], baseMarks.get(generatedMarkApplicationDependencies[1])!)
  expect(() => createGeneratedMarkApplications(invalid)).toThrow('Missing or mismatched')
  const candidates = createGeneratedMarkApplications(baseMarks)
  expect(Object.keys(candidates).sort()).toEqual(records.map(record => record.id).sort())
  expect(Object.isFrozen(candidates)).toBe(true)
})
it('pins each effect and its entire mark dependency definition to current sources', () => {
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, normalize(item)]),
          )
        : value
  const hash = (value: unknown) =>
    createHash('sha256')
      .update(JSON.stringify(normalize(value)))
      .digest('hex')
  for (const record of records) {
    expect(hash(files.get(record.sourceFile)!.find(d => d.id === record.id))).toBe(record.definitionSha256)
    const mark = files.get(record.dependency.sourceFile)!.find(d => d.id === record.dependency.id)!
    expect(hash(mark)).toBe(record.dependency.definitionSha256)
    expect(record.dependency.effectIds).toEqual(mark.effect ?? [])
  }
  expect([...generatedMarkApplicationDependencies].sort()).toEqual(
    [...new Set(records.map(record => record.recipe.markId))].sort(),
  )
})
