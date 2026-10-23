import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  SkillPhase,
  AttackTargetOpinion,
  StatLevelMarkInstanceImpl,
  StatTypeWithoutHp,
  Category,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedStatStageClears } from '@arcadia-eternity/data-pack-base/native'

const stats = ['atk', 'def', 'spa', 'spd', 'spe'] as const
const mixed = [2, -1, 3, -2, 4]
type Id = keyof typeof generatedStatStageClears
const ids = Object.keys(generatedStatStageClears) as Id[]
const definitions = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const originals = new Map(ids.map(id => [id, definitions.find((d: { id: string }) => d.id === id)]))
const oracles = new Map(ids.map(id => [id, EffectParser.parse(originals.get(id))]))
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
const variants = [
  'normal',
  'positive',
  'negative',
  'zero',
  'cancel',
  'wrong-owner',
  'missing-support',
  'late-support',
  'late-level',
  'late-owner',
  'late-slot',
  'indestructible',
  'nested',
  'repeat',
  'phase-hit',
  'phase-miss',
] as const
function run(native: boolean, id: Id, markSource: boolean, trigger: EffectTrigger, variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(1601)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
  const values =
    variant === 'positive'
      ? [1, 2, 3, 4, 5]
      : variant === 'negative'
        ? [-1, -2, -3, -4, -5]
        : variant === 'zero'
          ? [0, 0, 0, 0, 0]
          : mixed
  const removed: { pet: number; stat: string; level: number }[] = []
  const pets = [...a.team, ...b.team]
  for (const [index, pet] of pets.entries())
    for (const [i, stat] of stats.entries()) {
      if (values[i] === 0) continue
      pet.addStatStage(setup, stat as StatTypeWithoutHp, values[i])
      const stage = pet.marks.find(m => m instanceof StatLevelMarkInstanceImpl && m.statType === stat)!
      if (variant === 'indestructible') stage.config.destroyable = false
      stage.effects.push(
        defineNativeEffect({
          id: `fixture/clear/${index}/${stat}` as effectId,
          triggers: [EffectTrigger.OnMarkDestroy],
          apply() {
            removed.push({ pet: index, stat, level: (stage as StatLevelMarkInstanceImpl).level })
          },
        }),
      )
    }
  const mark = new BaseMark('fixture/clear-source' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
  }).createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(mark)
  const source = markSource ? mark : a.activePet.skills[0]
  source.effects.push(native ? generatedStatStageClears[id] : oracles.get(id)!)
  const yinghua = new BaseMark('mark_yinghua' as baseMarkId, [], debuff.config).createInstance()
  yinghua.setOwner(b.activePet, battle.emitter)
  const night = new BaseMark('mark_global_yemu' as baseMarkId, [], debuff.config).createInstance()
  night.setOwner(battle, battle.emitter)
  if (variant !== 'missing-support') {
    b.activePet.marks.push(yinghua)
    battle.marks.push(night)
  }
  const target = originals.get(id)!.apply.target === 'self' ? a.activePet : b.activePet
  const actor = variant === 'wrong-owner' ? b : a
  const turn = new TurnContext(battle),
    use = new UseSkillContext(turn, actor, actor.activePet, AttackTargetOpinion.opponent, actor.activePet.skills[0])
  use.updateActualTarget()
  use.category = Category.Status
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/clear-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        const outer = c.parent as EffectContext<EffectTrigger>
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-support') {
          b.activePet.marks = b.activePet.marks.filter(m => m !== yinghua)
          battle.marks = battle.marks.filter(m => m !== night)
        }
        if (variant === 'late-level')
          for (const m of target.marks) if (m instanceof StatLevelMarkInstanceImpl) m.level = -m.level
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-slot') b.activePet = b.team[1]
      },
    }),
  )
  if (variant === 'phase-hit' || variant === 'phase-miss') {
    use.hitOverrides.push({ willHit: variant === 'phase-hit', priority: 1000 })
    const phase = new SkillPhase(
      battle,
      actor,
      actor.activePet,
      AttackTargetOpinion.opponent,
      actor.activePet.skills[0],
      turn,
      use,
    )
    phase.initialize()
    phase.execute()
  } else {
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeEffect, source) : use
    battle.applyEffects<EffectTrigger>(parent, trigger, source)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(parent, trigger, source)
  }
  return {
    admitted,
    removed,
    levels: pets.map(p =>
      stats.map(stat =>
        p.marks
          .filter((m): m is StatLevelMarkInstanceImpl => m instanceof StatLevelMarkInstanceImpl && m.statType === stat)
          .reduce((sum, m) => sum + m.level, 0),
      ),
    ),
    attributes: pets.map(p => stats.map(stat => p.stat[stat])),
    next: battle.random(),
  }
}
for (const id of ids) {
  const d = originals.get(id)!,
    triggers = (Array.isArray(d.trigger) ? d.trigger : [d.trigger]) as EffectTrigger[]
  for (const markSource of [false, true])
    for (const trigger of triggers)
      for (const variant of variants)
        it(`${id} markSource=${markSource} ${trigger} ${variant}`, () => {
          const result = run(true, id, markSource, trigger, variant)
          expect(result).toEqual(run(false, id, markSource, trigger, variant))
          const support = id.includes('yinghua') || id.includes('yemu')
          if (variant === 'wrong-owner' || (variant === 'missing-support' && support)) {
            expect(result.admitted).toBe(0)
            expect(result.removed).toEqual([])
            return
          }
          if (
            [
              'normal',
              'nested',
              'positive',
              'negative',
              'zero',
              'late-level',
              'late-owner',
              'late-slot',
              'indestructible',
              'late-support',
              'cancel',
            ].includes(variant)
          ) {
            expect(result.admitted).toBe(1)
            const originalLevels =
              variant === 'positive'
                ? [1, 2, 3, 4, 5]
                : variant === 'negative'
                  ? [-1, -2, -3, -4, -5]
                  : variant === 'zero'
                    ? [0, 0, 0, 0, 0]
                    : mixed
            const levels = variant === 'late-level' ? originalLevels.map(n => -n) : originalLevels
            const chosen =
              d.apply.statType === undefined
                ? stats
                : Array.isArray(d.apply.statType)
                  ? d.apply.statType
                  : [d.apply.statType]
            const strategy = d.apply.cleanStageStrategy ?? 'positive'
            const expected = levels.map((level, i) =>
              !['cancel', 'indestructible'].includes(variant) &&
              chosen.includes(stats[i]) &&
              (strategy === 'negative' ? level < 0 : level > 0)
                ? d.apply.type === 'reverseStatStage'
                  ? -level
                  : 0
                : level,
            )
            const targetIndex =
              d.apply.target === 'self' ? (variant === 'late-owner' ? 1 : 0) : variant === 'late-slot' ? 3 : 2
            expect(result.levels[targetIndex]).toEqual(expected)
            expect(result.removed.map(r => r.stat)).toEqual(
              variant === 'indestructible' ? [] : stats.filter((_, i) => levels[i] !== expected[i]),
            )
          }
          if (variant === 'phase-hit') expect(result.admitted).toBe(1)
          if (variant === 'phase-miss') expect(result.admitted).toBe(triggers.includes(EffectTrigger.OnMiss) ? 1 : 0)
        })
}
it('pins eleven source hashes and exact stage identities', () => {
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/stat-stage-clears-candidates.json', import.meta.url), 'utf8'),
  )
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
  expect(ids).toHaveLength(11)
  expect(ledger.records.map((r: { id: string }) => r.id).sort()).toEqual([...ids].sort())
  expect(ledger.rejected).toEqual([])
  for (const r of ledger.records) {
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(originals.get(r.id))))
        .digest('hex'),
    )
    expect(r.recipe.actions[0].sourcePath).toBe('/apply')
    expect(r.recipe.repairedPaths).toEqual([])
  }
})

