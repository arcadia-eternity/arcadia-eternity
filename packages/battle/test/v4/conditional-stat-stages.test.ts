import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedStatStageCandidates,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  defineNativeEffect,
  SkillPhase,
  SkillInstance,
  StatLevelMarkInstanceImpl,
  Gender,
  Pet,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
  type StatTypeWithoutHp,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
interface Entry {
  id: string
  sourceFile: string
  recipe: {
    when: string
    target: 'self' | 'opponent'
    stat: StatTypeWithoutHp
    value: number
    triggers: ('BeforeHit' | 'OnHit' | 'OnMiss')[]
  }
}
const records: Entry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/stat-stages-candidates.json', import.meta.url), 'utf8'),
).records.filter(
  (r: Entry & { recipe: { additionalDecisions?: string[]; valueCode?: string } }) =>
    r.recipe.when &&
    !r.recipe.additionalDecisions &&
    !r.recipe.valueCode &&
    r.recipe.triggers.every(trigger => ['BeforeHit', 'OnHit', 'OnMiss'].includes(trigger)),
)
const definitions = new Map<string, Record<string, unknown>>()
for (const file of new Set(records.map(r => r.sourceFile)))
  for (const d of parse(readFileSync(new URL(`../../../../${file}`, import.meta.url), 'utf8'), { merge: true }))
    definitions.set(d.id, d)
function nodes(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.flatMap(nodes)
    : v && typeof v === 'object'
      ? [v as Record<string, unknown>, ...Object.values(v).flatMap(nodes)]
      : []
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'false',
  'wrong-owner',
  'other-skill',
  'late-condition',
  'late-owner',
  'late-opponent',
  'cancel',
  'cancel-add',
  'existing',
  'phase',
] as const
function run(r: Entry, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const f = makeScenario(309),
    { battle, a, b } = f
  battles.push(battle)
  const allPets = [...a.team, ...b.team]
  for (const p of allPets) for (const s of p.skills) s.effects.splice(0)
  const clauses = nodes(definitions.get(r.id)!.condition)
  const defensive = clauses.some(c => c.type === 'selfBeSkillTarget')
  const actor = a.activePet,
    owner = defensive ? b.activePet : actor
  const skill = actor.skills[0]
  const source =
    kind === 'skill'
      ? owner.skills[0]
      : new BaseMark('fixture/conditional-stage' as baseMarkId, [], f.debuff.config).createInstance()
  if (kind === 'mark') {
    source.owner = owner
    owner.marks.push(source as (typeof owner.marks)[number])
  }
  const effects = generatedStatStageCandidates.effects as Record<string, (typeof skill.effects)[number]>
  source.effects.push(native ? effects[r.id] : EffectParser.parse(definitions.get(r.id)))
  const selected = variant === 'other-skill' ? new SkillInstance(skill.base, { effects: [] }) : skill
  selected.owner = actor
  const use = new UseSkillContext(new TurnContext(battle), a, actor, AttackTargetOpinion.opponent, selected)
  use.updateActualTarget()
  const conditionalMarks: (typeof owner.marks)[number][] = []
  function match(positive: boolean) {
    for (const p of allPets) p.marks = p.marks.filter(m => !conditionalMarks.includes(m))
    for (const c of clauses) {
      if (c.type === 'selfHasMark' || c.type === 'opponentHasMark') {
        if (positive) {
          const target = c.type === 'selfHasMark' ? owner : b.activePet
          const mark = new BaseMark(c.baseId as baseMarkId, [], f.debuff.config).createInstance()
          mark.owner = target
          target.marks.push(mark)
          conditionalMarks.push(mark)
        }
      }
      if (c.type === 'continuousUseSkill') actor.lastSkillUsedTimes = positive ? 2 : 1
      if (c.type === 'evaluate') {
        const target = c.target as { base: string; chain: { type: string; arg: unknown }[] }
        const evaluator = c.evaluator as { value: unknown }
        if (target.base === 'selfPlayer') a.currentRage = positive ? 10 : 80
        else if (target.chain?.[0]?.arg === 'gender') {
          const pet = target.base === 'self' ? owner : b.activePet
          pet.gender = positive ? (evaluator.value as Gender) : Gender.NoGender
        } else owner.currentHp = positive ? 1 : owner.stat.maxHp
      }
      if (c.type === 'selfBeSkillTarget') use.actualTarget = positive ? owner : actor
    }
  }
  match(variant !== 'false')
  if (variant === 'wrong-owner') source.owner = owner.owner!.team[1]
  const target = r.recipe.target === 'self' ? owner : b.activePet
  if (variant === 'existing')
    target.addStatStage(
      new EffectContext(use, EffectTrigger.BeforeHit, source),
      r.recipe.stat,
      r.recipe.value > 0 ? 5 : -5,
    )
  const inputs: { pet: number; stat: unknown; level: unknown }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/conditional-stage-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === r.id),
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          if (variant === 'late-condition') match(false)
          if (variant === 'late-owner') source.owner = owner.owner!.team[1]
          if (variant === 'late-opponent') b.activePet = b.team[1]
          if (variant === 'cancel') ctx.parent.available = false
        }
        if (ctx.trigger === EffectTrigger.OnBeforeAddMark) {
          inputs.push({
            pet: ctx.parent.target instanceof Pet ? allPets.indexOf(ctx.parent.target) : -1,
            stat: ctx.parent.baseMark.id,
            level: ctx.parent.stack,
          })
          if (variant === 'cancel-add') ctx.parent.available = false
        }
      },
    }),
  )
  if (variant === 'phase') {
    a.currentRage = a.maxRage
    // Rage condition belongs to admission; zero cost keeps the low-rage fixture valid.
    use.rage = 0
    if (clauses.some(c => (c.target as { base?: string })?.base === 'selfPlayer')) a.currentRage = 10
    actor.lastSkill = selected
    actor.lastSkillUsedTimes = 1
    use.hitOverrides.push({ willHit: !defensive, priority: 0 })
    const phase = new SkillPhase(battle, a, actor, AttackTargetOpinion.opponent, selected, use.parent, use)
    phase.initialize()
    phase.execute()
  } else battle.applyEffects(use, EffectTrigger[r.recipe.triggers[0]], source)
  return {
    inputs,
    levels: allPets.map(p =>
      p.marks
        .filter((m): m is StatLevelMarkInstanceImpl => m instanceof StatLevelMarkInstanceImpl)
        .map(m => ({ stat: m.statType, level: m.level })),
    ),
    nextRandom: battle.random(),
  }
}
it('covers all 33 newly authored conditional stat-stage definitions', () => {
  expect(records).toHaveLength(33)
})
for (const r of records)
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${r.id} ${kind}: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      if (['normal', 'late-condition', 'late-owner', 'late-opponent', 'existing', 'phase'].includes(variant)) {
        expect(actual.inputs).toHaveLength(1)
        expect(actual.levels.flat()).toHaveLength(1)
        expect(actual.levels.flat()[0].stat).toBe(r.recipe.stat)
        if (variant !== 'existing') expect(actual.levels.flat()[0].level).toBe(r.recipe.value)
      }
      if (['false', 'wrong-owner', 'cancel'].includes(variant)) expect(actual.inputs).toEqual([])
      if (variant === 'cancel-add') expect(actual.levels.flat()).toEqual([])
      if (variant === 'late-owner' && r.recipe.target === 'self')
        expect(actual.inputs[0].pet).toBe(r.id === 'effect_ability_raise_spe_1_stage_when_dodge' ? 3 : 1)
      if (variant === 'late-opponent' && r.recipe.target === 'opponent') expect(actual.inputs[0].pet).toBe(3)
    })
