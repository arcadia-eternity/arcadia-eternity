import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedDamageModifierEffects,
  BaseMark,
  GameRng,
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
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const ids = ['effect_skill_fixed_damage_30_70', 'effect_skill_fixed_damage_30_70_if_opponent_has_cuimian'] as const
type Id = (typeof ids)[number]
const definitions = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const originals = new Map(ids.map(id => [id, definitions.find((d: { id: string }) => d.id === id)]))
const references = new Map(
  ids.map(id => {
    const d = structuredClone(originals.get(id))
    // Only the versioned value tag remains adapted until selectorValue compatibility lands.
    d.apply.delta.type = 'selector'
    return [id, EffectParser.parse(d)]
  }),
)
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
  'missing-support',
  'wrong-owner',
  'late-owner',
  'late-support',
  'cancel',
  'repeat',
  'phase',
] as const
function run(id: Id, native: boolean, markSource: boolean, variant: (typeof variants)[number], seed: number) {
  const { battle, a, b, debuff } = makeScenario(seed)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  const mark = new BaseMark('fixture/random-damage' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
  }).createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(mark)
  const source = markSource ? mark : a.activePet.skills[0]
  source.effects.push(native ? generatedDamageModifierEffects[id] : references.get(id)!)
  const support = new BaseMark('mark_cuimian' as baseMarkId, [], debuff.config).createInstance()
  support.setOwner(b.activePet, battle.emitter)
  if (variant !== 'missing-support') b.activePet.marks.push(support)
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    a.activePet,
    AttackTargetOpinion.opponent,
    a.activePet.skills[0],
  )
  const damage = new DamageContext(use, a.activePet, b.activePet, 100)
  damage.damageType = DamageType.Physical
  if (variant === 'wrong-owner') source.owner = a.team[1]
  let admitted = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/random-admission' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'cancel') (c.parent as EffectContext<EffectTrigger>).available = false
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-support') b.activePet.marks = b.activePet.marks.filter(m => m !== support)
      },
    }),
  )
  if (variant === 'phase') b.activePet.damage(damage)
  else {
    battle.applyEffects(damage, EffectTrigger.OnBeforeCalculateDamage, source)
    if (variant === 'repeat') battle.applyEffects(damage, EffectTrigger.OnBeforeCalculateDamage, source)
  }
  return {
    admitted,
    modified: damage.modified,
    result: damage.damageResult,
    hp: b.activePet.currentHp,
    next: battle.random(),
  }
}
for (const id of ids) {
  it(`${id}: versioned tag and restored historical sampleBetween`, () => {
    expect(() => EffectParser.parse(originals.get(id))).toThrow()
    const renamed = structuredClone(originals.get(id))
    renamed.apply.delta.type = 'selector'
    expect(() => EffectParser.parse(renamed)).not.toThrow()
    const ledger = JSON.parse(
      readFileSync(new URL('../../../../docs/v4/validation/damage-modifiers-candidates.json', import.meta.url), 'utf8'),
    )
    expect(ledger.records.find((r: { id: string }) => r.id === id).recipe.rangeDecision).toEqual({
      decision: 'C14',
      path: '/apply/delta',
      min: 30,
      max: 70,
    })
  })
  for (const seed of [1, 2, 3, 4, 17, 103, 201, 2024])
    for (const markSource of [false, true])
      for (const variant of variants)
        it(`${id} seed=${seed} markSource=${markSource} ${variant}`, () => {
          const actual = run(id, true, markSource, variant, seed)
          expect(actual).toEqual(run(id, false, markSource, variant, seed))
          const eligible = variant !== 'wrong-owner' && !(id === ids[1] && variant === 'missing-support'),
            count = variant === 'repeat' ? 2 : 1
          expect(actual.admitted).toBe(eligible ? count : 0)
          const expected = new GameRng(seed)
          let delta = 0
          if (eligible && variant !== 'cancel')
            for (let i = 0; i < count; i++) delta += Math.floor(expected.next() * 41) + 30
          expect(actual.modified).toEqual([0, delta])
          expect(actual.next).toBe(expected.next())
        }, 30000)
}
