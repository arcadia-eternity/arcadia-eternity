import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  createEmblemSkillCost,
  effectAuthoring,
  parameterAddress,
  BaseMark,
  BaseSkill,
  SkillInstance,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  RageContext,
  AttackTargetOpinion,
  Category,
  Element,
  SkillPhase,
  BattleMessageType,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const id = 'effect_emblem_yinji_reduce_rage_cost_xinzhiyinji'
const original = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_emblem.yaml', import.meta.url), 'utf8'),
  { merge: true },
).find((d: { id: string }) => d.id === id)
function repaired() {
  const d = structuredClone(original)
  for (const condition of d.condition.conditions[1].conditions) condition.target.chain[0].arg = 'skill'
  return d
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'small',
  'zero',
  'negative',
  'wrong-skill',
  'wrong-owner',
  'nested',
  'cancel',
  'late-cost',
  'late-skill',
  'repeat',
  'suppressed',
  'phase',
  'phase-low-rage',
  'phase-no-rage',
] as const
function run(
  native: boolean,
  skillId: string,
  kind: 'mark' | 'skill',
  variant: (typeof variants)[number],
  reduction?: number,
) {
  const { battle, a, b, debuff } = makeScenario(831)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = a.activePet
  const used = new SkillInstance(
    new BaseSkill(
      (variant === 'wrong-skill' ? 'fixture/wrong' : skillId) as baseSkillId,
      Category.Status,
      Element.Normal,
      0,
      100,
      10,
    ),
  )
  used.setOwner(owner)
  owner.skills.push(used)
  const mark = new BaseMark('fixture/cost-source' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
    duration: -1,
  }).createInstance()
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  mark.isSuppressed = variant === 'suppressed'
  const source = kind === 'mark' ? mark : owner.skills[0]
  const effect = native ? createEmblemSkillCost() : EffectParser.parse(repaired())
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  if (reduction !== undefined) battle.configSystem.set(parameterAddress(id, 'parameters', 'reduction'), reduction)
  source.effects.push(effect)
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'wrong-owner' ? a.team[1] : owner,
    AttackTargetOpinion.opponent,
    used,
  )
  use.updateActualTarget()
  use.hitOverrides.push({ willHit: true, priority: 1000 })
  if (variant === 'small') use.rage = 3
  if (variant === 'zero') use.rage = 0
  if (variant === 'negative') use.rage = -2
  a.currentRage = variant === 'phase-low-rage' ? 5 : variant === 'phase-no-rage' ? 4 : 20
  let applications = 0
  const trace: unknown[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/cost-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.AfterEffect, EffectTrigger.BeforeRageLoss],
      when: ctx =>
        ctx.parent instanceof RageContext || (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply: ctx => {
        if (ctx.parent instanceof RageContext) trace.push(['payment', ctx.parent.value])
        else if (ctx.parent instanceof EffectContext) {
          trace.push([ctx.trigger, use.rage])
          if (ctx.trigger === EffectTrigger.BeforeEffect) {
            applications++
            if (variant === 'cancel') ctx.parent.available = false
            if (variant === 'late-cost') use.rage = 22
            if (variant === 'late-skill') use.skill = owner.skills[0]
          }
        }
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.SkillUse) trace.push(['use', message.data.rage])
    if (message.type === BattleMessageType.SkillUseFail) trace.push(['fail', message.data.reason])
  })
  if (variant.startsWith('phase')) {
    const phase = new SkillPhase(battle, a, owner, AttackTargetOpinion.opponent, used, use.parent, use)
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
  } else {
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeUseSkillCheck, source) : use
    battle.applyEffects(parent, EffectTrigger.BeforeUseSkillCheck as EffectTrigger, source)
    if (variant === 'repeat') battle.applyEffects(parent, EffectTrigger.BeforeUseSkillCheck as EffectTrigger, source)
  }
  return { rage: use.rage, skillRage: used.rage, playerRage: a.currentRage, applications, trace, next: battle.random() }
}
for (const skillId of ['skill_xinzhiyinji', 'skill_xuehongyinji'])
  for (const kind of ['mark', 'skill'] as const)
    for (const variant of variants)
      it(`${skillId} ${kind} ${variant}`, () => {
        const actual = run(true, skillId, kind, variant)
        expect(actual).toEqual(run(false, skillId, kind, variant))
        const admitted =
          !['wrong-skill', 'wrong-owner'].includes(variant) && !(kind === 'mark' && variant === 'suppressed')
        expect(actual.applications).toBe(admitted ? (variant === 'repeat' ? 2 : 1) : 0)
        expect(actual.skillRage).toBe(10)
        if (admitted && variant !== 'cancel')
          expect(actual.rage).toBe(
            ['small', 'zero', 'negative', 'repeat'].includes(variant) ? 0 : variant === 'late-cost' ? 17 : 5,
          )
        if (variant === 'phase') {
          expect(actual.playerRage).toBe(10)
          expect(actual.trace).toContainEqual(['payment', 10])
          expect(actual.trace).toContainEqual(['use', 5])
        }
        if (variant === 'phase-low-rage') {
          expect(actual.playerRage).toBe(0)
          expect(actual.trace).toContainEqual(['payment', 10])
        }
        if (variant === 'phase-no-rage') {
          expect(actual.playerRage).toBe(4)
          expect(actual.trace).toContainEqual(['fail', 'no_rage'])
        }
      })
it('requires only the explicit skillId-to-skill field repair', () => {
  expect(() => EffectParser.parse(original)).toThrow()
  expect(() => EffectParser.parse(repaired())).not.toThrow()
})
it('accepts a configured fractional reduction', () => {
  expect(run(true, 'skill_xinzhiyinji', 'mark', 'normal', 2.5).rage).toBe(7.5)
})
