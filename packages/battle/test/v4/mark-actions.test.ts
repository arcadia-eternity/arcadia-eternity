import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Type, type TObject } from '@sinclair/typebox'
import {
  BaseMark,
  Pet,
  CapabilityRegistry,
  ConfigDurationType,
  ConfigModifier,
  ConfigModifierType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  StackStrategy,
  coreCapabilities,
  defineAddMarkAction,
  defineAction,
  type PublicParameterBindings,
  type ParameterBindingsFor,
  defineMarkInstanceParams,
  defineNativeEffect,
  compileRule,
  parameterAddress,
  setGlobalLogger,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  HealContext,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const example = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/examples/ugc-apply-recovery-mark.json', import.meta.url), 'utf8'),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture(input = example, target: 'ownerPet' | 'skillTarget' = 'ownerPet', effectiveMaximum = 1) {
  const f = makeScenario()
  battles.push(f.battle)
  const mark = new BaseMark('ugc/recovery' as baseMarkId, [], {
    ...f.debuff.config,
    mutexGroup: 'recovery',
    maxStacks: 10,
    stackable: true,
    stackStrategy: StackStrategy.stack,
  })
  const ratio = Type.Number({ minimum: 0, maximum: 1, default: 0.1 })
  const contract = defineMarkInstanceParams(mark, Type.Object({ ratio }, { additionalProperties: false }), {
    ratio: {
      effectiveSchema: Type.Number({ minimum: 0, maximum: effectiveMaximum }),
      operations: [ConfigModifierType.delta, ConfigModifierType.override],
    },
  })
  contract.parameters.install(f.battle.configSystem)
  const action = defineAddMarkAction({ id: 'ugc.recovery.applyToOwner', mark, target })
  const registry = new CapabilityRegistry([...coreCapabilities.actions, action], coreCapabilities)
  const compiled = compileRule(input, registry, { contentId: 'skill', sourceKind: 'skill' })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  compiled.parameters.install(f.battle.configSystem)
  const skill = f.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, compiled.effect)
  const use = new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
  use.actualTarget = f.b.activePet
  return {
    ...f,
    mark,
    contract,
    action,
    registry,
    compiled,
    skill,
    use,
    hit: () => f.battle.applyEffects(use, EffectTrigger.OnHit, skill),
  }
}

it('compiles the saved nested reference example and reads changed parameters at action start', () => {
  const f = fixture()
  const seen: number[] = []
  f.mark.effects.push(
    defineNativeEffect({
      id: 'created-reader' as effectId,
      triggers: [EffectTrigger.OnMarkCreated],
      apply(ctx) {
        if (!('instanceParams' in ctx.source)) throw new Error('Expected mark source')
        seen.push(f.contract.read(ctx.battle.configSystem, ctx.source, 'ratio'))
        expect(f.a.activePet.marks).not.toContain(ctx.source)
      },
    }),
  )
  let remove = () => {}
  f.skill.effects.push(
    defineNativeEffect({
      id: 'change-before-apply' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect === f.compiled.effect,
      apply() {
        remove = f.compiled.parameters.modify(
          f.battle.configSystem,
          parameterAddress(example.id, 'recovery-ratio', 'recovery'),
          new ConfigModifier(ConfigDurationType.binding, 'change-ratio', 0.4, ConfigModifierType.override, 0),
          f.skill,
        )
      },
    }),
  )
  f.hit()
  const mark = f.a.activePet.marks.find(mark => mark.base === f.mark)!
  expect(mark.instanceParams).toEqual({ ratio: 0.4 })
  expect(mark.duration).toBe(2)
  expect(mark.stack).toBe(1)
  expect(seen).toEqual([0.4])
  remove()
  f.battle.applyEffects(f.use, EffectTrigger.SkillUseEnd, f.skill)
  expect(f.contract.read(f.battle.configSystem, mark, 'ratio')).toBe(0.4)
  const again = compileRule(JSON.parse(JSON.stringify(f.compiled.rule)), f.registry, {
    contentId: 'copy',
    sourceKind: 'skill',
  })
  expect(again.ok).toBe(true)
  if (again.ok) expect(again.rule).toEqual(f.compiled.rule)
  expect(f.compiled.rule.actions[0].params).toMatchObject({ instanceParams: { ratio: { parameter: 'recovery' } } })
})

