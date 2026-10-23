import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, SkillParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  defineNativeEffect,
  BaseMark,
  SkillInstance,
  SkillPhase,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  GameRng,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createRandomWeatherApplication, randomWeatherDependencies } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_skill_set_field_qingtian_or_yemu'
const load = (name: string): { id: string }[] =>
  parse(readFileSync(new URL(`../../../../packs/base/data/${name}.yaml`, import.meta.url), 'utf8'), { merge: true })
const definition = load('effect_skill').find(d => d.id === id)!
const oracle = EffectParser.parse(definition)
const markDefinitions = load('mark_global')
const marks = new Map<string, BaseMark>(
  randomWeatherDependencies.map(id => [
    id,
    MarkParser.parse({ ...markDefinitions.find(d => d.id === id), effect: [] }),
  ]),
)
const suppliedCatalog = new Map(marks)
const candidate = createRandomWeatherApplication(suppliedCatalog)
suppliedCatalog.clear() // Executions below must retain the resolved definitions.
const baseSkill = SkillParser.parse({ ...load('skill').find(d => d.id === 'skill_guangyinghuanxiang'), effect: [] })
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'first',
  'second',
  'zero',
  'missing-context',
  'nested',
  'other-skill',
  'late-count',
  'late-owner',
  'cancel-effect',
  'cancel-add',
  'existing',
  'modify',
  'real-one',
  'real-two',
  'real-three',
  'real-zero',
  'real-miss',
  'real-late-miss',
  'real-extend',
  'real-shorten',
  'real-disabled',
  'real-reuse',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number], seed: number) {
  const { battle, a, b, debuff } = makeScenario(seed)
  battles.push(battle)
  const owner = a.activePet,
    skill = new SkillInstance(baseSkill, { effects: [] })
  skill.owner = owner
  owner.skills.splice(0, owner.skills.length, skill)
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/weather-source' as baseMarkId, [], debuff.config).createInstance()
    source.owner = owner
    owner.marks.push(source)
  }
  source.effects.push(native ? candidate : oracle)
  const repo = DataRepository.getInstance(),
    previous = [...marks.values()].map(m => [m.id, repo.marks.get(m.id)] as const)
  for (const m of marks.values()) repo.marks.set(m.id, m)
  if (variant === 'existing') {
    const chosen = new GameRng(seed).shuffle([...randomWeatherDependencies])[0]
    const other = marks.get(randomWeatherDependencies.find(key => key !== chosen)!)!.createInstance()
    other.owner = battle
    battle.marks.push(other)
  }
  const selected = variant === 'other-skill' ? new SkillInstance(baseSkill, { effects: [] }) : skill
  selected.owner = owner
  const use = new UseSkillContext(new TurnContext(battle), a, owner, AttackTargetOpinion.opponent, selected)
  use.updateActualTarget()
  use.currentHitCount = variant === 'zero' ? 0 : variant === 'second' ? 2 : 1
  const inputs: { id: string; stack: number; duration: number; hit: number }[] = []
  const hits: { on: string; index: number; resolvedHits: number }[] = []
  const starts: number[] = []
  const beforeMultiHit: number[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/weather-hook' as effectId,
      triggers: [
        EffectTrigger.BeforeEffect,
        EffectTrigger.OnBeforeAddMark,
        EffectTrigger.BeforeUseSkillCheck,
        EffectTrigger.BeforeMultiHit,
        EffectTrigger.BeforeHit,
        EffectTrigger.OnHit,
        EffectTrigger.OnMiss,
      ],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          if (variant === 'late-count') use.currentHitCount = 2
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'cancel-effect') ctx.parent.available = false
        }
        if (ctx.trigger === EffectTrigger.OnBeforeAddMark && [...marks.values()].includes(ctx.parent.baseMark)) {
          expect(ctx.parent.target).toBe(battle)
          inputs.push({
            id: ctx.parent.baseMark.id,
            stack: ctx.parent.stack,
            duration: ctx.parent.duration,
            hit: use.currentHitCount,
          })
          if (variant === 'cancel-add') ctx.parent.available = false
          if (variant === 'modify') ctx.parent.duration = 7
        }
        if (ctx.trigger === EffectTrigger.BeforeUseSkillCheck) starts.push(ctx.parent.currentHitCount)
        if (ctx.trigger === EffectTrigger.BeforeMultiHit) beforeMultiHit.push(ctx.parent.currentHitCount)
        if (
          ctx.trigger === EffectTrigger.BeforeHit ||
          ctx.trigger === EffectTrigger.OnHit ||
          ctx.trigger === EffectTrigger.OnMiss
        ) {
          hits.push({ on: ctx.trigger, index: ctx.parent.currentHitCount, resolvedHits: ctx.parent.multihitResult })
          if (ctx.trigger === EffectTrigger.OnHit && ctx.parent.currentHitCount === 1) {
            if (variant === 'real-extend') ctx.parent.multihitResult += 1
            if (variant === 'real-shorten') ctx.parent.multihitResult = 1
            if (variant === 'real-late-miss') ctx.parent.hitResult = false
          }
        }
      },
    }),
  )
  try {
    const execute = () => {
      a.currentRage = a.maxRage
      use.hitOverrides.push({ willHit: variant !== 'real-miss', priority: 0 })
      use.critOverrides.push({ willCrit: false, priority: 0 })
      use.multihit = variant === 'real-zero' ? 0 : variant === 'real-one' ? 1 : variant === 'real-three' ? 3 : 2
      if (variant === 'real-disabled') use.available = false
      const phase = new SkillPhase(battle, a, owner, AttackTargetOpinion.opponent, selected, use.parent, use)
      phase.initialize()
      phase.execute()
    }
    if (variant.startsWith('real-')) {
      execute()
      if (variant === 'real-reuse') {
        // Keep the same context, but restore both combatants before another skill execution.
        owner.currentHp = owner.stat.maxHp
        owner.isAlive = true
        b.activePet.currentHp = b.activePet.stat.maxHp
        b.activePet.isAlive = true
        execute()
      }
    } else if (variant === 'nested') {
      // @ts-expect-error Deliberately nested event exercises nearest-context query behavior.
      battle.applyEffects(new EffectContext(use, EffectTrigger.BeforeEffect, source), EffectTrigger.OnHit)
    } else if (variant === 'missing-context') {
      // @ts-expect-error Malformed event: runtime query absence must fail admission.
      battle.applyEffects(use.parent, EffectTrigger.OnHit)
    } else battle.applyEffects(use, EffectTrigger.OnHit)
    return {
      inputs,
      hits,
      starts,
      beforeMultiHit,
      count: use.currentHitCount,
      resolvedHits: use.multihitResult,
      fields: battle.marks.map(m => ({ id: m.baseId, duration: m.duration, stack: m.stack })),
      nextRandom: battle.random(),
    }
  } finally {
    for (const [key, m] of previous)
      if (m) repo.marks.set(key, m)
      else repo.marks.delete(key)
  }
}
for (const kind of ['skill', 'mark'] as const)
  it.each(variants.flatMap(variant => [28, 269].map(seed => ({ variant, seed }))))(
    `weather ${kind}: $variant seed $seed`,
    ({ variant, seed }) => {
      const actual = run(true, kind, variant, seed)
      expect(actual).toEqual(run(false, kind, variant, seed))
      const admitted =
        !['second', 'zero', 'missing-context', 'cancel-effect', 'real-zero', 'real-miss', 'real-disabled'].includes(
          variant,
        ) && !(variant === 'other-skill' && kind === 'skill')
      expect(actual.inputs).toHaveLength(admitted ? 1 : 0)
      if (!variant.startsWith('real-')) {
        const rng = new GameRng(seed)
        if (admitted) expect(actual.inputs[0].id).toBe(rng.shuffle([...randomWeatherDependencies])[0])
        expect(actual.nextRandom).toBe(rng.next())
      } else {
        expect(actual.starts).toEqual(variant === 'real-reuse' ? [1, 3] : [1])
        expect(actual.beforeMultiHit).toEqual(
          variant === 'real-disabled' ? [] : variant === 'real-reuse' ? [1, 3] : [1],
        )
        const count =
          variant === 'real-disabled' || variant === 'real-zero'
            ? 0
            : variant === 'real-one' || variant === 'real-miss' || variant === 'real-shorten'
              ? 1
              : variant === 'real-three' || variant === 'real-extend'
                ? 3
                : 2
        expect(actual.count).toBe(variant === 'real-miss' || variant === 'real-late-miss' ? count : count + 1)
        expect(actual.hits.filter(h => h.on === 'BeforeHit').map(h => h.index)).toEqual(
          variant === 'real-disabled' || variant === 'real-zero' || variant === 'real-miss'
            ? []
            : variant === 'real-reuse'
              ? [1, 2]
              : variant === 'real-late-miss'
                ? [1]
                : Array.from({ length: count }, (_, i) => i + 1),
        )
        if (variant === 'real-late-miss') expect(actual.hits.at(-1)).toMatchObject({ on: 'OnMiss', index: 2 })
        if (variant === 'real-two')
          expect(actual.hits.filter(h => h.on === 'OnHit').map(h => h.resolvedHits)).toEqual([2, 2])
      }
      if (variant === 'cancel-add' || !admitted) expect(actual.fields).toEqual([])
      else {
        expect(actual.fields).toHaveLength(1)
        expect(actual.fields[0].id).toBe(actual.inputs.at(-1)!.id)
        if (variant === 'modify')
          expect(actual.fields[0].duration).toBe(marks.get(actual.fields[0].id)!.config.persistent ? -1 : 7)
      }
    },
  )
it('requires exact ordered weather dependencies and copies resolved membership', () => {
  expect(() => createRandomWeatherApplication(new Map())).toThrow('mark_global_qingtian')
  const wrong = new Map<string, BaseMark>(marks)
  wrong.set('mark_global_yemu', marks.get('mark_global_qingtian')!)
  expect(() => createRandomWeatherApplication(wrong)).toThrow('mark_global_yemu')
  expect(candidate.id).toBe(id)
  expect(suppliedCatalog.size).toBe(0)
})
it('parses unchanged historical source and pins both dependencies', () => {
  expect(() => EffectParser.parse(definition)).not.toThrow()
  const record = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/random-weather-application.json', import.meta.url), 'utf8'),
  )
  const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
  expect(record.definitionSha256).toBe(hash(definition))
  expect(record.decisions).toEqual([])
  expect(record.historicalReference).toBe('61c349fa7ca35c392b0e751c9238759b02aefcb3')
  expect(record.dependencies.map((d: { id: string }) => d.id)).toEqual([...randomWeatherDependencies])
  for (const dep of record.dependencies)
    expect(dep.definitionSha256).toBe(hash(markDefinitions.find(d => d.id === dep.id)))
})
