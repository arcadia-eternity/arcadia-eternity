import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  defineAction,
  defineNativeEffect,
  definePredicate,
  defineTrigger,
  CapabilityRegistry,
  compileRule,
  EffectTrigger,
  TurnContext,
  Pet,
  BaseMark,
  AddMarkContext,
  EffectContext,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const empty = Type.Object({}, { additionalProperties: false })
const turn = defineTrigger({
  id: 'turn.end',
  trigger: EffectTrigger.TurnEnd,
  params: empty,
  provides: { skill: ['ownerPet'], petMark: ['ownerPet'], battleMark: [] },
  resolve(ctx) {
    return ctx.source.owner instanceof Pet ? { ownerPet: ctx.source.owner } : {}
  },
})
const lowHp = definePredicate({
  id: 'owner.lowHp',
  needs: ['ownerPet'],
  params: Type.Object(
    { ratio: Type.Number({ minimum: 0, maximum: 1, default: 0.5 }) },
    { additionalProperties: false },
  ),
  test(ctx, args) {
    return ctx.ownerPet.currentHp < ctx.ownerPet.stat.maxHp * args.ratio
  },
})
const heal = defineAction({
  id: 'heal',
  needs: ['ownerPet'],
  params: Type.Object(
    { amount: Type.Integer({ minimum: 0, maximum: 100, default: 10 }) },
    { additionalProperties: false },
  ),
  execute(ctx, args) {
    ctx.ops.heal(ctx.ownerPet, args.amount)
  },
})
const registry = new CapabilityRegistry([heal], { triggers: [turn], predicates: [lowHp] })
function rule() {
  return {
    formatVersion: 1,
    id: 'test/skill/rule',
    trigger: { nodeId: 'turn', id: turn.id },
    when: { nodeId: 'condition', id: lowHp.id },
    actions: [
      { stepId: 'first', id: heal.id },
      { stepId: 'second', id: heal.id, params: { amount: 20 } },
    ],
  }
}

it('compiles unknown content into a real ordered conditional effect with normalized defaults', () => {
  const { battle, a } = makeScenario()
  battles.push(battle)
  expect(registry.describeTriggers()[0].provides.battleMark).toEqual([])
  expect(Object.isFrozen(registry.describePredicates()[0].params)).toBe(true)
  const input = rule()
  a.activePet.currentHp = 1
  const result = compileRule(input, registry, { contentId: 'test/skill', sourceKind: 'skill' })
  expect(a.activePet.currentHp).toBe(1)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  expect(result.rule.actions.map(action => action.params)).toEqual([{ amount: 10 }, { amount: 20 }])
  expect(result.rule.when && 'id' in result.rule.when ? result.rule.when.params : undefined).toEqual({ ratio: 0.5 })
  expect(result.rule.priority).toBe(0)
  input.actions[1].params!.amount = 99
  const source = a.activePet.skills[0]
  source.effects.push(result.effect)
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(a.activePet.currentHp).toBe(31)
  a.activePet.currentHp = a.activePet.stat.maxHp - 1
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(a.activePet.currentHp).toBe(a.activePet.stat.maxHp - 1)
})

it('rejects a field mark borrowing ownerPet guarantees and guards incorrect runtime attachment', () => {
  const { battle, a, debuff } = makeScenario()
  battles.push(battle)
  const rejected = compileRule(rule(), registry, { contentId: 'field', sourceKind: 'battleMark' })
  expect(rejected.ok).toBe(false)
  if (rejected.ok) throw new Error('Expected rejection')
  expect(rejected.diagnostics[0]).toMatchObject({ code: 'CAPABILITY_MISMATCH', nodeId: 'condition' })
  const accepted = compileRule(rule(), registry, { contentId: 'pet', sourceKind: 'petMark' })
  if (!accepted.ok) throw new Error(JSON.stringify(accepted.diagnostics))
  const base = new BaseMark('test/wrong-source' as baseMarkId, [accepted.effect], debuff.config)
  const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
  battle.addMark(new AddMarkContext(parent, battle, base))
  a.activePet.currentHp = 1
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, ...battle.marks)
  expect(a.activePet.currentHp).toBe(1)
})

