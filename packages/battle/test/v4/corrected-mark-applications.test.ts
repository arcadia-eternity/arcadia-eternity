import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  createGeneratedMarkApplications,
  defineNativeEffect,
  BaseMark,
  SkillInstance,
  SkillPhase,
  Pet,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  Category,
  GameRng,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
type RecordEntry = {
  id: keyof ReturnType<typeof createGeneratedMarkApplications>
  sourceFile: string
  status: string
  recipe: {
    selectorRepairs?: string[]
    pathRepairs?: { path: string; before: string; after: string }[]
    additionalDecisions?: string[]
    markId: string
    target: 'self' | 'opponent'
    stack?: number
    triggers: ('OnHit' | 'OnMiss' | 'BeforeMultiHit')[]
  }
  dependency: { sourceFile: string }
}
const load = (path: string): { id: string }[] =>
  parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'), { merge: true })
const allRecords: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
).records.filter((r: RecordEntry) => r.status === 'generated-candidate')
const records = allRecords.filter(r => r.recipe.selectorRepairs)
const files = new Map<string, { id: string }[]>()
for (const r of allRecords)
  for (const path of [r.sourceFile, r.dependency.sourceFile]) if (!files.has(path)) files.set(path, load(path))
const marks = new Map(
  allRecords.map(r => [
    r.recipe.markId,
    MarkParser.parse({ ...files.get(r.dependency.sourceFile)!.find(d => d.id === r.recipe.markId), effect: [] }),
  ]),
)
const candidates = createGeneratedMarkApplications(marks)
const definitions = new Map(records.map(r => [r.id, files.get(r.sourceFile)!.find(d => d.id === r.id)!]))
// Independent corrected-rule oracle: change only the reviewed source nodes, never production YAML.
function reference(r: RecordEntry, repairPaths = true) {
  const copy = structuredClone(definitions.get(r.id)) as unknown as {
    condition: { conditions: [unknown, { target: { base: string; chain: { type: string; arg: unknown }[] } }] }
  }
  const target = copy.condition.conditions[1].target
  expect(target.base).toBe('useSkillContext')
  target.base = 'usingSkillContext'
  if (
    repairPaths &&
    (r.id === 'effect_ability_add_mark_opponent_xifamihuo_if_using_xifa_skill' ||
      r.id === 'effect_emblem_add_mark_fenshenhying_when_use_fenshenshu')
  ) {
    expect(target.chain[0]).toEqual({ type: 'selectPath', arg: 'skillId' })
    target.chain[0].arg = 'skill'
  }
  return copy
}
const oracles = new Map(records.map(r => [r.id, EffectParser.parse(reference(r))]))
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'real-skill',
  'wrong-condition',
  'wrong-owner',
  'other-skill',
  'late-condition',
  'late-owner',
  'late-opponent',
  'cancel-effect',
  'cancel-add',
  'existing',
] as const
function run(
  r: RecordEntry,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
  trigger: 'OnHit' | 'OnMiss' | 'BeforeMultiHit',
  counts?: { requested: number; computed: number; hit?: boolean },
) {
  const { battle, a, b, debuff } = makeScenario(31)
  battles.push(battle)
  const owner = a.activePet,
    skill = owner.skills[0]
  skill.effects.splice(0)
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/corrected-source' as baseMarkId, [], debuff.config).createInstance()
    source.owner = owner
    owner.marks.push(source)
  }
  source.effects.push(native ? candidates[r.id] : oracles.get(r.id)!)
  if (variant === 'wrong-owner') source.owner = b.activePet
  const selectedSkill = variant === 'other-skill' ? new SkillInstance(skill.base, { effects: [] }) : skill
  if (variant === 'other-skill') selectedSkill.owner = owner
  if (variant === 'other-skill') owner.skills.push(selectedSkill)
  const use = new UseSkillContext(new TurnContext(battle), a, owner, AttackTargetOpinion.opponent, selectedSkill)
  use.updateActualTarget()
  function setCondition(valid: boolean) {
    if (r.id.endsWith('_if_3_hits')) {
      use.multihit = valid ? 3 : 2
      use.multihitResult = valid ? 3 : 2
    } else if (r.id.includes('xifamihuo'))
      selectedSkill.tags.splice(0, selectedSkill.tags.length, ...(valid ? ['xifa'] : []))
    else if (r.id.includes('fenshenhying'))
      Object.defineProperty(selectedSkill.base, 'id', {
        configurable: true,
        value: valid ? 'skill_fenshenshu' : 'fixture/other',
      })
    else
      use.category = valid
        ? r.id.includes('_atk_')
          ? Category.Physical
          : r.id.includes('_spa_')
            ? Category.Special
            : Category.Climax
        : Category.Status
  }
  setCondition(variant !== 'wrong-condition')
  if (counts) {
    use.multihit = counts.requested
    use.multihitResult = counts.computed
  }
  const base = marks.get(r.recipe.markId)!,
    repo = DataRepository.getInstance(),
    previous = repo.marks.get(base.id)
  repo.marks.set(base.id, base)
  if (variant === 'existing') {
    const target = r.recipe.target === 'self' ? owner : b.activePet
    const instance = base.createInstance({ stack: 1 })
    instance.owner = target
    target.marks.push(instance)
  }
  const inputs: { target: string; stack: number; duration: number }[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/corrected-mark-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark, EffectTrigger.BeforeMultiHit],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === r.id),
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.BeforeMultiHit) ctx.parent.hitResult = counts?.hit ?? trigger !== 'OnMiss'
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          if (variant === 'late-condition') setCondition(false)
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'late-opponent') b.activePet = b.team[1]
          if (variant === 'cancel-effect') ctx.parent.available = false
        }
        if (ctx.trigger === EffectTrigger.OnBeforeAddMark && ctx.parent.baseMark === base) {
          inputs.push({
            target: ctx.parent.target instanceof Pet ? ctx.parent.target.id : 'battle',
            stack: ctx.parent.stack,
            duration: ctx.parent.duration,
          })
          if (variant === 'cancel-add') ctx.parent.available = false
        }
      },
    }),
  )
  try {
    if (variant === 'real-skill') {
      a.currentRage = a.maxRage
      const phase = new SkillPhase(battle, a, owner, AttackTargetOpinion.opponent, selectedSkill, use.parent, use)
      phase.initialize()
      phase.execute()
    } else battle.applyEffects(use, EffectTrigger[trigger])
    return {
      inputs,
      marks: [...a.team, ...b.team].flatMap(pet =>
        pet.marks.filter(m => m.baseId === base.id).map(m => ({ owner: pet.id, stack: m.stack, duration: m.duration })),
      ),
      nextRandom: battle.random(),
    }
  } finally {
    if (previous) repo.marks.set(base.id, previous)
    else repo.marks.delete(base.id)
  }
}
for (const r of records) {
  it(`${r.id} records explicit corrections and rejects the original definition`, () => {
    expect(() => EffectParser.parse(definitions.get(r.id))).toThrow()
    expect(r.recipe.selectorRepairs).toEqual(['/condition/conditions/1/target/base'])
    expect(r.recipe.additionalDecisions).toContain('C07')
    if (r.id.includes('xifamihuo') || r.id.includes('fenshenhying')) {
      expect(r.recipe.pathRepairs).toEqual([
        { path: '/condition/conditions/1/target/chain/0/arg', before: 'skillId', after: 'skill' },
      ])
      expect(r.recipe.additionalDecisions).toContain('C09')
      expect(() => EffectParser.parse(reference(r, false))).toThrow(/skillId/)
    } else expect(r.recipe.pathRepairs).toBeUndefined()
  })
  for (const kind of ['skill', 'mark'] as const)
    for (const trigger of r.recipe.triggers)
      it.each(variants)(`${r.id} corrected ${kind} ${trigger}: %s`, variant => {
        const actual = run(r, true, kind, variant, trigger)
        expect(actual).toEqual(run(r, false, kind, variant, trigger))
        if (variant !== 'real-skill') expect(actual.nextRandom).toBe(new GameRng(31).next())
        const admitted =
          !['wrong-condition', 'wrong-owner', 'cancel-effect'].includes(variant) &&
          !(variant === 'other-skill' && kind === 'skill')
        expect(actual.inputs).toHaveLength(admitted ? 1 : 0)
        if (!admitted || variant === 'cancel-add') expect(actual.marks).toEqual([])
        else {
          const target =
            variant === 'late-owner'
              ? r.recipe.target === 'self'
                ? 'B/lead'
                : 'A/lead'
              : r.recipe.target === 'self'
                ? 'A/lead'
                : variant === 'late-opponent'
                  ? 'B/reserve'
                  : 'B/lead'
          expect(actual.inputs[0]).toEqual({
            target,
            stack: r.recipe.stack ?? marks.get(r.recipe.markId)!.config.maxStacks,
            duration: marks.get(r.recipe.markId)!.config.duration,
          })
          expect(actual.marks).toHaveLength(1)
          expect(actual.marks[0].owner).toBe(target)
        }
      })
}
it('covers all eight corrected skill-context mark applications', () => expect(records).toHaveLength(8))