for (const variant of [
  'default',
  'all',
  'empty',
  'snapshot',
  'later-stat',
  'foreign',
  'foreign-after-first',
  'foreign-within-pet',
] as const)
  it(`stage clear operation lifecycle and ownership: ${variant}`, () => {
    const { battle, a } = makeScenario(1602)
    battles.push(battle)
    const other = makeScenario(1603)
    battles.push(other.battle)
    const source = a.activePet.skills[0],
      context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, source)
    for (const p of a.team) {
      p.addStatStage(context, StatTypeWithoutHp.atk, 2)
      p.addStatStage(context, StatTypeWithoutHp.spa, -3)
    }
    const first = a.activePet,
      second = a.team[1]
    const atk = first.marks.find(
      (m): m is StatLevelMarkInstanceImpl =>
        m instanceof StatLevelMarkInstanceImpl && m.statType === StatTypeWithoutHp.atk,
    )!
    const spa = first.marks.find(
      (m): m is StatLevelMarkInstanceImpl =>
        m instanceof StatLevelMarkInstanceImpl && m.statType === StatTypeWithoutHp.spa,
    )!
    const trace: string[] = []
    atk.effects.push(
      defineNativeEffect({
        id: 'fixture/clear-atk-callback' as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply() {
          trace.push('atk')
          if (variant === 'later-stat' || variant === 'foreign-within-pet') spa.level = 4
          if (variant === 'foreign-within-pet') first.owner = other.a
          if (variant === 'foreign-after-first') second.owner = other.a
        },
      }),
    )
    spa.effects.push(
      defineNativeEffect({
        id: 'fixture/clear-spa-callback' as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply() {
          trace.push('spa')
        },
      }),
    )
    const { compileEffect, defineEffect, selectFrom, ops } = effectAuthoring
    const chosen: ('atk' | 'spa')[] = ['atk', 'spa']
    const options: { stats?: ('atk' | 'spa')[]; strategy?: 'all' | 'positive' | 'negative' } = {
      stats: variant === 'empty' ? [] : chosen,
      strategy: variant === 'all' ? 'all' : 'positive',
    }
    const operation = variant === 'default' ? ops.clearStatStages() : ops.clearStatStages(options)
    if (variant === 'snapshot') {
      chosen.splice(0, 2, 'spa')
      options.strategy = 'negative'
    }
    if (variant === 'foreign') second.owner = other.a
    const selected = ['foreign', 'foreign-after-first'].includes(variant) ? [first, second] : [first]
    const effect = compileEffect(
      defineEffect({ id: 'fixture/clear-operator', on: 'TurnStart', execute: selectFrom(selected).apply(operation) }),
    )
    const apply = () => battle.executionBudget.run(battle.currentTurn, () => effect.innerApply(context))
    if (['foreign', 'foreign-after-first', 'foreign-within-pet'].includes(variant))
      expect(apply).toThrow('Cross-battle or unowned write target')
    else apply()
    expect(trace).toEqual(
      variant === 'foreign' ? [] : ['all', 'later-stat'].includes(variant) ? ['atk', 'spa'] : ['atk'],
    )
    expect(atk.isActive).toBe(variant === 'foreign')
    expect(spa.isActive).toBe(!['all', 'later-stat'].includes(variant))
    expect(second.marks.filter(m => m instanceof StatLevelMarkInstanceImpl)).toHaveLength(2)
  })