it('reports invalid candidates without publishing partial effects', () => {
  const bad = rule()
  bad.actions[1].stepId = bad.actions[0].stepId
  const duplicate = compileRule(bad, registry, { contentId: 'test', sourceKind: 'skill' })
  expect(duplicate).toMatchObject({ ok: false, diagnostics: [{ code: 'DUPLICATE_ID', nodeId: 'first' }] })
  const unknown = rule()
  unknown.actions[1].id = 'missing'
  expect(compileRule(unknown, registry, { contentId: 'test', sourceKind: 'skill' })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'UNKNOWN_CAPABILITY', nodeId: 'second', field: '/actions/1/id' }],
  })
  const invalid = rule()
  invalid.actions[1].params!.amount = -1
  expect(compileRule(invalid, registry, { contentId: 'test', sourceKind: 'skill' }).ok).toBe(false)
  expect(compileRule({ ...rule(), unknown: true }, registry, { contentId: 'test', sourceKind: 'skill' }).ok).toBe(false)
  const huge = { ...rule(), id: 'a'.repeat(65537) }
  expect(compileRule(huge, registry, { contentId: 'test', sourceKind: 'skill' })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'LIMIT_EXCEEDED' }],
  })
})

it('checks when only during collection and resolves each ordered action after the preceding action', () => {
  const { battle, a, b } = makeScenario()
  battles.push(battle)
  a.activePet.currentHp = 1
  b.activePet.currentHp = 1
  let selected = a.activePet
  let allowed = true
  const events: string[] = []
  const moving = defineTrigger({
    id: 'moving',
    trigger: EffectTrigger.TurnEnd,
    params: empty,
    provides: { skill: ['skillTarget'] },
    resolve() {
      events.push(selected === a.activePet ? 'resolve:a' : 'resolve:b')
      return { skillTarget: selected }
    },
  })
  const condition = definePredicate({
    id: 'allowed',
    params: empty,
    needs: [],
    test() {
      events.push('when')
      return allowed
    },
  })
  const first = defineAction({
    id: 'first',
    params: empty,
    needs: ['skillTarget'],
    execute(ctx) {
      events.push('first')
      ctx.ops.heal(ctx.skillTarget, 10)
      selected = b.activePet
    },
  })
  const second = defineAction({
    id: 'second',
    params: empty,
    needs: ['skillTarget'],
    execute(ctx) {
      events.push('second')
      ctx.ops.heal(ctx.skillTarget, ctx.skillTarget.currentHp)
    },
  })
  const local = new CapabilityRegistry([first, second], { triggers: [moving], predicates: [condition] })
  const result = compileRule(
    {
      formatVersion: 1,
      id: 'ordered',
      trigger: { nodeId: 'trigger', id: 'moving' },
      when: { nodeId: 'when', id: 'allowed' },
      actions: [
        { stepId: 'one', id: 'first' },
        { stepId: 'two', id: 'second' },
      ],
    },
    local,
    { contentId: 'test', sourceKind: 'skill' },
  )
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const source = a.activePet.skills[0]
  source.effects.push(
    result.effect,
    defineNativeEffect({
      id: 'test/change-before-apply' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === result.effect.id,
      apply() {
        events.push('before')
        allowed = false
      },
    }),
  )
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd, source)
  expect(events).toEqual(['resolve:a', 'when', 'before', 'resolve:a', 'first', 'resolve:b', 'second'])
  expect(a.activePet.currentHp).toBe(11)
  expect(b.activePet.currentHp).toBe(2)
})

it('locates structural input errors before direct rule normalization discards node context', () => {
  const candidate = { ...rule(), actions: [{ stepId: 'damage', id: 'core.dealDamage', inputs: { amount: 1 } }] }
  const result = compileRule(candidate, registry, { contentId: 'test/skill', sourceKind: 'skill' })
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [
      {
        code: 'INVALID_PARAMETERS',
        contentId: 'test/skill',
        ruleId: 'test/skill/rule',
        nodeId: 'damage',
        field: '/actions/0/inputs/amount',
      },
    ],
  })
})

it('does not invent a rule identity when the direct input identity is malformed', () => {
  const result = compileRule({ ...rule(), id: 42 }, registry, { contentId: 'test/skill', sourceKind: 'skill' })
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Malformed rule admitted')
  expect(result.diagnostics[0]).toMatchObject({ contentId: 'test/skill', field: '/id' })
  expect(result.diagnostics[0].ruleId).toBeUndefined()
  expect(result.diagnostics[0].nodeId).toBeUndefined()
})

it('does not accept a node identity supplied inside rejected parameter data', () => {
  const candidate = {
    ...rule(),
    actions: [
      {
        stepId: 'legitimate-action',
        id: heal.id,
        params: { extra: { nodeId: 'spoof', execute: () => 1 } },
      },
    ],
  }
  const result = compileRule(candidate, registry, { contentId: 'test/skill', sourceKind: 'skill' })
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [
      {
        ruleId: 'test/skill/rule',
        nodeId: 'legitimate-action',
        field: '/actions/0/params/extra/execute',
      },
    ],
  })
})
