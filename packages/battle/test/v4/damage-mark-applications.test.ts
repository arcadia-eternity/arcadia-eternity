import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  createGeneratedMarkApplications,
  defineNativeEffect,
  BaseMark,
  Pet,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  DamagePhase,
  DamageContext,
  DamageType,
  GameRng,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { thresholdSeeds } from './probability-threshold'
const probabilitySeeds = thresholdSeeds(50)

type RecordEntry = {
  id: keyof ReturnType<typeof createGeneratedMarkApplications>
  sourceFile: string
  status: string
  recipe: { triggers: string[]; target: 'self' | 'opponent'; markId: string; when: string; stack?: number }
  dependency: { sourceFile: string }
}
const allRecords: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
).records.filter((r: RecordEntry) => r.status === 'generated-candidate')
const records = allRecords.filter(record =>
  record.recipe.triggers.some(trigger => ['OnDamage', 'PostDamage'].includes(trigger)),
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
  'wrong-owner',
  'wrong-type',
  'nonpet-damage',
  'cancel-effect',
  'cancel-add',
  'late-owner',
  'late-opponent',
  'late-type',
] as const
function run(
  record: RecordEntry,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
  seed: number,
) {
  const { battle, a, b, debuff } = makeScenario(seed)
  battles.push(battle)
  const owner = a.activePet,
    skill = owner.skills[0]
  skill.effects.splice(0)
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/damage-source' as baseMarkId, [], debuff.config).createInstance()
    source.owner = owner
    owner.marks.push(source)
  }
  source.effects.push(native ? candidates[record.id] : oracles.get(record.id)!)
  const mark = marks.get(record.recipe.markId)!
  const repository = DataRepository.getInstance(),
    previous = repository.marks.get(mark.id)
  repository.marks.set(mark.id, mark)
  const target = variant === 'wrong-owner' ? a.team[1] : owner
  const originalHp = target.currentHp
  const inputs: { target: string; hp: number; stack: number; duration: number }[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/damage-mark-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
      when: context =>
        context.trigger !== EffectTrigger.BeforeEffect ||
        (context.parent instanceof EffectContext && context.parent.effect?.id === record.id),
      apply(context) {
        if (context.trigger === EffectTrigger.BeforeEffect && context.parent instanceof EffectContext) {
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'late-opponent') b.activePet = b.team[1]
          if (variant === 'late-type' && context.parent.parent instanceof DamageContext)
            context.parent.parent.damageType = DamageType.Special
          if (variant === 'cancel-effect') context.parent.available = false
        }
        if (context.trigger === EffectTrigger.OnBeforeAddMark && context.parent.baseMark === mark) {
          inputs.push({
            target: context.parent.target instanceof Pet ? context.parent.target.id : 'battle',
            hp: target.currentHp,
            stack: context.parent.stack,
            duration: context.parent.duration,
          })
          if (variant === 'cancel-add') context.parent.available = false
        }
      },
    }),
  )
  try {
    const parent = new UseSkillContext(
      new TurnContext(battle),
      b,
      b.activePet,
      AttackTargetOpinion.opponent,
      b.activePet.skills[0],
    )
    parent.updateActualTarget()
    const phase = new DamagePhase(
      battle,
      parent,
      variant === 'nonpet-damage' ? b.activePet.skills[0] : b.activePet,
      target,
      7,
      variant === 'wrong-type' ? DamageType.Special : DamageType.Physical,
    )
    phase.initialize()
    phase.execute()
    return {
      originalHp,
      hp: target.currentHp,
      inputs,
      marks: [...a.team, ...b.team].flatMap(pet =>
        pet.marks
          .filter(m => m.baseId === mark.id)
          .map(m => ({ owner: pet.id, stack: m.stack, duration: m.duration, active: m.isActive })),
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
    it.each(variants)(`${record.id} ${kind} uses the damage phase: %s`, variant => {
      for (const seed of probabilitySeeds) {
        const actual = run(record, true, kind, variant, seed)
        expect(actual).toEqual(run(record, false, kind, variant, seed))
        const eligible =
          variant !== 'wrong-owner' &&
          !(variant === 'nonpet-damage' && record.recipe.triggers[0] === 'PostDamage') &&
          !(variant === 'wrong-type' && record.id === 'effect_mark_paralyze_on_physical_50_percent')
        const probabilistic = record.recipe.when.includes('conditions.chance(')
        const rng = new GameRng(seed)
        const admitted = eligible && (!probabilistic || rng.next() < 0.5)
        expect(actual.nextRandom).toBe(rng.next())
        expect(actual.hp).toBe(actual.originalHp - 7)
        const writes = admitted && variant !== 'cancel-effect'
        expect(actual.inputs).toHaveLength(writes ? 1 : 0)
        if (writes) {
          const destination =
            variant === 'late-owner'
              ? record.recipe.target === 'self'
                ? 'B/lead'
                : 'A/lead'
              : record.recipe.target === 'self'
                ? 'A/lead'
                : variant === 'late-opponent'
                  ? 'B/reserve'
                  : 'B/lead'
          expect(actual.inputs[0]).toEqual({
            target: destination,
            hp: actual.hp,
            stack: record.recipe.stack ?? marks.get(record.recipe.markId)!.config.maxStacks,
            duration: marks.get(record.recipe.markId)!.config.duration,
          })
          if (variant !== 'cancel-add') expect(actual.marks).toHaveLength(1)
        }
        if (!writes || variant === 'cancel-add') expect(actual.marks).toEqual([])
      }
    })
it('covers two post-damage applications and one physical-damage application', () => {
  expect(records).toHaveLength(3)
  expect(records.filter(record => record.recipe.triggers[0] === 'PostDamage')).toHaveLength(2)
})
