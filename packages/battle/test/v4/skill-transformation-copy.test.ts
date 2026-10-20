import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  createSkillTransformationCopy,
  createSkillTransformationRemoval,
  BaseMark,
  BaseSkill,
  SkillInstance,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  TransformContext,
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
const id = 'effect_skill_change_to_used_skill'
const definitions = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const original = definitions.find((d: { id: string }) => d.id === id)
function repaired() {
  const d = structuredClone(original)
  d.apply.newBase.selector.chain[0].arg = 'skill'
  d.apply.newBase.selector.chain[1] = { type: 'selectPath', arg: 'base' }
  d.condition.conditions[1].target.chain[0].arg = 'skill'
  return d
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  vi.restoreAllMocks()
})
const variants = [
  'normal',
  'same',
  'wrong-owner',
  'nested',
  'cancel',
  'cancel-transform',
  'late-used',
  'repeat',
  'copy-then-clear',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const { battle, a, b, debuff } = makeScenario(731)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const target = a.activePet.skills[0],
    initial = target.base
  const base = new BaseSkill(
    'fixture/copied' as baseSkillId,
    Category.Physical,
    Element.Normal,
    75,
    100,
    0,
    2,
    AttackTargetOpinion.opponent,
    1,
    true,
  )
  const used = new SkillInstance(base)
  used.setOwner(a.activePet)
  a.activePet.skills.push(used)
  const late = new SkillInstance(
    new BaseSkill(
      'fixture/late' as baseSkillId,
      Category.Special,
      Element.Normal,
      95,
      100,
      0,
      3,
      AttackTargetOpinion.opponent,
      1,
      true,
    ),
  )
  late.setOwner(a.activePet)
  a.activePet.skills.push(late)
  const mark = new BaseMark('fixture/copy-source' as baseMarkId, [], debuff.config).createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(mark)
  const source = kind === 'skill' ? target : mark
  source.effects.push(native ? createSkillTransformationCopy() : EffectParser.parse(repaired()))
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'wrong-owner' ? a.team[1] : a.activePet,
    AttackTargetOpinion.opponent,
    variant === 'same' ? target : used,
  )
  const trace: unknown[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/copy-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.BeforeTransform, EffectTrigger.AfterTransform],
      when: ctx =>
        ctx.parent instanceof TransformContext || (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply: ctx => {
        if (ctx.parent instanceof EffectContext) {
          trace.push(['before', target.baseId])
          if (variant === 'cancel') ctx.parent.available = false
          if (variant === 'late-used') use.skill = late
        }
        if (ctx.parent instanceof TransformContext) {
          trace.push([ctx.trigger, target.baseId])
          if (variant === 'cancel-transform') ctx.parent.available = false
        }
      },
    }),
  )
  const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.AfterUseSkillCheck, source) : use
  battle.applyEffects(parent, EffectTrigger.AfterUseSkillCheck as EffectTrigger, source)
  if (variant === 'repeat') battle.applyEffects(parent, EffectTrigger.AfterUseSkillCheck as EffectTrigger, source)
  const copied = { base: target.baseId, power: target.power, category: target.category }
  if (variant === 'copy-then-clear') {
    target.effects.push(
      native
        ? createSkillTransformationRemoval()
        : EffectParser.parse(definitions.find((d: { id: string }) => d.id === 'effect_skill_clear_transform_when_use')),
    )
    const ownUse = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, target)
    battle.applyEffects(ownUse, EffectTrigger.SkillUseEnd, target)
    expect(target.base).toBe(initial)
  }
  return {
    copied,
    records: battle.transformationSystem.getTransformationState(target).currentTransformations.length,
    base: target.baseId,
    trace,
    effects: target.effects.map(e => e.id),
    next: battle.random(),
  }
}
for (const kind of ['skill', 'mark'] as const)
  for (const variant of variants)
    it(`copy skill ${kind} ${variant}`, () => {
      const actual = run(true, kind, variant)
      expect(actual).toEqual(run(false, kind, variant))
      const changed = kind === 'skill' && !['same', 'wrong-owner', 'cancel', 'cancel-transform'].includes(variant)
      expect(actual.copied.base).toBe(
        changed ? (variant === 'late-used' ? 'fixture/late' : 'fixture/copied') : 'fixture/setup',
      )
      expect(actual.records).toBe(changed && variant !== 'copy-then-clear' ? 1 : 0)
      if (changed) expect(actual.copied.power).toBe(variant === 'late-used' ? 95 : 75)
    })
it('requires explicit C09/C19 repairs; the original selector is not silently accepted', () => {
  expect(() => EffectParser.parse(original)).toThrow()
  expect(() => EffectParser.parse(repaired())).not.toThrow()
  expect(original.apply.newBase.selector.chain.map((s: { arg: string }) => s.arg)).toEqual(['skillId', 'baseId'])
})

it('the C09-only reference passes a string to transformation; C19 supplies the prototype', () => {
  const { battle, a } = makeScenario(732)
  battles.push(battle)
  const source = a.activePet.skills[0],
    used = a.team[1].skills[0]
  const d = repaired()
  d.apply.newBase.selector.chain[1] = { type: 'select', arg: 'baseId' }
  const effect = EffectParser.parse(d)
  const apply = vi.spyOn(battle.transformationSystem, 'applyTransformation').mockReturnValue(true)
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, used)
  effect.innerApply(new EffectContext(use, EffectTrigger.AfterUseSkillCheck, source, effect))
  expect(apply).toHaveBeenCalledOnce()
  expect(apply.mock.calls[0][1]).toBe(used.baseId)
})
