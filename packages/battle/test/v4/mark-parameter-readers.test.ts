import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  AddMarkContext,
  BaseMark,
  BattleMessageType,
  CapabilityRegistry,
  ConfigDurationType,
  ConfigModifier,
  ConfigModifierType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  coreCapabilities,
  compileRule,
  defineAddMarkAction,
  defineAction,
  defineMarkInstanceParams,
  defineNativeEffect,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
  type BattleRng,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const tickData = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/examples/ugc-recovery-mark-tick.json', import.meta.url), 'utf8'),
)
const applyData = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/examples/ugc-apply-recovery-mark.json', import.meta.url), 'utf8'),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture(input = tickData, rng?: BattleRng) {
  const f = makeScenario(201, rng)
  battles.push(f.battle)
  const mark = new BaseMark('ugc/recovery' as baseMarkId, [], f.debuff.config)
  const ratio = Type.Number({ minimum: 0, maximum: 1, default: 0.2 })
  const chance = Type.Number({ minimum: 0, maximum: 100, default: 100 })
  const enabled = Type.Boolean({ default: true })
  const operations = [ConfigModifierType.delta, ConfigModifierType.override] as const
  const contract = defineMarkInstanceParams(
    mark,
    Type.Object({ ratio, chance, enabled }, { additionalProperties: false }),
    {
      ratio: { effectiveSchema: ratio, operations },
      chance: { effectiveSchema: chance, operations },
      enabled: { effectiveSchema: enabled, operations: [ConfigModifierType.override] },
    },
  )
  contract.parameters.install(f.battle.configSystem)
  const applyAction = defineAddMarkAction({ id: 'ugc.recovery.applyToOwner', mark, target: 'ownerPet' })
  const registry = new CapabilityRegistry([...coreCapabilities.actions, applyAction], coreCapabilities)
  const compiled = compileRule(input, registry, { contentId: mark.id, sourceKind: 'petMark', sourceMark: mark })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  mark.effects.push(compiled.effect)
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  const add = (ratio = 0.2, target = f.a.activePet) => {
    f.battle.addMark(new AddMarkContext(parent, target, mark, 1, 2, undefined, { ratio }))
    return target.marks.find(candidate => candidate.base === mark)!
  }
  return { ...f, mark, contract, registry, compiled, parent, add }
}

it('reads each source instance live without adding duplicate rule parameter slots', () => {
  const f = fixture()
  const first = f.add(0.2)
  const second = f.add(0.4, f.b.activePet)
  const a = f.a.activePet,
    b = f.b.activePet
  a.currentHp = b.currentHp = 1
  f.contract.parameters.modify(
    f.battle.configSystem,
    f.contract.address('ratio'),
    new ConfigModifier(ConfigDurationType.binding, 'live-ratio', 0.1, ConfigModifierType.override, 0),
    first,
  )
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, first, second)
  expect(a.currentHp).toBe(1 + Math.floor(a.stat.maxHp * 0.1))
  expect(b.currentHp).toBe(1 + Math.floor(b.stat.maxHp * 0.4))
  expect(first.instanceParams?.ratio).toBe(0.2)
  expect(f.compiled.parameterDefinitions).toHaveLength(0)
  const saved = JSON.parse(JSON.stringify(f.compiled.rule))
  expect(saved.sourceMarkId).toBe(f.mark.id)
  expect(compileRule(saved, f.registry, { contentId: 'again', sourceKind: 'petMark', sourceMark: f.mark }).ok).toBe(
    true,
  )
})

it('reads parameters on creation before the source mark is inserted', () => {
  const data = structuredClone(tickData)
  data.trigger.id = 'core.markCreated'
  const f = fixture(data)
  f.a.activePet.currentHp = 1
  const observed: number[] = []
  f.battle.registerListener(message => {
    if (message.type === BattleMessageType.Heal) observed.push(f.a.activePet.marks.length)
  })
  f.add(0.3)
  expect(f.a.activePet.currentHp).toBe(1 + Math.floor(f.a.activePet.stat.maxHp * 0.3))
  expect(observed).toEqual([0])
})

