import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  DamageContext,
  SkillPhase,
  Category,
  defineNativeEffect,
  EffectTrigger,
  EffectContext,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  AddMarkContext,
  BaseMark,
  Pet,
  StatLevelMarkInstanceImpl,
  StatTypeWithoutHp,
  ConfigModifierType,
  ConfigDurationType,
  setGlobalLogger,
  type Battle,
  type effectId,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedStatStageCandidates } from '@arcadia-eternity/data-pack-base/native'

interface Entry {
  id: keyof typeof generatedStatStageCandidates.effects
  sourceFile: string
  definitionSha256: string
  recipe: {
    target: 'self' | 'opponent'
    stat: StatTypeWithoutHp
    value: number
    triggers: 'OnDamage'[]
    clauses: { kind: string; parameter?: boolean; tags?: string[] }[]
  }
}
type LedgerEntry = Omit<Entry, 'recipe'> & {
  recipe: Omit<Entry['recipe'], 'clauses' | 'triggers'> & {
    triggers: string[]
    clauses?: Entry['recipe']['clauses']
    when?: string
  }
}
const allRecords: LedgerEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/stat-stages-candidates.json', import.meta.url), 'utf8'),
).records
const records: Entry[] = allRecords
  .filter(r => r.id === 'effect_skill_reduce_stat_5_percent')
  .map(r => ({
    ...r,
    recipe: {
      ...r.recipe,
      triggers: ['OnDamage'],
      clauses: [{ kind: 'self' }, { kind: 'probability', tags: ['skill_effect_probability'] }],
    },
  }))
