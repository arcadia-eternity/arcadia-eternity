import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  parameterAddress,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Category,
  Element,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  DamageType,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedDamageModifierEffects } from '@arcadia-eternity/data-pack-base/native'

const specs = {
  effect_ability_add_damage_40_if_using_yutu_skill: {
    tag: 'yutu',
    skill: 'fixture/yutu',
    percent: 0,
    delta: 40,
    defensive: false,
    config: '',
  },
  effect_emblem_increase_quan_skill_damage_5_percent: {
    tag: 'quan',
    skill: 'fixture/quan',
    percent: 5,
    delta: 0,
    defensive: true,
    config: '',
  },
  effect_emblem_zhongji_damage_boost_35_percent: {
    tag: '',
    skill: 'skill_zhongji',
    percent: 35,
    delta: 0,
    defensive: true,
    config: '',
  },
  effect_mark_hongbaoshizhiguang_add_200_fixed_damage: {
    tag: '',
    skill: 'skill_hongbaoshizhiguang',
    percent: 0,
    delta: 200,
    defensive: true,
    config: 'hongbaoshi_fixed_damage_value',
  },
  effect_mark_lanbaoshizhiguang_add_200_fixed_damage: {
    tag: '',
    skill: 'skill_lanbaoshizhili',
    percent: 0,
    delta: 200,
    defensive: true,
    config: 'lanbaoshi_fixed_damage_value',
  },
  effect_mark_jiguang_add_200_damage: {
    tag: '',
    skill: 'skill_jiguang',
    percent: 0,
    delta: 200,
    defensive: true,
    config: 'jiguang_fixed_damage_value',
  },
  effect_mark_jueying_add_200_damage: {
    tag: '',
    skill: 'skill_jueying',
    percent: 0,
    delta: 200,
    defensive: true,
    config: 'jueying_fixed_damage_value',
  },
} as const
type Id = keyof typeof specs
const ids = Object.keys(specs) as Id[]
const definitions = ['ability', 'emblem', 'mark'].flatMap(kind =>
  parse(readFileSync(new URL(`../../../../packs/base/data/effect_${kind}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const originals = new Map(ids.map(id => [id, definitions.find(d => d.id === id)]))
function reference(id: Id) {
  const d = structuredClone(originals.get(id))
  d.condition.conditions[1].target.base = 'usingSkillContext'
  d.condition.conditions[1].target.chain[0].arg = 'skill'
  return d
}
const oracles = new Map(ids.map(id => [id, EffectParser.parse(reference(id))]))
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
  'second-tag',
  'wrong-skill',
  'wrong-owner',
  'nested',
  'cancel',
  'late-skill',
  'late-value',
  'zero-value',
  'repeat',
  'phase',
] as const
function run(id: Id, native: boolean, markSource: boolean, variant: (typeof variants)[number]) {
  const spec = specs[id],
    { battle, a, b, debuff } = makeScenario(2020)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  const base = new BaseSkill(
    (variant === 'wrong-skill' ? 'fixture/wrong' : spec.skill) as baseSkillId,
    Category.Special,
    Element.Normal,
    40,
    100,
    0,
    0,
    AttackTargetOpinion.opponent,
    1,
    true,
  )
  if (spec.tag && variant !== 'wrong-skill')
    base.tags.push(...(variant === 'second-tag' ? ['unrelated', spec.tag] : [spec.tag, 'unrelated']))
  const used = new SkillInstance(base)
  used.setOwner(a.activePet)
  a.activePet.skills[0] = used
  battle.skillMap.set(used.id, used)
  const owner = spec.defensive ? b.activePet : a.activePet
  const mark = new BaseMark('fixture/damage-selection' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
  }).createInstance()
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  const source = markSource ? mark : owner.skills[0]
  const effect = native ? generatedDamageModifierEffects[id] : oracles.get(id)!
  source.effects.push(effect)
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  const key = native ? parameterAddress(id, 'parameters', 'delta') : `${id}.${spec.config}`
  if (spec.config) battle.configSystem.set(key, variant === 'zero-value' ? 0 : 200)
  const turn = new TurnContext(battle),
    use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, used)
  const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeEffect, source) : use
  const damage = new DamageContext(parent, a.activePet, b.activePet, 100)
  damage.damageType = DamageType.Special
  if (variant === 'wrong-owner') source.owner = owner.owner!.team[1]
  let admitted = 0
  a.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/damage-selection-admission' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'cancel') (c.parent as EffectContext<EffectTrigger>).available = false
        if (variant === 'late-value' && spec.config) battle.configSystem.set(key, 37)
        if (variant === 'late-skill') use.skill = b.activePet.skills[1]
      },
    }),
  )
  if (variant === 'phase') b.activePet.damage(damage)
  else {
    battle.applyEffects(damage, originals.get(id).trigger as EffectTrigger.OnDamage, source)
    if (variant === 'repeat') battle.applyEffects(damage, originals.get(id).trigger as EffectTrigger.OnDamage, source)
  }
  return {
    admitted,
    sourceActive: mark.isActive,
    sourceStack: mark.stack,
    modified: damage.modified,
    hp: b.activePet.currentHp,
    result: damage.damageResult,
    next: battle.random(),
  }
}
for (const id of ids) {
  it(`${id}: exact C07/C09 source failures`, () => {
    expect(() => EffectParser.parse(originals.get(id))).toThrow()
    const spelling = structuredClone(originals.get(id))
    spelling.condition.conditions[1].target.base = 'usingSkillContext'
    expect(() => EffectParser.parse(spelling)).toThrow(/skillId/)
    const ledger = JSON.parse(
      readFileSync(new URL('../../../../docs/v4/validation/damage-modifiers-candidates.json', import.meta.url), 'utf8'),
    )
    const recipe = ledger.records.find((r: { id: string }) => r.id === id).recipe
    expect(recipe.selectorRepairs).toEqual(['/condition/conditions/1/target/base'])
    expect(recipe.pathRepairs).toEqual([
      { path: '/condition/conditions/1/target/chain/0/arg', before: 'skillId', after: 'skill' },
    ])
  })
  for (const markSource of [false, true])
    for (const variant of variants)
      it(`${id} markSource=${markSource} ${variant}`, () => {
        const actual = run(id, true, markSource, variant)
        expect(actual).toEqual(run(id, false, markSource, variant))
        const eligible = !['wrong-skill', 'wrong-owner'].includes(variant),
          count = variant === 'repeat' && !(markSource && originals.get(id).consumesStacks) ? 2 : 1
        expect(actual.admitted).toBe(eligible ? count : 0)
        const spec = specs[id],
          delta = spec.config ? (variant === 'zero-value' ? 0 : variant === 'late-value' ? 37 : 200) : spec.delta
        expect(actual.modified).toEqual(
          eligible && variant !== 'cancel' ? [spec.percent * count, delta * count] : [0, 0],
        )
      }, 30000)
}
