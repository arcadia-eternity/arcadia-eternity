import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { Type } from '@sinclair/typebox'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  AddMarkContext,
  effectAuthoring,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  RemoveMarkContext,
  defineParameter,
  ParameterCatalog,
  parameterAddress,
  ConfigModifierType,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createStackTriggerProbability } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_mark_increase_skill_trigger_rate_with_stack'
const definition = (
  parse(readFileSync(new URL('./fixtures/effect-regression/effect_mark.yaml', import.meta.url), 'utf8'), {
    merge: true,
  }) as { id: string }[]
).find(d => d.id === id)!
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const parameter = (tagged = true) =>
  defineParameter({
    address: parameterAddress('stack-test', 'use', 'chance'),
    schema: Type.Number(),
    effectiveSchema: Type.Number(),
    value: 40,
    operations: [ConfigModifierType.delta],
    aliases: ['old.chance'],
    tags: tagged ? ['skill_effect_probability'] : [],
  })
function setup(native: boolean) {
  const f = makeScenario(791)
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const effect = native ? createStackTriggerProbability()[id] : EffectParser.parse(definition)
  const source = new BaseMark('fixture/stack-probability' as baseMarkId, [effect], {
    ...f.debuff.config,
    maxStacks: 100,
    persistent: true,
    keepOnSwitchOut: true,
    duration: -1,
  }).createInstance()
  source.setOwner(f.a.activePet, f.battle.emitter)
  source.stack = 3
  f.a.activePet.marks.push(source)
  return { ...f, source, effect }
}
const variants = ['normal', 'repeat', 'late-registration', 'no-tags', 'suppress', 'destroy', 'switch'] as const
function run(native: boolean, variant: (typeof variants)[number]) {
  const f = setup(native),
    { battle, a, b, source } = f
  const params = new ParameterCatalog([parameter(variant !== 'no-tags')])
  if (variant !== 'late-registration') params.install(battle.configSystem)
  battle.applyEffects(
    new AddMarkContext(
      new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source),
      source.owner!,
      source.base,
    ),
    EffectTrigger.OnMarkCreated,
    source,
  )
  if (variant === 'repeat')
    battle.applyEffects(
      new AddMarkContext(
        new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source),
        source.owner!,
        source.base,
      ),
      EffectTrigger.OnMarkCreated,
      source,
    )
  if (variant === 'late-registration') params.install(battle.configSystem)
  const read = () =>
    [a.team[0], a.team[0].skills[0], a.team[1], b.activePet].map(scope =>
      params.read(battle.configSystem, 'old.chance', scope),
    )
  const before = read()
  source.stack = 7
  const stacked = read()
  if (variant === 'suppress') source.isSuppressed = true
  if (variant === 'switch') a.activePet = a.team[1]
  if (variant === 'destroy')
    battle.removeMark(
      new RemoveMarkContext(
        new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.team[0].skills[0]),
        source,
      ),
    )
  const after = read()
  source.isSuppressed = false
  const recovered = read()
  return { before, stacked, after, recovered, next: battle.random() }
}
for (const variant of variants)
  it(`follows source stacks: ${variant}`, () => {
    const actual = run(true, variant)
    expect(actual).toEqual(run(false, variant))
    const count = ['no-tags', 'late-registration'].includes(variant) ? 0 : variant === 'repeat' ? 2 : 1
    expect(actual.before).toEqual([40 + count * 3, 40 + count * 3, 40, 40])
    expect(actual.stacked).toEqual([40 + count * 7, 40 + count * 7, 40, 40])
    expect(actual.after).toEqual(['suppress', 'destroy'].includes(variant) ? [40, 40, 40, 40] : actual.stacked)
    if (variant === 'suppress') expect(actual.recovered).toEqual(actual.stacked)
  })
