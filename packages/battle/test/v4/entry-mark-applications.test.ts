import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  createGeneratedMarkApplications,
  defineNativeEffect,
  BaseMark,
  GameRng,
  Pet,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  SwitchPetContext,
  SwitchPetPhase,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

type CandidateId = keyof ReturnType<typeof createGeneratedMarkApplications>
type RecordEntry = {
  id: CandidateId
  sourceFile: string
  status: string
  recipe: { triggers: string[]; target: 'self' | 'opponent' | 'battle'; markId: string; when: string }
  dependency: { id: string; sourceFile: string }
}
const allRecords: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
).records.filter((r: RecordEntry) => r.status === 'generated-candidate')
const records = allRecords.filter(record =>
  record.recipe.triggers.some(trigger => ['OnSwitchIn', 'OnBattleStart'].includes(trigger)),
)
const files = new Map<string, { id: string }[]>()
for (const record of allRecords)
  for (const path of [record.sourceFile, record.dependency.sourceFile])
    if (!files.has(path))
      files.set(path, parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'), { merge: true }))
// Preserve dependency configuration; downstream mark effects have their own migration gates.
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
  'wrong-owner',
  'late-owner',
  'late-active',
  'inactive-incoming',
  'cancel-effect',
  'cancel-add',
  'modify',
  'existing',
] as const
function run(
  record: RecordEntry,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
  realSwitch = false,
) {
  const { battle, a, b, debuff } = makeScenario(31)
  battles.push(battle)
  const switching = record.recipe.triggers[0] === 'OnSwitchIn'
  const owner = switching ? a.team[1] : a.team[0]
  const skill = owner.skills[0]
  skill.effects.splice(0)
  const parent = switching ? new SwitchPetContext(new TurnContext(battle), a, owner) : battle
  const sourceOwner = variant === 'wrong-owner' ? (switching ? a.team[0] : a.team[1]) : owner
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/entry-source' as baseMarkId, [], {
      ...debuff.config,
      keepOnSwitchOut: true,
    }).createInstance()
    sourceOwner.marks.push(source)
  }
  source.owner = sourceOwner
  if (switching && !realSwitch && variant !== 'inactive-incoming') a.activePet = owner
  const mark = marks.get(record.recipe.markId)!
  const repository = DataRepository.getInstance()
  const previous = repository.marks.get(mark.id)
  repository.marks.set(mark.id, mark)
  const inputs: { owner: string; stack: number; duration: number }[] = []
  const created: string[] = []
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  if (variant === 'existing')
    battle.addMark(new AddMarkContext(setup, record.recipe.target === 'battle' ? battle : owner, mark))
  source.effects.push(native ? candidates[record.id] : oracles.get(record.id)!)
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/entry-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark, EffectTrigger.OnAnyMarkAdded],
      when: context =>
        context.trigger !== EffectTrigger.BeforeEffect ||
        (context.parent instanceof EffectContext && context.parent.effect?.id === record.id),
      apply(context) {
        if (context.trigger === EffectTrigger.BeforeEffect && context.parent instanceof EffectContext) {
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'late-active') a.activePet = switching ? a.team[0] : a.team[1]
          if (variant === 'cancel-effect') context.parent.available = false
        }
        if (context.trigger === EffectTrigger.OnBeforeAddMark && context.parent.baseMark === mark) {
          inputs.push({
            owner: context.parent.target instanceof Pet ? context.parent.target.id : 'battle',
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
          created.push(context.parent.target instanceof Pet ? context.parent.target.id : 'battle')
      },
    }),
  )
  try {
    if (realSwitch) {
      const phase = new SwitchPetPhase(battle, a, owner, new TurnContext(battle))
      phase.initialize()
      phase.execute()
    } else if (parent instanceof SwitchPetContext) battle.applyEffects(parent, EffectTrigger.OnSwitchIn, source)
    else battle.applyEffects(battle, EffectTrigger.OnBattleStart, source)
    return {
      inputs,
      created,
      active: a.activePet.id,
      marks: [...a.team, ...b.team, battle].flatMap(target =>
        target.marks
          .filter(m => m.baseId === mark.id)
          .map(m => ({
            owner: m.owner instanceof Pet ? m.owner.id : 'battle',
            stack: m.stack,
            duration: m.duration,
            active: m.isActive,
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
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${record.id} ${kind} matches entry YAML: %s`, variant => {
      const actual = run(record, true, kind, variant)
      expect(actual).toEqual(run(record, false, kind, variant))
      expect(actual.nextRandom).toBe(new GameRng(31).next())
      const conditional = record.recipe.when !== '() => true'
      const admitted = !(variant === 'wrong-owner' && conditional) && variant !== 'cancel-effect'
      expect(actual.inputs).toHaveLength(admitted ? 1 : 0)
      if (!admitted || variant === 'cancel-add') expect(actual.marks).toEqual([])
      if (admitted) {
        const expectedOwner =
          record.recipe.target === 'battle'
            ? 'battle'
            : variant === 'late-owner'
              ? 'B/lead'
              : variant === 'wrong-owner'
                ? 'A/reserve'
                : record.recipe.triggers[0] === 'OnSwitchIn'
                  ? 'A/reserve'
                  : 'A/lead'
        expect(actual.inputs[0].owner).toBe(expectedOwner)
        if (variant !== 'cancel-add') {
          expect(actual.marks).toHaveLength(1)
          expect(actual.marks[0].owner).toBe(expectedOwner)
          if (variant === 'modify')
            expect(actual.marks[0].duration).toBe(marks.get(record.recipe.markId)!.config.persistent ? -1 : 7)
        }
      }
    })
for (const record of records.filter(record => record.recipe.triggers[0] === 'OnSwitchIn'))
  for (const kind of ['skill', 'mark'] as const)
    it(`${record.id} ${kind} runs through the real switch phase`, () => {
      const actual = run(record, true, kind, 'normal', true)
      expect(actual).toEqual(run(record, false, kind, 'normal', true))
      expect(actual.active).toBe('A/reserve')
      expect(actual.inputs).toHaveLength(1)
      expect(actual.marks).toHaveLength(1)
    })
it('covers five switch-in and three battle-start applications', () => {
  expect(records.filter(record => record.recipe.triggers[0] === 'OnSwitchIn')).toHaveLength(5)
  expect(records.filter(record => record.recipe.triggers[0] === 'OnBattleStart')).toHaveLength(3)
})
