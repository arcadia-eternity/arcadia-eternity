import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  defineNativeEffect,
  BaseMark,
  Pet,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  MarkUpdatePhase,
  RemoveMarkPhase,
  GameRng,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createGeneratedMarkApplications } from '@arcadia-eternity/data-pack-base/native'

type RecordEntry = {
  id: keyof ReturnType<typeof createGeneratedMarkApplications>
  status: string
  sourceFile: string
  recipe: { triggers: string[]; markId: string }
  dependency: { sourceFile: string }
}
const ledger: (Omit<RecordEntry, 'id'> & { id: string })[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
).records
const allRecords = ledger.filter((record): record is RecordEntry => record.status === 'generated-candidate')
const records = allRecords.filter(record =>
  record.recipe.triggers.some(trigger => ['OnMarkDestroy', 'OnMarkDurationEnd'].includes(trigger)),
)
const files = new Map<string, { id: string }[]>()
for (const record of allRecords)
  for (const path of [record.sourceFile, record.dependency.sourceFile])
    if (!files.has(path))
      files.set(path, parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'), { merge: true }))
const marks = new Map(
  allRecords.map(record => [
    record.recipe.markId,
    MarkParser.parse({
      ...files.get(record.dependency.sourceFile)!.find(d => d.id === record.recipe.markId),
      effect: [],
    }),
  ]),
)
const candidates = createGeneratedMarkApplications(marks)
const oracles = new Map(
  records.map(record => [record.id, EffectParser.parse(files.get(record.sourceFile)!.find(d => d.id === record.id))]),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'repeat',
  'cancel-effect',
  'cancel-add',
  'suppressed',
  'inactive',
  'indestructible',
  'late-owner',
  'existing',
  'modify',
  'not-expired',
  'persistent',
] as const
function run(record: RecordEntry, native: boolean, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(61)
  battles.push(battle)
  const turn = new TurnContext(battle)
  const expiration = record.recipe.triggers[0] === 'OnMarkDurationEnd'
  const sourceBase = new BaseMark(
    'fixture/lifecycle-source' as baseMarkId,
    [native ? candidates[record.id] : oracles.get(record.id)!],
    {
      ...debuff.config,
      persistent: variant === 'persistent',
      destroyable: variant !== 'indestructible',
      duration: variant === 'not-expired' ? 2 : 1,
    },
  )
  const source = sourceBase.createInstance()
  source.owner = a.activePet
  a.activePet.marks.push(source)
  const otherSource = sourceBase.createInstance()
  otherSource.owner = b.activePet
  b.activePet.marks.push(otherSource)
  if (variant === 'inactive') source.isActive = false
  if (variant === 'suppressed') source.isSuppressed = true
  const mark = marks.get(record.recipe.markId)!
  const repository = DataRepository.getInstance(),
    previous = repository.marks.get(mark.id)
  repository.marks.set(mark.id, mark)
  const setup = new EffectContext(turn, EffectTrigger.TurnStart, a.activePet.skills[0])
  if (variant === 'existing') battle.addMark(new AddMarkContext(setup, a.activePet, mark))
  const inputs: {
    target: string
    sourceOwner: string | null
    sourceActive: boolean
    stack: number
    duration: number
  }[] = []
  const creationStates: boolean[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/lifecycle-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark, EffectTrigger.OnAnyMarkAdded],
      when: context =>
        context.trigger !== EffectTrigger.BeforeEffect ||
        (context.parent instanceof EffectContext && context.parent.effect?.id === record.id),
      apply(context) {
        if (context.trigger === EffectTrigger.BeforeEffect && context.parent instanceof EffectContext) {
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'cancel-effect') context.parent.available = false
        }
        if (context.trigger === EffectTrigger.OnBeforeAddMark && context.parent.baseMark === mark) {
          inputs.push({
            target: context.parent.target instanceof Pet ? context.parent.target.id : 'battle',
            sourceOwner: source.owner instanceof Pet ? source.owner.id : null,
            sourceActive: source.isActive,
            stack: context.parent.stack,
            duration: context.parent.duration,
          })
          if (variant === 'cancel-add') context.parent.available = false
          if (variant === 'modify') {
            context.parent.setStack(2)
            context.parent.setDuration(7)
          }
        }
        if (context.trigger === EffectTrigger.OnAnyMarkAdded && context.parent.baseMark === mark)
          creationStates.push(source.isActive)
      },
    }),
  )
  try {
    const phase = expiration ? new MarkUpdatePhase(battle, turn, source) : new RemoveMarkPhase(battle, turn, source)
    phase.initialize()
    phase.execute()
    if (variant === 'repeat') {
      const repeated = expiration
        ? new MarkUpdatePhase(battle, turn, source)
        : new RemoveMarkPhase(battle, turn, source)
      repeated.initialize()
      repeated.execute()
    }
    return {
      otherSourceActive: otherSource.isActive,
      inputs,
      creationStates,
      source: {
        active: source.isActive,
        owner: source.owner instanceof Pet ? source.owner.id : null,
        duration: source.duration,
      },
      marks: [...a.team, ...b.team].flatMap(pet =>
        pet.marks
          .filter(instance => instance.baseId === mark.id)
          .map(instance => ({
            owner: pet.id,
            active: instance.isActive,
            stack: instance.stack,
            duration: instance.duration,
          })),
      ),
      nextRandom: battle.random(),
    }
  } finally {
    if (previous) repository.marks.set(mark.id, previous)
    else repository.marks.delete(mark.id)
  }
}
for (const record of records)
  it.each(variants)(`${record.id} uses real lifecycle phases: %s`, variant => {
    const actual = run(record, true, variant)
    expect(actual).toEqual(run(record, false, variant))
    const expiration = record.recipe.triggers[0] === 'OnMarkDurationEnd'
    const phaseReached =
      variant !== 'inactive' &&
      (expiration ? !['not-expired', 'persistent'].includes(variant) : variant !== 'indestructible')
    const admitted = phaseReached && !['suppressed', 'cancel-effect'].includes(variant)
    expect(actual.inputs).toHaveLength(admitted ? 1 : 0)
    expect(actual.nextRandom).toBe(new GameRng(61).next())
    expect(actual.otherSourceActive).toBe(true)
    if (admitted) {
      const owner = variant === 'late-owner' ? 'B/lead' : 'A/lead'
      expect(actual.inputs[0]).toMatchObject({ target: owner, sourceOwner: owner, sourceActive: true })
      if (variant !== 'cancel-add') {
        expect(actual.marks).toHaveLength(1)
        expect(actual.marks[0].owner).toBe(owner)
        if (variant === 'existing' && !marks.get(record.recipe.markId)!.config.stackable)
          expect(actual.creationStates).toEqual([])
        else expect(actual.creationStates.length).toBeGreaterThan(0)
        expect(actual.creationStates.every(Boolean)).toBe(true)
      }
    }
    if (phaseReached && variant !== 'indestructible')
      expect(actual.source).toMatchObject({ active: false, owner: null })
    if (!admitted || variant === 'cancel-add') expect(actual.marks).toEqual([])
  })
it('covers three lifecycle candidates and protects the handwritten destroy override', () => {
  expect(records).toHaveLength(3)
  expect(ledger.find(record => record.id === 'effect_mark_onDestroy_add_mark_shanghaizengjia')?.status).toBe(
    'handwritten-override-retained',
  )
  expect(Object.keys(candidates)).not.toContain('effect_mark_onDestroy_add_mark_shanghaizengjia')
})
