import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  parameterAddress,
  BaseMark,
  SkillInstance,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  Category,
  SkillPhase,
  BattleMessageType,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createLowHealthExecution } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_skill_execute_opponent_hp_under_75_hit_or_miss'
const definition = (
  parse(readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'), {
    merge: true,
  }) as { id: string }[]
).find(d => d.id === id)!
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'below',
  'boundary',
  'above',
  'dead',
  'zero-alive',
  'cancel',
  'late-hp',
  'late-opponent',
  'wrong-owner',
  'wrong-skill',
  'nested',
  'repeat',
  'suppressed',
  'phase-hit',
  'phase-miss',
] as const
function run(
  native: boolean,
  kind: 'skill' | 'mark',
  trigger: 'OnHit' | 'OnMiss',
  variant: (typeof variants)[number],
  threshold?: number,
) {
  const { battle, a, b, debuff } = makeScenario(801)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = a.activePet,
    target = b.activePet,
    reserve = b.team[1],
    skill = owner.skills[0]
  const mark = new BaseMark('fixture/execution-source' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
    duration: -1,
  }).createInstance()
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  mark.isSuppressed = variant === 'suppressed'
  const source = kind === 'skill' ? skill : mark
  const effect = native ? createLowHealthExecution()[id] : EffectParser.parse(definition)
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  if (threshold !== undefined) battle.configSystem.set(parameterAddress(id, 'parameters', 'threshold'), threshold)
  source.effects.push(effect)
  const other = new SkillInstance(skill.base)
  other.setOwner(owner)
  owner.skills.push(other)
  target.currentHp =
    variant === 'boundary' ? 75 : variant === 'above' ? 76 : ['dead', 'zero-alive'].includes(variant) ? 0 : 74
  target.isAlive = variant !== 'dead'
  reserve.currentHp = 100
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'wrong-owner' ? a.team[1] : owner,
    AttackTargetOpinion.opponent,
    variant === 'wrong-skill' ? other : skill,
  )
  use.updateActualTarget()
  use.category = Category.Status
  use.hitOverrides.push({ willHit: variant !== 'phase-miss', priority: 1000 })
  a.currentRage = a.maxRage
  const trace: unknown[] = []
  let applications = 0
  const petName = (pet: string | undefined) =>
    pet === target.id ? 'target' : pet === reserve.id ? 'reserve' : pet === owner.id ? 'owner' : pet
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/execution-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.AfterEffect, EffectTrigger.OnDefeat, EffectTrigger.OnDamage],
      when: ctx =>
        ctx.trigger === EffectTrigger.OnDefeat ||
        ctx.trigger === EffectTrigger.OnDamage ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply: ctx => {
        trace.push([ctx.trigger, target.currentHp, reserve.currentHp])
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          applications++
          if (variant === 'cancel') ctx.parent.available = false
          if (variant === 'late-hp') target.currentHp = 100
          if (variant === 'late-opponent') b.activePet = reserve
        }
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.PetDefeated)
      trace.push(['defeated', petName(message.data.pet), petName(message.data.killer)])
    if (message.type === BattleMessageType.Damage) trace.push('damage')
  })
  if (variant.startsWith('phase-')) {
    const phase = new SkillPhase(battle, a, owner, AttackTargetOpinion.opponent, skill, use.parent, use)
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
  } else {
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger[trigger], source) : use
    battle.applyEffects(parent, EffectTrigger[trigger] as EffectTrigger, source)
    if (variant === 'repeat') battle.applyEffects(parent, EffectTrigger[trigger] as EffectTrigger, source)
  }
  return {
    hp: [target.currentHp, reserve.currentHp],
    alive: [target.isAlive, reserve.isAlive],
    applications,
    trace,
    killer: battle.lastKiller === a,
    next: battle.random(),
  }
}
for (const kind of ['skill', 'mark'] as const)
  for (const trigger of ['OnHit', 'OnMiss'] as const)
    for (const variant of variants)
      it(`${kind} ${trigger} ${variant}`, () => {
        const actual = run(true, kind, trigger, variant)
        expect(actual).toEqual(run(false, kind, trigger, variant))
        const admitted =
          !['boundary', 'above', 'wrong-owner'].includes(variant) &&
          !(kind === 'skill' && variant === 'wrong-skill') &&
          !(kind === 'mark' && variant === 'suppressed')
        expect(actual.applications).toBe(admitted ? (variant === 'repeat' ? 2 : 1) : 0)
        const kills = actual.trace.filter(entry => Array.isArray(entry) && entry[0] === 'defeated')
        expect(kills).toHaveLength(
          admitted && variant !== 'cancel' && variant !== 'dead' ? (variant.startsWith('phase-') ? 2 : 1) : 0,
        )
        expect(actual.trace).not.toContain('damage')
        expect(actual.killer).toBe(variant.startsWith('phase-'))
        if (variant === 'late-opponent') expect(actual.hp).toEqual([74, 0])
      })
it('uses the configured strict HP threshold', () => {
  expect(run(true, 'skill', 'OnHit', 'below', 74).hp[0]).toBe(74)
  expect(run(true, 'skill', 'OnHit', 'boundary', 76).hp[0]).toBe(0)
})

it('skips duplicate/dead targets and does not dispatch damage or defeat effects itself', () => {
  const f = makeScenario(802)
  battles.push(f.battle)
  const { selectFrom, ops, compileEffect, defineEffect } = effectAuthoring
  const target = f.b.activePet
  target.currentHp = 50
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/execute-duplicate',
      on: 'TurnEnd',
      execute: selectFrom([target, target]).apply(ops.executeKill()),
    }),
  )
  const messages: unknown[] = []
  f.battle.registerListener(message => {
    if (message.type === BattleMessageType.PetDefeated || message.type === BattleMessageType.Damage)
      messages.push(message.type)
  })
  f.battle.lastKiller = f.b
  const context = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0], effect)
  f.battle.executionBudget.run(0, () => effect.innerApply(context))
  expect(messages).toEqual([BattleMessageType.PetDefeated])
  expect(target.currentHp).toBe(0)
  expect(target.isAlive).toBe(false)
  expect(f.battle.lastKiller).toBe(f.b)
})

it('rejects a foreign target before defeating any selected pet', () => {
  const f = makeScenario(803),
    other = makeScenario(804)
  battles.push(f.battle, other.battle)
  const { selectFrom, ops, compileEffect, defineEffect } = effectAuthoring
  const target = f.b.activePet,
    foreign = other.b.activePet
  target.currentHp = foreign.currentHp = 50
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/execute-foreign',
      on: 'TurnEnd',
      execute: selectFrom([target, foreign]).apply(ops.executeKill()),
    }),
  )
  const context = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0], effect)
  expect(() => f.battle.executionBudget.run(0, () => effect.innerApply(context))).toThrow('Cross-battle')
  expect([target.currentHp, foreign.currentHp]).toEqual([50, 50])
  expect([target.isAlive, foreign.isAlive]).toEqual([true, true])
})
