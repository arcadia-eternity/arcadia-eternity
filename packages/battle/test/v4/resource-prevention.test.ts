import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  RageContext,
  ConsumeStackContext,
  AttackTargetOpinion,
  BattleMessageType,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createResourcePrevention } from '@arcadia-eternity/data-pack-base/native'

const candidates = createResourcePrevention()
const definitions = ['mark', 'ability'].flatMap(kind =>
  parse(readFileSync(new URL(`./fixtures/effect-regression/effect_${kind}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'wrong-subject',
  'inactive-owner',
  'wrong-resource',
  'nested',
  'cancel-effect',
  'late-owner',
  'repeat',
  'suppressed',
] as const
function run(id: keyof typeof candidates, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(741)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const stack = id.startsWith('effect_mark')
  const owner = variant === 'inactive-owner' ? a.team[1] : a.activePet
  const protector = new BaseMark('fixture/protector' as baseMarkId, [], {
    ...debuff.config,
    persistent: true,
  }).createInstance()
  protector.setOwner(owner, battle.emitter)
  owner.marks.push(protector)
  protector.isSuppressed = variant === 'suppressed'
  const source = kind === 'mark' ? protector : owner.skills[0]
  const definition = structuredClone(definitions.find((d: { id: string }) => d.id === id))
  if (stack) definition.condition.conditions[1].target.chain[0].arg = 'mark'
  source.effects.push(native ? candidates[id] : EffectParser.parse(definition))
  const consumed = new BaseMark((variant === 'wrong-resource' ? 'fixture/other' : 'mark_huanxiang') as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 20,
    persistent: true,
  }).createInstance()
  const recipient = variant === 'wrong-subject' ? b.activePet : owner
  consumed.setOwner(recipient, battle.emitter)
  consumed.stack = 5
  recipient.marks.push(consumed)
  const actor = variant === 'wrong-subject' ? a : b
  const use = new UseSkillContext(
    new TurnContext(battle),
    actor,
    actor.activePet,
    AttackTargetOpinion.opponent,
    actor.activePet.skills[0],
  )
  const parent = new EffectContext(use, EffectTrigger.OnHit, actor.activePet.skills[0])
  b.currentRage = 20
  const trace: unknown[] = []
  let applications = 0
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/prevention-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnConsumeStack, EffectTrigger.OnRageGain],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply: ctx => {
        if (ctx.parent instanceof EffectContext) {
          applications++
          trace.push(['before'])
          if (variant === 'cancel-effect') ctx.parent.available = false
          if (variant === 'late-owner') source.owner = b.activePet
        } else if (ctx.parent instanceof ConsumeStackContext) trace.push(['consume', ctx.parent.actualAmount])
        else if (ctx.parent instanceof RageContext) trace.push(['gain', ctx.parent.rageChangeResult])
      },
    }),
  )
  battle.registerListener(message => {
    if (message.type === BattleMessageType.MarkUpdate && message.data.mark.id === consumed.id)
      trace.push(['stack', message.data.mark.stack])
    if (message.type === BattleMessageType.RageChange) trace.push(['rage', message.data.before, message.data.after])
  })
  const results: number[] = []
  function execute() {
    if (stack) {
      if (variant === 'nested') {
        const event = new ConsumeStackContext(parent, consumed, 2, 2)
        battle.applyEffects(
          new EffectContext(event, EffectTrigger.OnBeforeConsumeStack, source),
          EffectTrigger.OnBeforeConsumeStack as EffectTrigger,
          source,
        )
        results.push(event.available ? 2 : 0)
      } else results.push(consumed.consumeStack(parent, 2))
    } else {
      const rage = new RageContext(
        variant === 'nested' ? parent : use,
        b,
        variant === 'wrong-resource' ? 'effect' : 'skillHit',
        'add',
        10,
      )
      b.addRage(rage)
      results.push(rage.rageChangeResult)
    }
  }
  execute()
  if (variant === 'repeat') execute()
  return { stack: consumed.stack, rage: b.currentRage, results, applications, trace, next: battle.random() }
}
for (const id of Object.keys(candidates) as (keyof typeof candidates)[])
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        const stack = id.startsWith('effect_mark')
        const admitted = !(
          ['wrong-subject', 'wrong-resource'].includes(variant) ||
          (!stack && variant === 'inactive-owner') ||
          (kind === 'mark' && variant === 'suppressed')
        )
        const count = variant === 'repeat' ? 2 : 1
        expect(actual.applications).toBe(admitted ? count : 0)
        const prevented = admitted && variant !== 'cancel-effect'
        expect(actual.results).toEqual(Array(count).fill(prevented ? 0 : stack ? 2 : 10))
        if (stack && variant !== 'nested') expect(actual.stack).toBe(5 - (prevented ? 0 : 2 * count))
        if (!stack) expect(actual.rage).toBe(20 + (prevented ? 0 : 10 * count))
      })
it('records the ConsumeStackContext markId source repair explicitly', () => {
  const original = definitions.find((d: { id: string }) => d.id === 'effect_mark_zhenshihuanxiang_prevent_consume')
  expect(() => EffectParser.parse(original)).toThrow()
  expect(original.condition.conditions[1].target.chain[0].arg).toBe('markId')
})

it('preventing automatic consumption does not cancel the effect body, and removal takes effect on the next use', () => {
  const { battle, a, b, debuff } = makeScenario(742)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const protector = new BaseMark(
    'fixture/protector' as baseMarkId,
    [candidates.effect_mark_zhenshihuanxiang_prevent_consume],
    debuff.config,
  ).createInstance()
  const fantasy = new BaseMark('mark_huanxiang' as baseMarkId, [], { ...debuff.config, maxStacks: 20 }).createInstance()
  for (const mark of [protector, fantasy]) {
    mark.setOwner(a.activePet, battle.emitter)
    a.activePet.marks.push(mark)
  }
  fantasy.stack = 5
  let executions = 0
  fantasy.effects.push(
    defineNativeEffect({
      id: 'fixture/auto-consumer' as effectId,
      triggers: [EffectTrigger.OnHit],
      consumesStacks: 2,
      apply() {
        executions++
      },
    }),
  )
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    a.activePet,
    AttackTargetOpinion.opponent,
    a.activePet.skills[0],
  )
  battle.applyEffects(use, EffectTrigger.OnHit, fantasy)
  expect(fantasy.stack).toBe(5)
  expect(executions).toBe(1)
  protector.isActive = false
  battle.applyEffects(use, EffectTrigger.OnHit, fantasy)
  expect(fantasy.stack).toBe(3)
  expect(executions).toBe(2)
})
