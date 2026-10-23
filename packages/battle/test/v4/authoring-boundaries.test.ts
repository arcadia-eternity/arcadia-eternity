import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  effectAuthoring,
  AddMarkContext,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const { compileEffect, defineEffect, numberParam, booleanParam, targets, ops } = effectAuthoring
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  return f
}
it('snapshots declaration defaults and parameter tables before compilation', () => {
  const f = fixture()
  const numberOptions = { default: 10 },
    booleanOptions = { default: true }
  const params = { amount: numberParam(numberOptions), enabled: booleanParam(booleanOptions) }
  const observed: unknown[] = []
  const definition = defineEffect({
    id: 'parameter-snapshot',
    on: 'TurnStart',
    parameters: params,
    execute(ctx, p) {
      observed.push(ctx.read(p.amount), ctx.read(p.enabled))
    },
  })
  params.amount = numberParam({ default: 50 })
  numberOptions.default = Infinity
  booleanOptions.default = false
  const effect = compileEffect(definition)
  effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
  const source = f.a.activePet.skills[0]
  source.effects.splice(0, source.effects.length, effect)
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnStart, source)
  expect(observed).toEqual([10, true])
})
it.each(['heal', 'stage', 'assign', 'consume', 'add-stacks'] as const)(
  'rejects cross-battle %s without mutating either battle',
  kind => {
    const f = fixture(),
      other = fixture()
    const target = other.a.activePet
    target.currentHp = 10
    const source = f.a.activePet.skills[0]
    const base = new BaseMark('foreign-mark' as baseMarkId, [], { ...other.debuff.config, maxStacks: 3 })
    const setup = new EffectContext(new TurnContext(other.battle), EffectTrigger.TurnStart, target.skills[0])
    other.battle.addMark(new AddMarkContext(setup, target, base, 2))
    const mark = target.marks.find(m => m.base === base)!
    const selected = targets.ownerPet.select(() => target)
    const action =
      kind === 'heal'
        ? selected.apply(ops.heal(5))
        : kind === 'stage'
          ? selected.apply(ops.changeStatStage('def', 1))
          : kind === 'assign'
            ? selected.property('currentHp').apply(ops.assign(5))
            : targets.ownerPet.select(() => mark).apply(kind === 'consume' ? ops.consumeStacks(1) : ops.addStacks(1))
    const effect = compileEffect(defineEffect({ id: 'cross-battle', on: 'TurnStart', execute: action }))
    const context = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, source, effect)
    const before = target.stat.def
    expect(() => f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(context))).toThrow(
      'Cross-battle',
    )
    expect(target.currentHp).toBe(10)
    expect(target.stat.def).toBe(before)
    expect(mark.stack).toBe(2)
  },
)

it('snapshots binding operation and per-step capture options', () => {
  const f = fixture()
  const pet = f.a.activePet
  pet.attributeSystem.updateBaseValue('spe', 300)
  f.b.activePet.attributeSystem.updateBaseValue('def', 40)
  const step: { key: string; scope: 'binding' | 'input' } = { key: 'def', scope: 'input' }
  const plan = targets.opponentActive.first().follow({ key: 'opponent' }).attribute('def').capture(step)
  const options = {
    key: 'speed',
    attribute: 'spe' as const,
    operation: 'delta' as 'delta' | 'override',
    value: plan,
    lifetime: 'sourceMark' as const,
    missing: 'detach' as const,
  }
  const effect = compileEffect(
    defineEffect({
      id: 'binding-options',
      on: 'OnMarkCreated',
      execute: targets.ownerPet.apply(ops.bindAttribute(options)),
    }),
  )
  options.operation = 'override'
  step.scope = 'binding'
  step.key = 'mutated'
  const base = new BaseMark('binding-source' as baseMarkId, [effect], f.debuff.config)
  const context = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, pet.skills[0])
  f.battle.addMark(new AddMarkContext(context, pet, base))
  expect(pet.stat.spe).toBe(340)
  f.b.team[1].attributeSystem.updateBaseValue('def', 80)
  f.b.activePet = f.b.team[1]
  expect(pet.stat.spe).toBe(380)
})