for (const kind of ['skill', 'mark'] as const)
  it.each([
    { requested: 3, computed: 0 },
    { requested: 3, computed: 2 },
    { requested: 3, computed: 4 },
    { requested: 4, computed: 3 },
  ])(`three-hit admission reads the computed result for ${kind}: %j`, counts => {
    const record = records.find(r => r.id === 'effect_skill_add_mark_opponent_zhongdu_if_3_hits')!
    const actual = run(record, true, kind, 'normal', 'BeforeMultiHit', counts)
    expect(actual).toEqual(run(record, false, kind, 'normal', 'BeforeMultiHit', counts))
    expect(actual.inputs).toHaveLength(counts.computed === 3 ? 1 : 0)
    expect(actual.marks).toHaveLength(counts.computed === 3 ? 1 : 0)
    expect(actual.nextRandom).toBe(new GameRng(31).next())
  })

for (const kind of ['skill', 'mark'] as const)
  it.each([
    { requested: 2, computed: 3, hit: true },
    { requested: 3, computed: 0, hit: false },
    { requested: 4, computed: 3, hit: true },
  ])(`three-hit admission follows real SkillPhase calculation before hit handling for ${kind}: %j`, counts => {
    const record = records.find(r => r.id === 'effect_skill_add_mark_opponent_zhongdu_if_3_hits')!
    const actual = run(record, true, kind, 'real-skill', 'BeforeMultiHit', counts)
    expect(actual).toEqual(run(record, false, kind, 'real-skill', 'BeforeMultiHit', counts))
    expect(actual.inputs).toHaveLength(counts.requested === 3 ? 1 : 0)
    expect(actual.marks).toHaveLength(counts.requested === 3 ? 1 : 0)
  })