it('keeps collection-time predicate reads separate from action-time instance reads', () => {
  const data = structuredClone(tickData)
  data.when = { nodeId: 'below', id: 'core.ownerHpBelowRatio', params: { ratio: { instanceParameter: 'ratio' } } }
  const f = fixture(data)
  const mark = f.add(0.5)
  const owner = f.a.activePet
  owner.currentHp = Math.floor(owner.stat.maxHp * 0.4)
  const before = owner.currentHp
  let changes = 0
  mark.effects.push(
    defineNativeEffect({
      id: 'change-after-collection' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect === f.compiled.effect,
      apply() {
        changes++
        f.contract.parameters.modify(
          f.battle.configSystem,
          f.contract.address('ratio'),
          new ConfigModifier(ConfigDurationType.binding, 'new-ratio', 0.1, ConfigModifierType.override, 0),
          mark,
        )
      },
    }),
  )
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, mark)
  expect(owner.currentHp).toBe(before + Math.floor(owner.stat.maxHp * 0.1))
  expect(changes).toBe(1)
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, mark)
  expect(changes).toBe(1)
})

it('uses instance-backed probability with one draw for both zero and one hundred', () => {
  let draws = 0
  const data = structuredClone(tickData)
  data.roll = { nodeId: 'roll', percent: { instanceParameter: 'chance' } }
  const f = fixture(data, {
    next() {
      draws++
      return 0.25
    },
    nextInt(min) {
      return min
    },
  })
  const mark = f.add()
  const baseline = draws
  f.a.activePet.currentHp = 1
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, mark)
  expect(draws - baseline).toBe(1)
  const hp = f.a.activePet.currentHp
  f.contract.parameters.modify(
    f.battle.configSystem,
    f.contract.address('chance'),
    new ConfigModifier(ConfigDurationType.binding, 'zero-chance', 0, ConfigModifierType.override, 0),
    mark,
  )
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, mark)
  expect(draws - baseline).toBe(2)
  expect(f.a.activePet.currentHp).toBe(hp)
})

it('does not admit an effect attached to another mark definition', () => {
  const f = fixture()
  const wrongBase = new BaseMark(f.mark.id, [f.compiled.effect], f.mark.config)
  f.battle.addMark(new AddMarkContext(f.parent, f.a.activePet, wrongBase))
  f.a.activePet.currentHp = 1
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, ...f.a.activePet.marks)
  expect(f.a.activePet.currentHp).toBe(1)
})

it.each(['unknown', 'wrong-type', 'both-references', 'missing-binding', 'wrong-binding', 'skill-source'])(
  'rejects invalid instance parameter use: %s',
  kind => {
    const f = fixture()
    const data = structuredClone(tickData)
    if (kind === 'unknown') data.actions[0].params.ratio.instanceParameter = 'missing'
    if (kind === 'wrong-type') data.actions[0].params.ratio.instanceParameter = 'enabled'
    if (kind === 'both-references') data.actions[0].params.ratio.parameter = 'ratio'
    const result = compileRule(data, f.registry, {
      contentId: 'invalid',
      sourceKind: kind === 'skill-source' ? 'skill' : 'petMark',
      sourceMark: kind === 'missing-binding' ? undefined : kind === 'wrong-binding' ? f.debuff : f.mark,
    })
    expect(result.ok).toBe(false)
    if (!result.ok && ['unknown', 'wrong-type', 'both-references'].includes(kind))
      expect(result.diagnostics[0].nodeId).toBe('recover')
  },
)

it('uses a source instance reference inside nested arguments when applying another mark', () => {
  const f = fixture()
  const child = new BaseMark('ugc/child' as baseMarkId, [], f.debuff.config)
  const ratio = Type.Number({ minimum: 0, maximum: 1, default: 0.1 })
  const contract = defineMarkInstanceParams(child, Type.Object({ ratio }, { additionalProperties: false }), {
    ratio: { effectiveSchema: ratio, operations: [ConfigModifierType.override] },
  })
  contract.parameters.install(f.battle.configSystem)
  const registry = new CapabilityRegistry(
    [defineAddMarkAction({ id: 'child.apply', mark: child, target: 'ownerPet' })],
    coreCapabilities,
  )
  const input = {
    ...tickData,
    actions: [
      { stepId: 'child', id: 'child.apply', params: { instanceParams: { ratio: { instanceParameter: 'ratio' } } } },
    ],
  }
  const compiled = compileRule(input, registry, { contentId: f.mark.id, sourceKind: 'petMark', sourceMark: f.mark })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  f.mark.effects.splice(0, f.mark.effects.length, compiled.effect)
  const parent = f.add(0.3)
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, parent)
  const applied = f.a.activePet.marks.find(mark => mark.base === child)!
  expect(applied.instanceParams).toEqual({ ratio: 0.3 })
  f.contract.parameters.modify(
    f.battle.configSystem,
    f.contract.address('ratio'),
    new ConfigModifier(ConfigDurationType.binding, 'parent-change', 0.7, ConfigModifierType.override, 0),
    parent,
  )
  expect(contract.read(f.battle.configSystem, applied, 'ratio')).toBe(0.3)
})

