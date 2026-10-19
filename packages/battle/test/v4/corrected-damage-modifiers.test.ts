import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  createGeneratedDamageModifierEffects,
  BaseMark,
  SkillInstance,
  SkillPhase,
  DamageContext,
  DamageType,
  Category,
  Element,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  defineNativeEffect,
  GameRng,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
  type Effect,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const specs = [
  {
    id: 'effect_ability_ice_damage_boost_15_percent',
    field: 'element',
    match: Element.Ice,
    mismatch: Element.Fire,
    percent: 15,
    delta: 0,
    defensive: false,
  },
  {
    id: 'effect_emblem_climax_damage_boost_10_percent',
    field: 'category',
    match: Category.Climax,
    mismatch: Category.Special,
    percent: 10,
    delta: 0,
    defensive: false,
  },
  {
    id: 'effect_mark_double_physical_damage_taken',
    field: 'category',
    match: Category.Physical,
    mismatch: Category.Special,
    percent: 100,
    delta: 0,
    defensive: true,
  },
  {
    id: 'effect_mark_reduce_fire_damage_half',
    field: 'element',
    match: Element.Fire,
    mismatch: Element.Ice,
    percent: -50,
    delta: 0,
    defensive: true,
  },
  {
    id: 'effect_mark_increase_multi_hit_damage_35_percent',
    field: 'multihitResult',
    match: 3,
    mismatch: 1,
    percent: 35,
    delta: 0,
    defensive: false,
  },
  {
    id: 'effect_skill_add_fixed_damage_25_if_3_hits',
    field: 'multihitResult',
    match: 3,
    mismatch: 2,
    percent: 0,
    delta: 25,
    defensive: false,
  },
] as const
type Spec = (typeof specs)[number]
const sourceFiles = ['ability', 'emblem', 'mark', 'skill'].flatMap(
  name =>
    parse(readFileSync(new URL(`../../../../packs/base/data/effect_${name}.yaml`, import.meta.url), 'utf8'), {
      merge: true,
    }) as { id: string }[],
)
const originals = new Map(specs.map(spec => [spec.id, sourceFiles.find(d => d.id === spec.id)!]))
const oracles = new Map(
  specs.map(spec => {
    const copy = structuredClone(originals.get(spec.id)) as unknown as {
      condition: { conditions: [unknown, { target: { base: string } }] }
    }
    expect(copy.condition.conditions[1].target.base).toBe('useSkillContext')
    copy.condition.conditions[1].target.base = 'usingSkillContext'
    return [spec.id, EffectParser.parse(copy)]
  }),
)
const candidates: Readonly<Record<string, Effect<EffectTrigger>>> = createGeneratedDamageModifierEffects()
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'wrong-condition',
  'wrong-owner',
  'other-skill',
  'nested',
  'missing-skill',
  'late-condition',
  'late-owner',
  'late-active',
  'cancel',
  'phase',
  'real-three',
] as const
function run(spec: Spec, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(38)
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    for (const s of p.skills) s.effects.splice(0)
    p.attributeSystem.updateBaseValue('maxHp', 1000)
    p.currentHp = 1000
  }
  const actor = a.activePet,
    victim = b.activePet,
    owner = spec.defensive ? victim : actor,
    skill = owner.skills[0]
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/corrected-damage' as baseMarkId, [], debuff.config).createInstance()
    source.owner = owner
    owner.marks.push(source)
  }
  source.effects.push(native ? candidates[spec.id] : oracles.get(spec.id)!)
  const selected =
    variant === 'other-skill' ? new SkillInstance(actor.skills[0].base, { effects: [] }) : actor.skills[0]
  selected.owner = actor
  if (variant === 'wrong-owner') source.owner = owner.owner!.team[1]
  const use = new UseSkillContext(new TurnContext(battle), a, actor, AttackTargetOpinion.opponent, selected)
  use.updateActualTarget()
  use.power = 1
  use.category = Category.Physical
  Reflect.set(use, spec.field, variant === 'wrong-condition' ? spec.mismatch : spec.match)
  const parent =
    variant === 'missing-skill'
      ? new EffectContext(use.parent, EffectTrigger.TurnStart, source)
      : variant === 'nested'
        ? new EffectContext(use, EffectTrigger.PreDamage, source)
        : use
  const damage = new DamageContext(parent, actor, victim, 200, DamageType.Effect)
  damage.element = Element.Light // Skill element/category must come from skill ancestry, not this event.
  const seen: { modified: number[]; remaining: number; ordinal: number }[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/corrected-damage-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnDamage],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === spec.id),
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          if (variant === 'late-condition') Reflect.set(use, spec.field, spec.mismatch)
          if (variant === 'late-owner') source.owner = owner.owner!.team[1]
          if (variant === 'late-active') b.activePet = b.team[1]
          if (variant === 'cancel') ctx.parent.available = false
        }
        if (ctx.trigger === EffectTrigger.OnDamage)
          seen.push({ modified: [...ctx.parent.modified], remaining: use.multihitResult, ordinal: use.currentHitCount })
      },
    }),
  )
  if (variant === 'real-three') {
    use.multihit = 3
    use.hitOverrides.push({ willHit: true, priority: 0 })
    use.critOverrides.push({ willCrit: false, priority: 0 })
    a.currentRage = a.maxRage
    const phase = new SkillPhase(battle, a, actor, AttackTargetOpinion.opponent, selected, use.parent, use)
    phase.initialize()
    phase.execute()
  } else if (variant === 'phase') victim.damage(damage)
  else battle.applyEffects(damage, EffectTrigger.OnBeforeCalculateDamage)
  return {
    modified: damage.modified,
    result: damage.damageResult,
    hp: victim.currentHp,
    seen,
    nextRandom: battle.random(),
  }
}
for (const spec of specs) {
  it(`${spec.id} has only a C07 source-selector correction`, () => {
    expect(() => EffectParser.parse(originals.get(spec.id))).toThrow(/useSkillContext/)
    const ledger = JSON.parse(
      readFileSync(new URL('../../../../docs/v4/validation/damage-modifiers-candidates.json', import.meta.url), 'utf8'),
    )
    const record = ledger.records.find((r: { id: string }) => r.id === spec.id)
    expect(record.recipe.selectorRepairs).toEqual(['/condition/conditions/1/target/base'])
    expect(record.recipe.additionalDecisions).toEqual(['C07'])
  })
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${spec.id} ${kind}: %s`, variant => {
      const actual = run(spec, true, kind, variant)
      expect(actual).toEqual(run(spec, false, kind, variant))
      if (variant === 'real-three') {
        const expected = [3, 2, 1].map(remaining =>
          spec.field === 'multihitResult' && (spec.delta ? remaining !== 3 : remaining <= 1)
            ? [0, 0]
            : [spec.percent, spec.delta],
        )
        expect(actual.seen.map(e => e.modified)).toEqual(expected)
        expect(actual.seen.map(e => e.ordinal)).toEqual([1, 2, 3])
      } else {
        const admitted =
          !['wrong-condition', 'wrong-owner', 'missing-skill', 'cancel'].includes(variant) &&
          !(variant === 'other-skill' && !spec.defensive && kind === 'skill')
        expect(actual.modified).toEqual(admitted ? [spec.percent, spec.delta] : [0, 0])
        expect(actual.nextRandom).toBe(new GameRng(38).next())
        if (variant === 'phase') {
          const result = Math.floor(200 * (1 + spec.percent / 100) + spec.delta)
          expect(actual.result).toBe(result)
          expect(actual.hp).toBe(1000 - result)
        }
      }
    })
}