it('restores a live plan using fresh code identities and disposes it with its source', async () => {
  const f = setup(true),
    { battle, source, effect } = f
  const params = new ParameterCatalog([parameter()])
  params.install(battle.configSystem)
  battle.applyEffects(
    new AddMarkContext(
      new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source),
      source.owner!,
      source.base,
    ),
    EffectTrigger.OnMarkCreated,
    source,
  )
  function catalog(fixture = makeScenario(792), authored = createStackTriggerProbability()[id]) {
    if (!battles.includes(fixture.battle)) battles.push(fixture.battle)
    const catalog = new SnapshotCatalog('stack-probability/1')
    for (const pet of [...fixture.a.team, ...fixture.b.team])
      for (const skill of pet.skills)
        for (const effect of [...skill.base.effects, ...skill.effects]) catalog.registerEffect(effect.id, effect)
    for (const effect of fixture.debuff.effects) catalog.registerEffect(effect.id, effect)
    return effectAuthoring.registerEffect(catalog, authored)
  }
  const ready = new Promise<void>(resolve =>
    battle.registerListener(m => {
      if (m.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const running = battle.startBattle().catch(() => {})
  await ready
  const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog(f, effect))))
  await battle.cleanup()
  await running
  const tampered = structuredClone(saved)
  const targetNode = tampered.nodes.find(
    (node: { fields: Record<string, unknown> }) => node.fields.parameter === parameter().address,
  )
  expect(targetNode).toBeDefined()
  targetNode.fields.parameter = 'foreign-parameter'
  expect(() => restoreBattle(tampered, catalog())).toThrow('Invalid bound parameter ownership')
  const restored = restoreBattle(saved, catalog())
  battles.push(restored)
  const pet = restored.playerA.activePet,
    mark = pet.marks.find(m => m.baseId === source.baseId)!
  expect(params.read(restored.configSystem, 'old.chance', pet.skills[0])).toBe(43)
  mark.stack = 9
  expect(params.read(restored.configSystem, 'old.chance', pet.skills[0])).toBe(49)
  const modifier = [...restored.configSystem.exportSnapshotState().scopedModifiers.values()][0].values().next()
    .value![0]
  restored.removeMark(
    new RemoveMarkContext(new EffectContext(new TurnContext(restored), EffectTrigger.TurnEnd, pet.skills[0]), mark),
  )
  expect(params.read(restored.configSystem, 'old.chance', pet.skills[0])).toBe(40)
  expect(modifier.value.isComplete).toBe(true)
})

for (const selection of ['capture', 'follow'] as const)
  for (const attribute of ['capture', 'follow'] as const)
    it(`parameter binding uses ${selection} selection / ${attribute} attribute`, () => {
      const f = setup(true),
        { battle, a, b, source } = f
      const { targets, ops, compileEffect, defineEffect } = effectAuthoring
      const first = b.activePet,
        second = b.team[1]
      first.attributeSystem.updateBaseValue('def', 10)
      second.attributeSystem.updateBaseValue('def', 20)
      const selected =
        selection === 'capture'
          ? targets.opponentActive.first().capture({ key: 'target', scope: 'binding' })
          : targets.opponentActive.first().follow({ key: 'target' })
      const value =
        attribute === 'capture'
          ? selected.attribute('def').capture({ key: 'def', scope: 'input' })
          : selected.attribute('def').follow({ key: 'def' })
      const effect = compileEffect(
        defineEffect({
          id: 'fixture/parameter-binding-timing',
          triggers: [EffectTrigger.OnMarkCreated],
          apply: targets.ownerPet.apply(
            ops.bindTaggedParameter({ key: 'def-bonus', tag: 'skill_effect_probability', operation: 'delta', value }),
          ),
        }),
      )
      source.effects.splice(0, source.effects.length, effect)
      const params = new ParameterCatalog([parameter()])
      params.install(battle.configSystem)
      battle.applyEffects(
        new AddMarkContext(
          new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source),
          a.activePet,
          source.base,
        ),
        EffectTrigger.OnMarkCreated,
        source,
      )
      const read = () => params.read(battle.configSystem, 'old.chance', a.activePet.skills[0])
      expect(read()).toBe(50)
      first.attributeSystem.updateBaseValue('def', 15)
      expect(read()).toBe(attribute === 'follow' ? 55 : 50)
      b.activePet = second
      expect(read()).toBe(selection === 'follow' ? 60 : attribute === 'follow' ? 55 : 50)
      second.attributeSystem.updateBaseValue('def', 25)
      expect(read()).toBe(
        selection === 'follow' ? (attribute === 'follow' ? 65 : 60) : attribute === 'follow' ? 55 : 50,
      )
    })

