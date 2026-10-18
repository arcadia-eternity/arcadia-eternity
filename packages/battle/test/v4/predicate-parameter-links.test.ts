import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  defineAction,
  definePredicate,
  defineTrigger,
  defineNativeEffect,
  CapabilityRegistry,
  compileRule,
  EffectTrigger,
  EffectContext,
  Pet,
  TurnContext,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  setGlobalLogger,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const scalar = Type.Number({ minimum: 0, maximum: 1 })
const publicSlot = { effectiveSchema: scalar, operations: [ConfigModifierType.override] }
const turn = defineTrigger({
  id: 'turn',
  trigger: EffectTrigger.TurnEnd,
  params: Type.Object({}, { additionalProperties: false }),
  provides: { skill: ['ownerPet'] },
  resolve(ctx) {
    return ctx.source.owner instanceof Pet ? { ownerPet: ctx.source.owner } : {}
  },
})
function content() {
  return {
    formatVersion: 1,
    id: 'test/shared-condition',
    parameters: { ratio: { nodeId: 'ratio-slot', kind: 'number', value: 0.5 } },
    trigger: { nodeId: 'turn', id: turn.id },
    when: { nodeId: 'condition', id: 'lowHp', params: { threshold: { parameter: 'ratio' } } },
    actions: [{ stepId: 'heal', id: 'heal', params: { ratio: { parameter: 'ratio' } } }],
  }
}
function registry(events: [string, number][]) {
  return new CapabilityRegistry(
    [
      defineAction({
        id: 'heal',
        needs: ['ownerPet'],
        params: Type.Object({ ratio: scalar }, { additionalProperties: false }),
        publicParams: { ratio: publicSlot },
        execute(ctx, args) {
          events.push(['action', args.ratio])
          ctx.ops.heal(ctx.ownerPet, ctx.ownerPet.stat.maxHp * args.ratio)
        },
      }),
    ],
    {
      triggers: [turn],
      predicates: [
        definePredicate({
          id: 'lowHp',
          needs: ['ownerPet'],
          params: Type.Object({ threshold: scalar }, { additionalProperties: false }),
          publicParams: { threshold: publicSlot },
          test(ctx, args) {
            const threshold: number = args.threshold
            events.push(['when', threshold])
            return ctx.ownerPet.currentHp < ctx.ownerPet.stat.maxHp * threshold
          },
        }),
      ],
    },
  )
}

it('shares one Config address while keeping predicate and action read times independent', () => {
  const { battle, a } = makeScenario()
  battles.push(battle)
  const events: [string, number][] = []
  const result = compileRule(content(), registry(events), { contentId: 'test', sourceKind: 'skill' })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  expect(result.parameterDefinitions).toHaveLength(1)
  expect(result.rule.when?.params).toEqual({ threshold: { parameter: 'ratio' } })
  result.parameters.install(battle.configSystem)
  const source = a.activePet.skills[0]
  source.effects.push(
    result.effect,
    defineNativeEffect({
      id: 'test/before-parameters' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === result.effect.id,
      apply() {
        result.parameters.modify(
          battle.configSystem,
          result.parameterDefinitions[0],
          new ConfigModifier(ConfigDurationType.binding, 'zero', 0, ConfigModifierType.override, 0),
          source,
        )
      },
    }),
  )
  a.activePet.currentHp = 1
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(events).toEqual([
    ['when', 0.5],
    ['action', 0],
  ])
  expect(a.activePet.currentHp).toBe(1)
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(events).toEqual([
    ['when', 0.5],
    ['action', 0],
    ['when', 0],
  ])
})

it('retains predicate references when saving and rejects missing references at the predicate node', () => {
  const capabilities = registry([])
  const result = compileRule(content(), capabilities, { contentId: 'test', sourceKind: 'skill' })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const restored = compileRule(JSON.parse(JSON.stringify(result.rule)), capabilities, {
    contentId: 'test',
    sourceKind: 'skill',
  })
  expect(restored.ok).toBe(true)
  if (!restored.ok) throw new Error('Expected saved rule to compile')
  expect(restored.rule).toEqual(result.rule)
  const missing = { ...content(), parameters: {} }
  expect(compileRule(missing, capabilities, { contentId: 'test', sourceKind: 'skill' })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'MISSING_REFERENCE', nodeId: 'condition', field: 'when' }],
  })
})