it('keeps same-parameter stacking and rejects changed inputs without deleting mutex peers', () => {
  const f = fixture()
  f.hit()
  const first = f.a.activePet.marks[0]
  f.hit()
  expect(first.stack).toBe(2)
  const peer = new BaseMark('peer' as baseMarkId, [], f.mark.config).createInstance()
  peer.setOwner(f.a.activePet, f.a.activePet.emitter!)
  f.a.activePet.marks.push(peer)
  f.compiled.parameters.modify(
    f.battle.configSystem,
    parameterAddress(example.id, 'recovery-ratio', 'recovery'),
    new ConfigModifier(ConfigDurationType.binding, 'other-value', 0.7, ConfigModifierType.override, 0),
    f.skill,
  )
  const spy = vi.spyOn(f.battle, 'addMark')
  f.hit()
  expect(spy.mock.results[0].value).toBe('parameter-conflict')
  expect(f.a.activePet.marks).toEqual([first, peer])
  expect(first.stack).toBe(2)
  spy.mockRestore()
})

it('uses the current skill target and statically requires a target-guaranteeing trigger', () => {
  const input = structuredClone(example)
  input.trigger.id = 'core.selfSkillHitTarget'
  const f = fixture(input, 'skillTarget')
  f.skill.effects.push(
    defineNativeEffect({
      id: 'redirect-before-action' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect === f.compiled.effect,
      apply() {
        f.use.actualTarget = f.b.team[1]
      },
    }),
  )
  f.hit()
  expect(f.b.activePet.marks).toHaveLength(0)
  expect(f.b.team[1].marks[0].instanceParams).toEqual({ ratio: 0.2 })
  expect(f.a.activePet.marks).toHaveLength(0)
  const invalid = compileRule(example, f.registry, { contentId: 'invalid', sourceKind: 'skill' })
  expect(invalid.ok).toBe(false)
  if (!invalid.ok) expect(invalid.diagnostics[0].code).toBe('CAPABILITY_MISMATCH')
})

it.each([
  { instanceParams: { extra: 1 } },
  { instanceParams: { ratio: 2 } },
  { instanceParams: { ratio: { parameter: 'missing' } } },
  { mark: 'unregistered' },
  { duration: 0 },
  { stack: 1.5 },
])('rejects invalid mark arguments before execution: %j', params => {
  const f = fixture()
  const input = structuredClone(example)
  input.actions[0].params = params
  expect(compileRule(input, f.registry, { contentId: 'invalid', sourceKind: 'skill' }).ok).toBe(false)
  expect(f.a.activePet.marks).toHaveLength(0)
})

it('materializes defaults and preserves zero for nested arguments', () => {
  const input = structuredClone(example)
  input.actions[0].params = { instanceParams: { ratio: 0 } }
  const f = fixture(input)
  f.hit()
  expect(f.a.activePet.marks[0].instanceParams).toEqual({ ratio: 0 })
  const defaults = structuredClone(example)
  defaults.actions[0].params = {}
  const result = compileRule(defaults, f.registry, { contentId: 'defaults', sourceKind: 'skill' })
  expect(result.ok).toBe(true)
  if (result.ok)
    expect(result.rule.actions[0].params).toEqual({
      mark: f.mark.id,
      stack: 1,
      duration: 2,
      instanceParams: { ratio: 0.1 },
    })
})

it.each([0.2, 1.5])('restores a UGC mark with captured ratio %s and executes its later effect', async capturedRatio => {
  const f = fixture(example, 'ownerPet', 2)
  f.compiled.parameters.modify(
    f.battle.configSystem,
    parameterAddress(example.id, 'recovery-ratio', 'recovery'),
    new ConfigModifier(ConfigDurationType.binding, 'saved-runtime', capturedRatio, ConfigModifierType.override, 0),
    f.skill,
  )
  const tick = defineNativeEffect({
    id: 'recovery-tick' as effectId,
    triggers: [EffectTrigger.TurnEnd],
    apply(ctx) {
      const source = ctx.source
      if (!('instanceParams' in source) || !(source.owner instanceof Pet)) return
      const amount = Math.floor(source.owner.stat.maxHp * f.contract.read(ctx.battle.configSystem, source, 'ratio'))
      source.owner.heal(new HealContext(ctx, source, source.owner, amount))
    },
  })
  f.mark.effects.push(tick)
  const catalog = new SnapshotCatalog('ugc-mark/1').registerContent('recovery', f.mark).registerEffect(tick.id, tick)
  for (const pet of [...f.a.team, ...f.b.team])
    for (const skill of pet.skills)
      for (const effect of [...skill.effects, ...skill.base.effects]) catalog.registerEffect(effect.id, effect)
  for (const effect of f.debuff.effects) catalog.registerEffect(effect.id, effect)
  const ready = new Promise<void>(resolve =>
    f.battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = f.battle.startBattle().catch(error => expect(error.message).toBe('Battle cancelled'))
  await ready
  f.hit()
  const data = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog)))
  await f.battle.cleanup()
  await run
  const restored = restoreBattle(data, catalog)
  battles.push(restored)
  const owner = restored.playerA.activePet
  owner.currentHp = 10
  restored.applyEffects(new TurnContext(restored), EffectTrigger.TurnEnd)
  expect(owner.currentHp).toBe(Math.min(owner.stat.maxHp, 10 + Math.floor(owner.stat.maxHp * capturedRatio)))
  expect(owner.marks[0].instanceParams).toEqual({ ratio: capturedRatio })
})