it('rejects a parameter plan that follows its own destination', () => {
  const { battle, source, a } = setup(true)
  const { compileEffect, defineEffect, targets, ops, numberParam } = effectAuthoring
  const amount = numberParam({ default: 10, tags: ['self-dependent'] })
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/self-dependent',
      triggers: [EffectTrigger.TurnEnd],
      parameters: { amount },
      apply: targets.ownerPet.apply(
        ops.bindTaggedParameter({
          key: 'cycle',
          tag: 'self-dependent',
          operation: 'delta',
          value: amount.follow({ key: 'amount' }),
        }),
      ),
    }),
  )
  const catalog = effectAuthoring.effectParameters(effect)
  catalog.install(battle.configSystem)
  expect(() =>
    battle.executionBudget.run(0, () =>
      effect.innerApply(new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source, effect)),
    ),
  ).toThrow('Circular parameter binding')
  expect(battle.configSystem.get(parameterAddress(effect.id, 'parameters', 'amount'), a.activePet)).toBe(10)
  expect(battle.configSystem.exportSnapshotState().scopedModifiers.size).toBe(0)
})

it('installs through the real mark creation phase', () => {
  const { battle, a, source } = setup(true)
  a.activePet.marks.splice(0)
  const params = new ParameterCatalog([parameter()])
  params.install(battle.configSystem)
  const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, a.activePet.skills[0])
  battle.addMark(new AddMarkContext(context, a.activePet, source.base, 5))
  const created = a.activePet.marks.find(m => m.baseId === source.baseId)!
  expect(created).toBeDefined()
  expect(params.read(battle.configSystem, 'old.chance', a.activePet.skills[0])).toBe(45)
  created.stack = 11
  expect(params.read(battle.configSystem, 'old.chance', a.activePet.skills[0])).toBe(51)
})

it('detaches a non-finite contribution and recovers when its input becomes valid', () => {
  const { battle, a, source } = setup(true)
  const { compileEffect, defineEffect, targets, ops } = effectAuthoring
  const value = targets.sourceMark
    .first()
    .capture({ key: 'mark', scope: 'binding' })
    .attribute('stack')
    .follow({ key: 'stack' })
    .map(stack => (stack > 5 ? NaN : stack))
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/recovering-parameter',
      triggers: [EffectTrigger.TurnEnd],
      apply: targets.ownerPet.apply(
        ops.bindTaggedParameter({ key: 'bonus', tag: 'skill_effect_probability', operation: 'delta', value }),
      ),
    }),
  )
  const params = new ParameterCatalog([parameter()])
  params.install(battle.configSystem)
  battle.executionBudget.run(0, () =>
    effect.innerApply(new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source, effect)),
  )
  const read = () => params.read(battle.configSystem, 'old.chance', a.activePet.skills[0])
  expect(read()).toBe(43)
  source.stack = 6
  expect(read()).toBe(40)
  source.stack = 4
  expect(read()).toBe(44)
})

it('rejects a cycle through another bound parameter', () => {
  const { battle, a, source } = setup(true)
  const { compileEffect, defineEffect, targets, ops, selectFrom } = effectAuthoring
  battle.configSystem.registerTaggedConfig('cycle-a', 10, ['tag-a'])
  battle.configSystem.registerTaggedConfig('cycle-b', 20, ['tag-b'])
  const make = (tag: string, read: string) =>
    compileEffect(
      defineEffect({
        id: `fixture/${tag}`,
        triggers: [EffectTrigger.TurnEnd],
        apply: targets.ownerPet.apply(
          ops.bindTaggedParameter({
            key: 'dependent',
            tag,
            operation: 'delta',
            value: selectFrom([0])
              .select(() => Number(battle.configSystem.get(read, a.activePet)))
              .first()
              .follow({ key: 'read' }),
          }),
        ),
      }),
    )
  const install = (effect: ReturnType<typeof make>) =>
    battle.executionBudget.run(0, () =>
      effect.innerApply(new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source, effect)),
    )
  install(make('tag-a', 'cycle-b'))
  expect(battle.configSystem.get('cycle-a', a.activePet)).toBe(30)
  expect(() => install(make('tag-b', 'cycle-a'))).toThrow('Circular parameter binding')
  expect(battle.configSystem.get('cycle-a', a.activePet)).toBe(30)
  expect(battle.configSystem.get('cycle-b', a.activePet)).toBe(20)
})