const sources = new Map<string, { id: string }[]>()
for (const r of allRecords)
  if (!sources.has(r.sourceFile))
    sources.set(
      r.sourceFile,
      parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true }),
    )
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'wrong-skill',
  'late-owner',
  'late-opponent',
  'cancel-effect',
  'cancel-add',
  'existing',
  'force-zero',
  'force-hundred',
  'late-probability',
  'scoped-other',
  'missing-skill',
  'nested',
  'phase',
] as const
function run(
  r: Entry,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
  trigger: Entry['recipe']['triggers'][number],
) {
  // Register legacy raw parameters before Battle clones its configuration.
  const effect = native
    ? generatedStatStageCandidates.effects[r.id]
    : EffectParser.parse(sources.get(r.sourceFile)!.find(d => d.id === r.id))
  const f = makeScenario(301),
    { battle, a, b } = f
  battles.push(battle)
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  const owner = a.activePet,
    skill = owner.skills[0]
  skill.effects.splice(0)
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    const base = new BaseMark('fixture/stage-source' as baseMarkId, [], f.debuff.config)
    battle.addMark(new AddMarkContext(setup, owner, base))
    source = owner.marks.find(m => m.base === base)!
  }
  const target = r.recipe.target === 'self' ? owner : b.activePet
  if (variant === 'existing') target.addStatStage(setup, r.recipe.stat, r.recipe.value > 0 ? 5 : -5)
  const before = target.stat[r.recipe.stat]
  source.effects.push(effect)
  const override = (value: number, scope = source) => {
    for (const tag of new Set(r.recipe.clauses.flatMap(c => c.tags ?? [])))
      battle.configSystem.addTaggedConfigModifier(
        tag,
        ConfigModifierType.override,
        value,
        0,
        ConfigDurationType.binding,
        undefined,
        scope,
      )
  }
  if (
    [
      'late-owner',
      'late-opponent',
      'cancel-effect',
      'cancel-add',
      'existing',
      'nested',
      'missing-skill',
      'phase',
    ].includes(variant)
  )
    override(100)
  if (variant === 'force-zero') override(0)
  if (variant === 'force-hundred' || variant === 'late-probability') override(100)
  if (variant === 'scoped-other') override(100, b.activePet.skills[0])
  const inputs: unknown[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/stage-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
      when: c =>
        c.trigger !== EffectTrigger.BeforeEffect || (c.parent instanceof EffectContext && c.parent.effect?.id === r.id),
      apply(c) {
        if (c.trigger === EffectTrigger.BeforeEffect && c.parent instanceof EffectContext) {
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'late-opponent') b.activePet = b.team[1]
          if (variant === 'cancel-effect') c.parent.available = false
          if (variant === 'late-probability') override(0)
        }
        if (c.trigger === EffectTrigger.OnBeforeAddMark) {
          inputs.push({ target: c.parent.target instanceof Pet ? c.parent.target.id : 'battle', stack: c.parent.stack })
          if (variant === 'cancel-add') c.parent.available = false
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
  const damageParent =
    variant === 'missing-skill'
      ? new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, source)
      : variant === 'nested'
        ? new EffectContext(parent, EffectTrigger.BeforeEffect, source)
        : parent
  if (variant === 'phase') {
    override(100)
    parent.category = Category.Physical
    parent.power = 10
    parent.multihit = 1
    parent.hitOverrides.push({ willHit: true, priority: 0 })
    parent.critOverrides.push({ willCrit: false, priority: 0 })
    a.currentRage = a.maxRage
    const phase = new SkillPhase(
      battle,
      a,
      owner,
      AttackTargetOpinion.opponent,
      skill,
      parent.parent as TurnContext,
      parent,
    )
    phase.initialize()
    phase.execute()
  } else battle.applyEffects(new DamageContext(damageParent, skill, b.activePet, 10), EffectTrigger[trigger], source)
  return {
    inputs,
    before,
    stats: [...a.team, ...b.team].map(p => p.stat[r.recipe.stat]),
    marks: [...a.team, ...b.team].map(p =>
      p.marks
        .filter(m => m instanceof StatLevelMarkInstanceImpl)
        .map(m => ({ stat: m.statType, level: m.level, active: m.isActive })),
    ),
    nextRandom: battle.random(),
  }
}
for (const r of records)
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${r.id} ${kind} matches YAML: %s`, variant => {
      for (const trigger of r.recipe.triggers) {
        const actual = run(r, true, kind, variant, trigger)
        expect(actual).toEqual(run(r, false, kind, variant, trigger))
        const probabilistic = r.recipe.clauses.some(c => c.kind === 'probability')
        if ((variant === 'normal' && !probabilistic) || variant === 'force-hundred' || variant === 'late-probability') {
          expect(actual.inputs).toHaveLength(1)
          const target = r.recipe.target === 'self' ? 0 : 2
          expect(actual.marks[target]).toEqual([{ stat: r.recipe.stat, level: r.recipe.value, active: true }])
          expect(actual.stats[target]).not.toBe(actual.before)
        }
        if (variant === 'cancel-effect' || (variant === 'wrong-skill' && kind === 'skill'))
          expect(actual.inputs).toEqual([])
        if (variant === 'force-zero' && probabilistic) expect(actual.inputs).toEqual([])
        if (variant === 'missing-skill' || variant === 'scoped-other') expect(actual.inputs).toEqual([])
        if (variant === 'phase' || variant === 'nested' || variant === 'late-owner' || variant === 'late-opponent') {
          expect(actual.inputs).toHaveLength(1)
          const destination = variant === 'late-owner' ? 0 : variant === 'late-opponent' ? 3 : 2
          expect(actual.marks[destination]).toEqual([{ stat: 'def', level: -1, active: true }])
        }
      }
    })
it('pins every emitted definition and keeps exact ID coverage', () => {
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, normalize(x)]),
          )
        : v
  expect(Object.keys(generatedStatStageCandidates.effects).sort()).toEqual(allRecords.map(r => r.id).sort())
  for (const r of allRecords)
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(sources.get(r.sourceFile)!.find(d => d.id === r.id))))
        .digest('hex'),
    ).toBe(r.definitionSha256)
})