it('captures valid effective values beyond the editor range without widening author input', () => {
  const f = fixture(example, 'ownerPet', 2)
  const address = parameterAddress(example.id, 'recovery-ratio', 'recovery')
  f.compiled.parameters.modify(
    f.battle.configSystem,
    address,
    new ConfigModifier(ConfigDurationType.binding, 'wide-runtime', 1.5, ConfigModifierType.override, 0),
    f.skill,
  )
  f.hit()
  const mark = f.a.activePet.marks[0]
  expect(mark.instanceParams).toEqual({ ratio: 1.5 })
  expect(f.contract.read(f.battle.configSystem, mark, 'ratio')).toBe(1.5)
  expect(() => f.contract.normalize({ ratio: 1.5 })).toThrow()
  const invalid = structuredClone(example)
  invalid.actions[0].params = { instanceParams: { ratio: 1.5 } }
  expect(compileRule(invalid, f.registry, { contentId: 'invalid', sourceKind: 'skill' }).ok).toBe(false)
})

it('shares one Config parameter across nested and top-level action arguments', () => {
  const input = structuredClone(example)
  input.actions.push({ stepId: 'heal', id: 'core.healOwnerByMaxHp', params: { ratio: { parameter: 'recovery' } } })
  const f = fixture(input)
  f.a.activePet.currentHp = 1
  f.compiled.parameters.modify(
    f.battle.configSystem,
    parameterAddress(example.id, 'recovery-ratio', 'recovery'),
    new ConfigModifier(ConfigDurationType.binding, 'shared', 0.4, ConfigModifierType.override, 0),
    f.skill,
  )
  f.hit()
  expect(f.compiled.parameterDefinitions).toHaveLength(2)
  expect(f.a.activePet.marks[0].instanceParams).toEqual({ ratio: 0.4 })
  expect(f.a.activePet.currentHp).toBe(1 + Math.floor(f.a.activePet.stat.maxHp * 0.4))
})

it('preserves absent optional objects and requires an explicit default for missing required objects', () => {
  const value = Type.Number({ default: 0 })
  const nested = Type.Object({ value }, { additionalProperties: false })
  const slot = { effectiveSchema: value, operations: [] }
  const action = defineAction({
    id: 'optional-nested',
    needs: [],
    params: Type.Object({ optional: Type.Optional(nested), required: nested }, { additionalProperties: false }),
    publicParams: { optional: { fields: { value: slot } }, required: { fields: { value: slot } } },
    execute() {},
  })
  expect(action.compile({ required: {} }, []).contentParams).toEqual({ required: { value: 0 } })
  expect(() => action.compile({}, [])).toThrow()
})

it('bounds nested declaration depth and total public slot count before compiling author input', () => {
  const value = Type.Number({ default: 0 })
  const slot = { effectiveSchema: value, operations: [] }
  const make = (depth: number, count: number) => {
    let schema: TObject = Type.Object(Object.fromEntries(Array.from({ length: count }, (_, i) => [`v${i}`, value])), {
      additionalProperties: false,
    })
    let bindings: PublicParameterBindings = Object.fromEntries(Array.from({ length: count }, (_, i) => [`v${i}`, slot]))
    for (let i = 1; i < depth; i++) {
      schema = Type.Object({ child: schema }, { additionalProperties: false })
      bindings = { child: { fields: bindings } }
    }
    return defineAction({
      id: 'bounded-nested',
      needs: [],
      params: schema,
      publicParams: bindings as ParameterBindingsFor<typeof schema>,
      execute() {},
    })
  }
  expect(() => make(8, 1)).not.toThrow()
  expect(() => make(9, 1)).toThrow('depth')
  expect(() => make(1, 128)).not.toThrow()
  expect(() => make(1, 129)).toThrow('count')
})

it('rejects static mark values outside a narrower receiving range without narrowing ordinary actions', () => {
  const f = fixture(example, 'ownerPet', 0.5)
  const input = structuredClone(example)
  input.actions[0].params = { instanceParams: { ratio: 0.8 } }
  expect(compileRule(input, f.registry, { contentId: 'narrow', sourceKind: 'skill' }).ok).toBe(false)
})