for (const nextStat of [false, true])
  it(`stage traversal snapshots each stat on arrival, nextStat=${nextStat}`, () => {
    const { battle, a } = makeScenario(1604)
    battles.push(battle)
    const pet = a.activePet
    const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, pet.skills[0])
    pet.addStatStage(context, StatTypeWithoutHp.atk, 2)
    pet.addStatStage(context, StatTypeWithoutHp.spa, -3)
    const atk = pet.marks.find(
      (m): m is StatLevelMarkInstanceImpl => m instanceof StatLevelMarkInstanceImpl && m.statType === 'atk',
    )!
    const spa = pet.marks.find(
      (m): m is StatLevelMarkInstanceImpl => m instanceof StatLevelMarkInstanceImpl && m.statType === 'spa',
    )!
    const added = (nextStat ? spa : atk).base.createInstance()
    added.level = 4
    atk.effects.push(
      defineNativeEffect({
        id: 'fixture/traversal-add' as effectId,
        triggers: [EffectTrigger.OnMarkDestroy],
        apply() {
          added.setOwner(pet, battle.emitter)
          pet.marks.push(added)
        },
      }),
    )
    pet.clearStatStage(context)
    expect(atk.isActive).toBe(false)
    expect(spa.isActive).toBe(true)
    expect(added.isActive).toBe(!nextStat)
    expect(pet.marks.includes(added)).toBe(!nextStat)
  })