it('runs the saved UGC skill and mark rules after JSON checkpoint restoration', async () => {
  const f = fixture()
  const apply = compileRule(applyData, f.registry, { contentId: 'skill', sourceKind: 'skill' })
  if (!apply.ok) throw new Error(JSON.stringify(apply.diagnostics))
  apply.parameters.install(f.battle.configSystem)
  const skill = f.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, apply.effect)
  const catalog = new SnapshotCatalog('ugc-skill-and-mark/1').registerContent('recovery', f.mark)
  for (const effect of f.mark.effects) catalog.registerEffect(effect.id, effect)
  for (const pet of [...f.a.team, ...f.b.team])
    for (const s of pet.skills)
      for (const effect of [...s.effects, ...s.base.effects]) catalog.registerEffect(effect.id, effect)
  for (const effect of f.debuff.effects) catalog.registerEffect(effect.id, effect)
  const ready = new Promise<void>(resolve =>
    f.battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = f.battle.startBattle().catch(error => expect(error.message).toBe('Battle cancelled'))
  await ready
  const use = new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
  f.battle.applyEffects(use, EffectTrigger.OnHit, skill)
  const data = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog)))
  await f.battle.cleanup()
  await run
  const restored = restoreBattle(data, catalog)
  battles.push(restored)
  const owner = restored.playerA.activePet
  owner.currentHp = 1
  restored.applyEffects(new TurnContext(restored), EffectTrigger.TurnEnd)
  expect(owner.currentHp).toBe(1 + Math.floor(owner.stat.maxHp * 0.2))
  expect(owner.marks[0].instanceParams?.ratio).toBe(0.2)
})

it('validates actual instance values against the receiving effective range, independently of preview defaults', () => {
  const f = makeScenario(202)
  battles.push(f.battle)
  const mark = new BaseMark('ugc/wide-source' as baseMarkId, [], f.debuff.config)
  const source = Type.Number({ minimum: 0, maximum: 5, default: 3 })
  const operations = [ConfigModifierType.override] as const
  const contract = defineMarkInstanceParams(mark, Type.Object({ ratio: source }, { additionalProperties: false }), {
    ratio: { effectiveSchema: source, operations },
  })
  contract.parameters.install(f.battle.configSystem)
  const received: number[] = []
  const action = defineAction({
    id: 'test.receive',
    needs: ['ownerPet'],
    params: Type.Object({ ratio: Type.Number({ minimum: 0, maximum: 1 }) }, { additionalProperties: false }),
    publicParams: { ratio: { effectiveSchema: Type.Number({ minimum: 0, maximum: 2 }), operations } },
    execute: (_context, args) => {
      received.push(args.ratio)
    },
  })
  const registry = new CapabilityRegistry([action], coreCapabilities)
  const input = {
    ...tickData,
    sourceMarkId: mark.id,
    actions: [{ stepId: 'receive', id: action.id, params: { ratio: { instanceParameter: 'ratio' } } }],
  }
  const options = { contentId: mark.id, sourceKind: 'petMark' as const, sourceMark: mark }
  const compiled = compileRule(input, registry, options)
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  mark.effects.push(compiled.effect)
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  f.battle.addMark(new AddMarkContext(parent, f.a.activePet, mark, 1, 2, undefined, { ratio: 1.5 }))
  const instance = f.a.activePet.marks.find(candidate => candidate.base === mark)!
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, instance)
  expect(received).toEqual([1.5])
  for (const value of [2, 3]) {
    contract.parameters.modify(
      f.battle.configSystem,
      contract.address('ratio'),
      new ConfigModifier(ConfigDurationType.binding, `value-${value}`, value, ConfigModifierType.override, -value),
      instance,
    )
    expect(contract.read(f.battle.configSystem, instance, 'ratio')).toBe(value)
    f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, instance)
  }
  expect(received).toEqual([1.5, 2])
  expect(
    compileRule(
      { ...input, actions: [{ stepId: 'literal', id: action.id, params: { ratio: 1.5 } }] },
      registry,
      options,
    ).ok,
  ).toBe(false)
})
