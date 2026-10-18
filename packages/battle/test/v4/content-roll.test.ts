import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  defineAction,
  definePredicate,
  defineTrigger,
  defineNativeEffect,
  CapabilityRegistry,
  compileRule,
  Effect,
  EffectContext,
  EffectTrigger,
  TurnContext,
  setGlobalLogger,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const empty = Type.Object({}, { additionalProperties: false })
function setup(draws: number[] = [0.25]) {
  const events: string[] = []
  let count = 0
  const { battle, a, b } = makeScenario(201, {
    next() {
      events.push('draw')
      return draws[count++] ?? 0.25
    },
    nextInt(min) {
      return min
    },
  })
  battles.push(battle)
  const registry = new CapabilityRegistry(
    [
      defineAction({
        id: 'record',
        needs: [],
        params: Type.Object({ label: Type.String() }, { additionalProperties: false }),
        execute(_ctx, args) {
          events.push(`apply:${args.label}`)
        },
      }),
    ],
    {
      triggers: [
        defineTrigger({
          id: 'turn',
          trigger: EffectTrigger.TurnEnd,
          params: empty,
          provides: { skill: [] },
          resolve() {
            return {}
          },
        }),
      ],
      predicates: [
        definePredicate({
          id: 'check',
          needs: [],
          params: Type.Object({ label: Type.String(), pass: Type.Boolean() }, { additionalProperties: false }),
          test(_ctx, args) {
            events.push(`when:${args.label}`)
            return args.pass
          },
        }),
      ],
    },
  )
  events.length = 0
  return { battle, source: a.activePet.skills[0], otherSource: b.activePet.skills[0], registry, events }
}
function content(id: string, percent?: number, pass = true, priority = 0) {
  return {
    formatVersion: 1,
    id,
    trigger: { nodeId: 'turn', id: 'turn' },
    when: { nodeId: 'condition', id: 'check', params: { label: id, pass } },
    ...(percent === undefined ? {} : { roll: { nodeId: 'chance', percent } }),
    priority,
    actions: [{ stepId: 'action', id: 'record', params: { label: id } }],
  }
}
function compile(input: unknown, registry: CapabilityRegistry) {
  const result = compileRule(input, registry, { contentId: 'test', sourceKind: 'skill' })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}

it.each([
  [undefined, 0, true],
  [0, 1, false],
  [100, 1, true],
  [25, 1, false],
] as const)('uses the explicit roll contract at percent=%s', (percent, draws, applies) => {
  const { battle, source, registry, events } = setup()
  source.effects.push(compile(content('rule', percent), registry).effect)
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source, source)
  expect(events.filter(event => event === 'draw')).toHaveLength(draws)
  expect(events.filter(event => event === 'when:rule')).toHaveLength(1)
  expect(events.includes('apply:rule')).toBe(applies)
})

it('does not draw for a rejected condition and does not reroll failed duplicate candidates', () => {
  const { battle, source, registry, events } = setup([0.75, 0.25])
  source.effects.push(
    compile(content('condition-fails', 100, false), registry).effect,
    compile(content('roll-fails', 50), registry).effect,
  )
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source, source)
  expect(events).toEqual(['when:condition-fails', 'when:roll-fails', 'draw'])
  events.length = 0
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(events).toEqual(['when:condition-fails', 'when:roll-fails', 'draw', 'apply:roll-fails'])
})

it('admits the same definition independently for distinct source instances', () => {
  const { battle, source, otherSource, registry, events } = setup([0.75, 0.25])
  const { effect } = compile(content('shared', 50), registry)
  source.effects.push(effect, effect)
  otherSource.effects.push(effect)
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source, otherSource, source, otherSource)
  expect(events).toEqual(['when:shared', 'draw', 'when:shared', 'draw', 'apply:shared'])
})

it('rolls in collection order before priority sorting and does not refund cancellation', () => {
  const { battle, source, registry, events } = setup()
  const low = compile(content('low', 100, true, 0), registry)
  const high = compile(content('high', 100, true, 10), registry)
  source.effects.push(low.effect, high.effect)
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(events).toEqual(['when:low', 'draw', 'when:high', 'draw', 'apply:high', 'apply:low'])
  source.effects.push(
    defineNativeEffect({
      id: 'cancel' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === high.effect.id,
      apply(ctx) {
        if (ctx.parent instanceof EffectContext) ctx.parent.available = false
      },
    }),
  )
  events.length = 0
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(events).toEqual(['when:low', 'draw', 'when:high', 'draw', 'apply:low'])
})

it('preserves historical condition-before-dedup RNG behavior for legacy Effects', () => {
  const { battle, source, events } = setup([0.25, 0.75])
  source.effects.push(
    new Effect<EffectTrigger>(
      'legacy' as effectId,
      [EffectTrigger.TurnEnd],
      () => {
        events.push('legacy-apply')
      },
      0,
      ctx => ctx.battle.random() > 0.5,
    ),
  )
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source, source)
  expect(events).toEqual(['draw', 'draw', 'legacy-apply'])
})

it('reads a referenced roll threshold during collection and retains its serialized reference', () => {
  const { battle, source, registry, events } = setup()
  const result = compile(
    {
      ...content('dynamic'),
      parameters: { chance: { nodeId: 'chance-param', kind: 'number', value: 100 } },
      roll: { nodeId: 'chance', percent: { parameter: 'chance' } },
    },
    registry,
  )
  result.parameters.install(battle.configSystem)
  const remove = result.parameters.modify(
    battle.configSystem,
    result.parameterDefinitions[0],
    new ConfigModifier(ConfigDurationType.binding, 'chance-zero', 0, ConfigModifierType.override, 0),
    source,
  )
  source.effects.push(result.effect)
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(events).toEqual(['when:dynamic', 'draw'])
  remove()
  events.length = 0
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(events).toEqual(['when:dynamic', 'draw', 'apply:dynamic'])
  const restored = compile(JSON.parse(JSON.stringify(result.rule)), registry)
  expect(restored.rule.roll).toEqual({ nodeId: 'chance', percent: { parameter: 'chance' } })
})
