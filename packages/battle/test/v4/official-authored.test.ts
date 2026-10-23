import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  AddMarkContext,
  BaseMark,
  DamageContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
  type MarkInstance,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { officialAuthoredEffects } from '@arcadia-eternity/data-pack-base/native'

const definitions: { id: string }[] = ['skill', 'mark'].flatMap(kind =>
  parse(readFileSync(new URL(`../../../../packs/base/data/effect_${kind}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const ids = [
  'effect_skill_consume_huanxiang_raise_def_1_stage',
  'effect_mark_damage_boost_based_on_hp_percentage',
  'effect_mark_shiguangchongsheng',
] as const
const variants = [
  'normal',
  'no-mark',
  'wrong-owner',
  'cancel',
  'late-owner',
  'late-hp',
  'late-max-hp',
  'consume-owner',
  'late-remove',
] as const
type Variant = (typeof variants)[number]
function run(id: (typeof ids)[number], native: boolean, kind: 'skill' | 'mark', variant: Variant, hp?: number) {
  const f = makeScenario(604),
    { battle, a, b } = f
  battles.push(battle)
  const pet = a.activePet,
    skill = pet.skills[0]
  skill.effects.splice(0)
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const add = (id: string) => {
    const base = new BaseMark(id as baseMarkId, [], { ...f.debuff.config, maxStacks: 5, stackable: true })
    battle.addMark(new AddMarkContext(setup, pet, base, 1))
    return pet.marks.find(m => m.base === base)!
  }
  const source = kind === 'skill' ? skill : add('fixture/source')
  const fantasy = variant === 'no-mark' ? undefined : add('mark_huanxiang')
  const effect = native ? officialAuthoredEffects[id] : EffectParser.parse(definitions.find(d => d.id === id))
  source.effects.push(effect)
  pet.attributeSystem.updateBaseValue('maxHp', 401)
  pet.currentHp = hp ?? (id === 'effect_mark_shiguangchongsheng' ? 0 : 200)
  const trace: unknown[] = []
  const hook = defineNativeEffect({
    id: 'fixture/authored-hook' as effectId,
    triggers: [
      EffectTrigger.BeforeEffect,
      EffectTrigger.AfterEffect,
      EffectTrigger.OnMarkDestroy,
      EffectTrigger.OnBeforeHeal,
    ],
    when: ctx => {
      if (ctx.trigger === EffectTrigger.BeforeEffect || ctx.trigger === EffectTrigger.AfterEffect)
        return ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id
      if (ctx.trigger === EffectTrigger.OnMarkDestroy) return ctx.source === fantasy
      return true
    },
    apply: ctx => {
      if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
        trace.push('admitted')
        if (variant === 'cancel') ctx.parent.available = false
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-hp') pet.currentHp = 50
        if (variant === 'late-max-hp') pet.attributeSystem.updateBaseValue('maxHp', 409)
        if (variant === 'late-remove') fantasy?.consumeStack(setup, 1)
      }
      if (ctx.trigger === EffectTrigger.AfterEffect && ctx.parent instanceof EffectContext)
        trace.push({ success: ctx.parent.success })
      if (ctx.trigger === EffectTrigger.OnMarkDestroy) {
        trace.push('destroy-fantasy')
        if (variant === 'consume-owner') source.owner = a.team[1]
      }
      if (ctx.trigger === EffectTrigger.OnBeforeHeal) trace.push('heal')
    },
  })
  add('fixture/hooks').effects.push(hook)
  fantasy?.effects.push(hook)
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'wrong-owner' ? b.activePet : pet,
    AttackTargetOpinion.opponent,
    skill,
  )
  const damage = new DamageContext(use, pet, variant === 'wrong-owner' ? b.activePet : pet, 80)
  if (id === 'effect_skill_consume_huanxiang_raise_def_1_stage')
    battle.applyEffects(use, EffectTrigger.BeforeHit, source)
  else
    battle.applyEffects(
      damage,
      id === 'effect_mark_shiguangchongsheng' ? EffectTrigger.PostDamage : EffectTrigger.OnBeforeCalculateDamage,
      source,
    )
  const marks = (entries: MarkInstance[]) =>
    entries
      .map(m => ({ base: m.baseId, stack: m.stack, active: m.isActive }))
      .sort((x, y) => x.base.localeCompare(y.base))
  return {
    trace,
    damage: damage.modified,
    team: [...a.team, ...b.team].map(p => ({ hp: p.currentHp, def: p.stat.def, marks: marks(p.marks) })),
    nextRandom: battle.random(),
  }
}
for (const id of ids)
  for (const kind of ['skill', 'mark'] as const) {
    it.each(variants)(`${id}, ${kind}: current YAML parity for %s`, variant => {
      const actual = run(id, true, kind, variant)
      expect(actual).toEqual(run(id, false, kind, variant))
      expect(actual.trace).not.toContainEqual({ success: false })
      if (variant === 'normal') {
        expect(actual.trace).toContain('admitted')
        if (id === 'effect_mark_shiguangchongsheng') expect(actual.team[0].hp).toBe(100)
        if (id === 'effect_mark_damage_boost_based_on_hp_percentage') expect(actual.damage).toEqual([30, 0])
      }
    })
  }
it.each([0, 1, 99, 100, 101, 199, 200, 201, 299, 300, 301, 401])(
  'HP thresholds retain floor and strict comparison at %i',
  hp => {
    const id = 'effect_mark_damage_boost_based_on_hp_percentage'
    const actual = run(id, true, 'mark', 'normal', hp)
    expect(actual).toEqual(run(id, false, 'mark', 'normal', hp))
    expect(actual.damage).toEqual([hp < 100 ? 70 : hp < 200 ? 50 : hp < 300 ? 30 : 0, 0])
  },
)

it('pins all four candidate definitions to the current YAML', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/authoring-api-candidates.json', import.meta.url), 'utf8'),
  )
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      )
    return value
  }
  expect(manifest.records.map((record: { id: string }) => record.id).sort()).toEqual(
    Object.keys(officialAuthoredEffects).sort(),
  )
  for (const record of manifest.records) {
    const definition = definitions.find(entry => entry.id === record.id)
    expect(definition).toBeDefined()
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definition)))
        .digest('hex'),
    ).toBe(record.definitionSha256)
  }
})
