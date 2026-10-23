import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  AddMarkContext,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  StatLevelMarkInstanceImpl,
  StatTypeWithoutHp,
  defineNativeEffect,
  SkillPhase,
  Category,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { generatedStatStageCandidates } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_skill_set_self_spa_to_atk'
const original = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
).find((d: { id: string }) => d.id === id)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'negative',
  'zero',
  'late-remove',
  'late-value',
  'late-owner',
  'cancel',
  'cancel-add',
  'nested',
  'missing',
  'wrong-skill',
  'phase',
  'repeat',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const f = makeScenario(301),
    { battle, a, b } = f
  battles.push(battle)
  const pet = a.activePet,
    skill = pet.skills[0]
  skill.effects.splice(0)
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  pet.addStatStage(setup, StatTypeWithoutHp.spa, 3)
  if (variant !== 'zero') pet.addStatStage(setup, StatTypeWithoutHp.atk, variant === 'negative' ? -2 : 2)
  a.team[1].addStatStage(setup, StatTypeWithoutHp.atk, 4)
  a.team[1].addStatStage(setup, StatTypeWithoutHp.spa, 1)
  let source: typeof skill | (typeof pet.marks)[number] = skill
  if (kind === 'mark') {
    const base = new BaseMark('fixture/copy' as baseMarkId, [], f.debuff.config)
    battle.addMark(new AddMarkContext(setup, pet, base))
    source = pet.marks.find(m => m.base === base)!
  }
  // Filled from the generated catalog once the baseline is characterized.
  const effects = generatedStatStageCandidates.effects as Record<string, (typeof skill.effects)[number]>
  source.effects.push(native ? effects[id] : EffectParser.parse(original))
  const writes: number[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/copy-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
      when: ctx =>
        ctx.trigger === EffectTrigger.BeforeEffect
          ? ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id
          : ctx.parent instanceof AddMarkContext && ctx.parent.parent.effect?.id === id,
      apply(ctx) {
        if (ctx.parent instanceof AddMarkContext) {
          writes.push(ctx.parent.stack)
          if (variant === 'cancel-add') ctx.parent.available = false
        } else if (ctx.parent instanceof EffectContext) {
          if (variant === 'late-remove') pet.marks = pet.marks.filter(m => m.baseId !== 'stat_stage_atk_up')
          if (variant === 'late-value') pet.addStatStage(setup, StatTypeWithoutHp.atk, 2)
          if (variant === 'late-owner') source.owner = a.team[1]
          if (variant === 'cancel') ctx.parent.available = false
        }
      },
    }),
  )
  const turn = new TurnContext(battle)
  const use = new UseSkillContext(
    turn,
    a,
    pet,
    AttackTargetOpinion.opponent,
    variant === 'wrong-skill' ? b.activePet.skills[0] : skill,
  )
  if (variant === 'phase') {
    use.category = Category.Status
    use.hitOverrides.push({ willHit: true, priority: 0 })
    a.currentRage = a.maxRage
    const phase = new SkillPhase(battle, a, pet, AttackTargetOpinion.opponent, skill, turn, use)
    phase.initialize()
    phase.execute()
  } else {
    const parent =
      variant === 'missing'
        ? turn
        : variant === 'nested'
          ? new EffectContext(use, EffectTrigger.BeforeEffect, source)
          : use
    battle.applyEffects<EffectTrigger>(parent, EffectTrigger.BeforeHit, source)
    if (variant === 'repeat') battle.applyEffects(use, EffectTrigger.BeforeHit, source)
  }
  return {
    writes,
    levels: [...a.team, ...b.team].map(p =>
      p.marks
        .filter(
          (m): m is StatLevelMarkInstanceImpl =>
            m instanceof StatLevelMarkInstanceImpl && m.statType === StatTypeWithoutHp.spa,
        )
        .map(m => m.level),
    ),
    nextRandom: battle.random(),
  }
}
it('characterizes ignored set strategy: attack +2 adds to special attack +3', () => {
  expect(original.apply.strategy).toBe('set')
  const result = run(false, 'skill', 'normal')
  expect(result.writes).toEqual([2])
  expect(result.levels).toEqual([[5], [1], [], []])
})
for (const kind of ['skill', 'mark'] as const)
  it.each(variants)(`dynamic additive stage ${kind}: %s`, variant => {
    const actual = run(true, kind, variant)
    expect(actual).toEqual(run(false, kind, variant))
    const denied =
      ['negative', 'zero', 'missing', 'cancel'].includes(variant) || (variant === 'wrong-skill' && kind === 'skill')
    const expected: number[][] = [[3], [1], [], []]
    if (!denied && variant !== 'cancel-add' && variant !== 'late-remove') {
      expected[variant === 'late-owner' ? 1 : 0] = [variant === 'late-value' || variant === 'repeat' ? 6 : 5]
    }
    expect(actual.levels).toEqual(expected)
    expect(actual.writes).toEqual(
      denied
        ? []
        : variant === 'repeat'
          ? [2, 2]
          : [variant === 'late-remove' ? 0 : variant === 'late-value' || variant === 'late-owner' ? 4 : 2],
    )
  })
it('records ignored-field behavior explicitly without changing source YAML', () => {
  const ledger = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/stat-stages-candidates.json', import.meta.url), 'utf8'),
  )
  expect(ledger.records.find((r: { id: string }) => r.id === id).recipe.legacyIgnoredFields).toEqual([
    { path: '/apply/strategy', value: 'set', behavior: 'additive' },
  ])
})
