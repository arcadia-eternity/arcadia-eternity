import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  BaseSkill,
  SkillInstance,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  DamagePhase,
  DamageType,
  AttackTargetOpinion,
  Category,
  Element,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedDamageSequences } from '@arcadia-eternity/data-pack-base/native'

const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/damage-sequences-candidates.json', import.meta.url), 'utf8'),
)
const definitions = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_mark.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
type Id = keyof typeof generatedDamageSequences
const expected: Record<
  Id,
  {
    percent?: number
    delta?: number
    stack?: 'percent' | 'delta'
    defensive?: boolean
    remove?: boolean
    block?: boolean
    physical?: boolean
    special?: boolean
    climax?: boolean
    skill?: string
  }
> = {
  effect_mark_reduce_damage_taken_once: { percent: -1, stack: 'percent', defensive: true, remove: true },
  effect_mark_increase_damage_taken_once: { percent: 1, stack: 'percent', defensive: true, remove: true },
  effect_mark_mihuo_reduce_damage: { delta: -50 },
  effect_mark_reduce_damage_15_percent: { percent: -15 },
  effect_mark_amplify_next_physical_damage_with_stack: { percent: 1, stack: 'percent', physical: true, remove: true },
  effect_mark_amplify_next_special_damage_with_stack: { percent: 1, stack: 'percent', special: true, remove: true },
  effect_mark_reduce_damage_30_percent_xstack: { delta: -30, stack: 'delta' },
  effect_mark_increase_taken_damage_30_xstack: { delta: 30, stack: 'delta', defensive: true },
  effect_mark_reduce_deal_damage_once_per_stack: { delta: -1, stack: 'delta', remove: true },
  effect_mark_block_next_special_damage: { block: true, special: true, defensive: true, remove: true },
  effect_mark_baiyapo_add_damage_based_on_stack: {
    delta: 1,
    stack: 'delta',
    defensive: true,
    remove: true,
    skill: 'skill_baiyapo',
  },
  effect_mark_heiyapao_add_damage_based_on_stack: {
    delta: 1,
    stack: 'delta',
    defensive: true,
    remove: true,
    skill: 'skill_heiyapo',
  },
  effect_mark_add_damage_taken_with_stack: { percent: 1, stack: 'percent', defensive: true, remove: true },
  effect_mark_add_damage_with_stack_and_consume: { delta: 1, stack: 'delta', remove: true },
  effect_mark_block_climax_damage: { block: true, climax: true, defensive: true },
}
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
  'late-stack',
  'zero-stack',
  'cancel',
  'wrong-owner',
  'wrong-type',
  'wrong-skill',
  'late-type',
  'late-owner',
  'nested',
  'repeat',
  'phase',
  'between-owner',
  'between-detach',
  'removal-change',
] as const
function original(id: Id) {
  return definitions.find((d: { id: string }) => d.id === id)
}
function reference(id: Id) {
  const d = structuredClone(original(id))
  if (expected[id].skill || expected[id].climax) d.condition.conditions[1].target.base = 'usingSkillContext'
  if (expected[id].skill) d.condition.conditions[1].target.chain[0].arg = 'skill'
  return d
}
const oracles = new Map((Object.keys(expected) as Id[]).map(id => [id, EffectParser.parse(reference(id))]))
function run(id: Id, native: boolean, variant: (typeof variants)[number], initialStack = 3) {
  const spec = expected[id],
    { battle, a, b, debuff } = makeScenario(1201)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 2001)
    p.currentHp = 1000
  }
  const mark = new BaseMark('fixture/damage-sequence' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 20,
    duration: -1,
  }).createInstance()
  mark.owner = a.activePet
  mark.stack = initialStack
  a.activePet.marks.push(mark)
  mark.effects.push(native ? generatedDamageSequences[id] : oracles.get(id)!)
  const attacker = spec.defensive ? b : a,
    victim = spec.defensive ? a : b
  const skill = new SkillInstance(
    new BaseSkill(
      (variant === 'wrong-skill' ? 'fixture/wrong' : (spec.skill ?? 'fixture/damage')) as baseSkillId,
      Category.Special,
      Element.Normal,
      40,
      100,
      0,
      0,
      AttackTargetOpinion.opponent,
      1,
      true,
    ),
  )
  skill.owner = attacker.activePet
  attacker.activePet.skills[0] = skill
  battle.skillMap.set(skill.id, skill)
  const use = new UseSkillContext(
    new TurnContext(battle),
    attacker,
    attacker.activePet,
    AttackTargetOpinion.opponent,
    skill,
  )
  use.updateActualTarget()
  use.category = spec.climax ? Category.Climax : Category.Special
  let damage = new DamageContext(
    use,
    attacker.activePet,
    victim.activePet,
    101,
    spec.physical ? DamageType.Physical : DamageType.Special,
  )
  if (variant === 'wrong-owner') mark.owner = a.team[1]
  if (variant === 'wrong-type') {
    damage.damageType = spec.physical ? DamageType.Special : DamageType.Physical
    use.category = Category.Physical
  }
  let admitted = 0
  const trace: { kind: string; modified: number[]; available: boolean; active: boolean }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/damage-sequence-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        const outer = c.parent as EffectContext<EffectTrigger>
        if (outer.parent instanceof DamageContext) damage = outer.parent
        if (variant === 'cancel') outer.available = false
        if (variant === 'late-stack') mark.stack = 7
        if (variant === 'zero-stack') mark.stack = 0
        if (variant === 'late-type') {
          damage.damageType = DamageType.Effect
          use.category = Category.Status
        }
        if (variant === 'late-owner') mark.owner = a.team[1]
        const change = () => {
          trace.push({
            kind: 'write',
            modified: [...damage.modified],
            available: damage.available,
            active: mark.isActive,
          })
          if (variant === 'between-owner') mark.owner = a.team[1]
          if (variant === 'between-detach') mark.owner = null
        }
        if (spec.block) {
          let available = damage.available
          Object.defineProperty(damage, 'available', {
            get: () => available,
            set(v: boolean) {
              available = v
              if (!v) change()
            },
            configurable: true,
          })
        } else {
          const add = damage.addModified.bind(damage)
          damage.addModified = (p, d) => {
            add(p, d)
            change()
          }
        }
      },
    }),
  )
  mark.effects.push(
    defineNativeEffect({
      id: 'fixture/damage-sequence-remove' as effectId,
      triggers: [EffectTrigger.OnMarkDestroy],
      apply() {
        trace.push({
          kind: 'remove',
          modified: [...damage.modified],
          available: damage.available,
          active: mark.isActive,
        })
        if (variant === 'removal-change') damage.addModified(0, 9)
      },
    }),
  )
  if (variant === 'phase') {
    const phase = new DamagePhase(
      battle,
      use,
      attacker.activePet,
      victim.activePet,
      101,
      spec.physical ? DamageType.Physical : DamageType.Special,
    )
    phase.initialize()
    phase.execute()
  } else {
    const event = variant === 'nested' ? new EffectContext(damage, EffectTrigger.BeforeEffect, mark) : damage
    battle.applyEffects<EffectTrigger>(event, EffectTrigger.OnBeforeCalculateDamage, mark)
    if (variant === 'repeat') battle.applyEffects<EffectTrigger>(event, EffectTrigger.OnBeforeCalculateDamage, mark)
    damage.updateDamageResult()
  }
  return {
    admitted,
    trace,
    modified: damage.modified,
    available: damage.available,
    result: damage.damageResult,
    active: mark.isActive,
    stack: mark.stack,
    hp: victim.activePet.currentHp,
    next: battle.random(),
  }
}
for (const id of Object.keys(expected) as Id[]) {
  it(`${id} source identity`, () => {
    const r = ledger.records.find((r: { id: string }) => r.id === id),
      d = original(id)
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
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    expect(r.recipe.actions.map((a: { sourcePath: string }) => a.sourcePath)).toEqual(
      d.apply.map((_: unknown, i: number) => `/apply/${i}`),
    )
    if (expected[id].skill) expect(() => EffectParser.parse(d)).toThrow()
    else expect(() => EffectParser.parse(d)).not.toThrow()
    if (expected[id].skill) {
      const c = structuredClone(d)
      c.condition.conditions[1].target.base = 'usingSkillContext'
      expect(() => EffectParser.parse(c)).toThrow(/skillId/)
      expect(r.recipe.pathRepairs).toEqual([
        { path: '/condition/conditions/1/target/chain/0/arg', before: 'skillId', after: 'skill' },
      ])
    }
  })
  for (const variant of variants)
    it(`${id} ${variant}`, () => {
      const spec = expected[id],
        actual = run(id, true, variant)
      expect(actual).toEqual(run(id, false, variant))
      const rejected =
        variant === 'wrong-owner' ||
        (variant === 'nested' && spec.defensive) ||
        (variant === 'wrong-type' && (spec.physical || spec.special || spec.climax)) ||
        (variant === 'wrong-skill' && spec.skill)
      if (rejected) {
        expect(actual.admitted).toBe(0)
        expect(actual.modified).toEqual([0, 0])
        expect(actual.available).toBe(true)
        return
      }
      expect(actual.admitted).toBe(variant === 'repeat' && !spec.remove ? 2 : 1)
      if (variant === 'cancel') {
        expect(actual.trace).toEqual([])
        expect(actual.active).toBe(true)
        return
      }
      const stack = variant === 'late-stack' ? 7 : variant === 'zero-stack' ? 0 : 3
      const count = variant === 'repeat' && !spec.remove ? 2 : 1
      const percent = (spec.percent ?? 0) * (spec.stack === 'percent' ? stack : 1) * count
      const delta = (spec.delta ?? 0) * (spec.stack === 'delta' ? stack : 1) * count
      expect(actual.available).toBe(!spec.block)
      expect(actual.modified).toEqual([0 + percent, delta + (variant === 'removal-change' && spec.remove ? 9 : 0)])
      expect(actual.active).toBe(!spec.remove)
      if (spec.remove) expect(actual.trace.slice(0, 2).map(e => e.kind)).toEqual(['write', 'remove'])
      expect(actual.trace[0].kind).toBe('write')
      expect(actual.trace[0].active).toBe(true)
      if (variant === 'phase')
        expect(actual.hp).toBe(1000 - (spec.block ? 0 : Math.floor(Math.max(0, 101 * (1 + percent / 100) + delta))))
    })
}
it('covers exactly the generated damage sequence catalog', () => {
  expect(Object.keys(expected).sort()).toEqual(Object.keys(generatedDamageSequences).sort())
  expect(ledger.rejected).toEqual([])
})

for (const stack of [0, 1, 2])
  it(`stack-gated damage admission at ${stack}`, () => {
    const id = 'effect_mark_add_damage_with_stack_and_consume'
    const actual = run(id, true, 'normal', stack)
    expect(actual).toEqual(run(id, false, 'normal', stack))
    expect(actual.admitted).toBe(stack > 1 ? 1 : 0)
    expect(actual.modified).toEqual([0, stack > 1 ? 2 : 0])
    expect(actual.active).toBe(stack <= 1)
    expect(actual.trace.map(event => event.kind)).toEqual(stack > 1 ? ['write', 'remove'] : [])
  })
