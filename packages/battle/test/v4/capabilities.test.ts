import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  defineAction,
  CapabilityRegistry,
  defineNativeEffect,
  EffectTrigger,
  TurnContext,
  EffectContext,
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

const heal = defineAction({
  id: 'test.healByMaxHp',
  params: Type.Object(
    { ratio: Type.Number({ minimum: 0, maximum: 1, default: 0.1 }) },
    { additionalProperties: false },
  ),
  needs: ['ownerPet'],
  execute(ctx, params) {
    const ratio: number = params.ratio
    ctx.ops.heal(ctx.ownerPet, Math.floor(ctx.readMaxHp(ctx.ownerPet) * ratio))
  },
})

it('compiles distinct editable action uses and executes through real healing phases', () => {
  const { battle, a } = makeScenario()
  battles.push(battle)
  const source = a.activePet.skills[0]
  const registry = new CapabilityRegistry([heal])
  const input = { ratio: 0.25 }
  const first = registry.compileAction(heal.id, {}, ['ownerPet'])
  const second = registry.compileAction(heal.id, input, ['ownerPet'])
  input.ratio = 0.9
  const pet = a.activePet
  pet.currentHp = 10
  source.effects.push(
    defineNativeEffect({
      id: 'capability/heal' as effectId,
      triggers: [EffectTrigger.TurnStart],
      apply(effect) {
        const runtime = { effect, capabilities: { ownerPet: pet } }
        first.run(runtime)
        second.run(runtime)
      },
    }),
  )
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnStart, source)
  expect(pet.currentHp).toBe(10 + Math.floor(pet.stat.maxHp * 0.1) + Math.floor(pet.stat.maxHp * 0.25))
  expect(first.params).toEqual({ ratio: 0.1 })
  expect(second.params).toEqual({ ratio: 0.25 })
  expect(Object.isFrozen(second.params)).toBe(true)
})

it('rejects unavailable capabilities and invalid parameters before any execution', () => {
  const registry = new CapabilityRegistry([heal])
  expect(() => registry.compileAction(heal.id, {}, [])).toThrow('CAPABILITY_MISMATCH')
  expect(() => registry.compileAction('unknown', {}, ['ownerPet'])).toThrow('UNKNOWN_CAPABILITY')
  expect(() => registry.compileAction(heal.id, { ratio: 2 }, ['ownerPet'])).toThrow('Invalid content parameters')
  expect(() => registry.compileAction(heal.id, { extra: 1 }, ['ownerPet'])).toThrow('Invalid content parameters')
  expect(() => new CapabilityRegistry([heal, heal])).toThrow('Duplicate')
  const descriptions = registry.describeActions()
  expect(descriptions[0].needs).toEqual(['ownerPet'])
  expect(Object.isFrozen(descriptions[0].params.properties.ratio)).toBe(true)
  const typed = heal.compile({ ratio: 0 }, ['ownerPet'])
  const ratio: number = typed.params.ratio
  expect(ratio).toBe(0)
})

function inferenceContract() {
  return defineAction({
    id: 'type-test',
    params: Type.Object({}, { additionalProperties: false }),
    needs: ['ownerPet'],
    execute(ctx, params) {
      // @ts-expect-error The implementation did not declare skillTarget.
      void ctx.skillTarget
      // @ts-expect-error The schema does not declare a ratio.
      void params.ratio
    },
  })
}
void inferenceContract

it('snapshots the trusted definition and fails missing runtime guarantees before invoking actions', () => {
  const { battle, a } = makeScenario()
  battles.push(battle)
  const params = Type.Object({ amount: Type.Number({ default: 1 }) }, { additionalProperties: false })
  const needs: ['ownerPet'] = ['ownerPet']
  let calls = 0
  const definition = {
    id: 'snapshot',
    params,
    needs,
    execute() {
      calls++
    },
  }
  const action = defineAction(definition)
  params.properties.amount.default = 10
  needs.pop()
  definition.execute = () => {
    throw new Error('mutated caller')
  }
  const registry = new CapabilityRegistry([action])
  expect(() => new CapabilityRegistry([{ ...action, needs: [] }])).toThrow('defineAction')
  const compiled = registry.compileAction('snapshot', {}, ['ownerPet'])
  const effect = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
  expect(() => compiled.run({ effect, capabilities: {} })).toThrow('Missing runtime capability')
  expect(calls).toBe(0)
  compiled.run({ effect, capabilities: { ownerPet: a.activePet } })
  expect(calls).toBe(1)
  expect(compiled.params).toEqual({ amount: 1 })
  expect(registry.describeActions()[0].params.properties.amount.default).toBe(1)
})
