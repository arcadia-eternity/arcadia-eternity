import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  BattleMessageType,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  setGlobalLogger,
  type Battle,
  type BattleMessage,
  type PlayerSelection,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
function prompt(battle: Battle) {
  return new Promise<void>(resolve => {
    const listener = (m: BattleMessage) => {
      if (m.type === BattleMessageType.TurnAction) {
        battle.unregisterListener(listener)
        resolve()
      }
    }
    battle.registerListener(listener)
  })
}
function choose(battle: Battle, player: string): PlayerSelection {
  const action = battle
    .getAvailableSelection(player as Battle['playerA']['id'])
    .find(s =>
      battle.currentTurn === 1 && player === battle.playerA.id ? s.type === 'switch-pet' : s.type === 'use-skill',
    )
  if (!action) throw new Error('No scripted action')
  return action
}
function drive(battle: Battle) {
  battle.registerListener(m => {
    if (m.type === BattleMessageType.TurnAction) {
      for (const p of [battle.playerA, battle.playerB]) battle.setSelection(choose(battle, p.id))
    }
    if (m.type === BattleMessageType.ForcedSwitch)
      for (const id of m.data.player)
        battle.setSelection(battle.getAvailableSelection(id).find(s => s.type === 'switch-pet')!)
    if (m.type === BattleMessageType.FaintSwitch)
      battle.setSelection(battle.getAvailableSelection(m.data.player).find(s => s.type === 'do-nothing')!)
  })
}
it('round trips a real V1 turn checkpoint including partial input and completes identically', async () => {
  const { battle, debuff } = makeScenario()
  battles.push(battle)
  const catalog = new SnapshotCatalog('v1-scenario/1')
  for (const pet of [...battle.playerA.team, ...battle.playerB.team])
    for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
  for (const effect of debuff.effects) catalog.registerEffect(effect.id, effect)
  let ready = prompt(battle)
  const run = battle.startBattle()
  await ready
  ready = prompt(battle)
  battle.setSelection(choose(battle, battle.playerA.id))
  battle.setSelection(choose(battle, battle.playerB.id))
  await ready
  battle.setSelection(choose(battle, battle.playerA.id))
  const data = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  expect(data.format).toBe('arcadia.v1.battle-snapshot')
  expect(battle.playerB.activePet.marks).toHaveLength(1)
  const accepted = { ...battle.playerA.selection }
  const before = battle.getState(undefined, true)
  drive(battle)
  battle.setSelection(choose(battle, battle.playerB.id))
  await run
  const expected = battle.getState(undefined, true)
  await battle.cleanup()
  const restored = restoreBattle(data, catalog)
  battles.push(restored)
  await battle.cleanup() // Idempotent source disposal must not destroy the restored identity.
  expect(restored.getState(undefined, true)).toEqual(before)
  expect(restored.playerA.selection).toEqual(accepted)
  drive(restored)
  const resumed = restored.resumeBattle()
  restored.setSelection(choose(restored, restored.playerB.id))
  await resumed
  expect(restored.getState(undefined, true)).toEqual(expected)
  expect(restored.victor?.id).toBe('A')
  expect(restored.currentTurn).toBe(4)
})

it('preserves live DSL bindings, stat-stage state, scoped config and a second generation save', async () => {
  const { EffectParser } = await import('@arcadia-eternity/battle/v4/legacy')
  const {
    EffectContext,
    EffectTrigger,
    TurnContext,
    StatTypeWithoutHp,
    ConfigModifier,
    ConfigModifierType,
    ConfigDurationType,
  } = await import('@arcadia-eternity/battle/v4')
  const { battle, debuff } = makeScenario()
  battles.push(battle)
  const effect = EffectParser.parse({
    id: 'saved-dynamic',
    trigger: 'TurnStart',
    priority: 0,
    apply: {
      type: 'addDynamicAttributeModifier',
      target: 'self',
      stat: 'atk',
      modifierType: 'override',
      observableValue: {
        base: 'opponent',
        chain: [
          { type: 'selectAttribute$', arg: 'def' },
          { type: 'multiply', arg: 2 },
        ],
      },
    },
  })
  battle.playerA.activePet.skills[0].effects.push(effect)
  const catalog = new SnapshotCatalog('dynamic/1')
  for (const pet of [...battle.playerA.team, ...battle.playerB.team])
    for (const skill of pet.skills) for (const e of skill.effects) catalog.registerEffect(e.id, e)
  for (const e of debuff.effects) catalog.registerEffect(e.id, e)
  const ready = prompt(battle),
    run = battle.startBattle().catch(() => {})
  await ready
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnStart)
  const ctx = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, battle.playerA.activePet.skills[0])
  battle.playerB.activePet.addStatStage(ctx, StatTypeWithoutHp.def, 1)
  battle.configSystem.registerTaggedConfig('persist', 10, ['saved'])
  battle.configSystem.addScopedConfigModifier(
    'persist',
    new ConfigModifier(ConfigDurationType.binding, 'scoped', 7, ConfigModifierType.delta, 0),
    battle.playerA,
  )
  expect(battle.playerA.activePet.stat.atk).toBe(battle.playerB.activePet.stat.def * 2)
  const payload = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  await battle.cleanup()
  await run
  const restored = restoreBattle(payload, catalog)
  battles.push(restored)
  expect(restored.configSystem.get('persist', restored.playerA.activePet)).toBe(17)
  expect(restored.playerB.activePet.marks[0].stack).toBe(1)
  restored.playerB.activePet.attributeSystem.updateBaseValue('def', 77)
  expect(restored.playerA.activePet.stat.atk).toBe(231) // floor((77 * 1.5) * 2)
  const next = JSON.parse(JSON.stringify(snapshotBattle(restored, catalog)))
  await restored.cleanup()
  const twice = restoreBattle(next, catalog)
  battles.push(twice)
  expect(twice.playerA.activePet.stat.atk).toBe(231)
  const remove = new (await import('@arcadia-eternity/battle/v4')).RemoveMarkContext(
    new TurnContext(twice),
    twice.playerB.activePet.marks[0],
  )
  twice.removeMark(remove)
  expect(twice.playerA.activePet.stat.atk).toBe(154)
})

it('rejects unsafe boundaries, missing content, unsupported dynamic functions and malformed references', async () => {
  const { Modifier, DurationType, derived, Signal, AttributeSystem } = await import('@arcadia-eternity/battle/v4')
  const { battle, debuff } = makeScenario()
  battles.push(battle)
  const catalog = new SnapshotCatalog('reject/1')
  expect(() => snapshotBattle(battle, catalog)).toThrow('boundary')
  const ready = prompt(battle),
    run = battle.startBattle().catch(() => {})
  await ready
  expect(() => snapshotBattle(battle, catalog)).toThrow('Unregistered snapshot effect')
  for (const pet of [...battle.playerA.team, ...battle.playerB.team])
    for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
  for (const e of debuff.effects) catalog.registerEffect(e.id, e)
  const input = new Signal(2),
    dynamic = derived(() => input.value * 5)
  const remove = battle.playerA.activePet.attributeSystem.addModifier(
    'atk',
    new Modifier(DurationType.binding, 'unknown-closure', dynamic, 'delta', 0),
  )
  expect(() => snapshotBattle(battle, catalog)).toThrow('snapshot binding')
  remove()
  const data = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  expect(() => restoreBattle(data, new SnapshotCatalog('wrong'))).toThrow('catalog')
  const memory = AttributeSystem.getGlobalMemoryStats()
  expect(() => restoreBattle(data, catalog)).toThrow('already active')
  expect(AttributeSystem.getGlobalMemoryStats()).toEqual(memory)
  const corrupt = JSON.parse(JSON.stringify(data))
  const attribute = corrupt.nodes.find((node: { kind: string }) => node.kind === 'attribute')
  attribute.fields.type = 'UnsupportedAttributeClass'
  expect(() => restoreBattle(corrupt, catalog)).toThrow('attribute system')
  expect(AttributeSystem.getGlobalMemoryStats()).toEqual(memory)
  expect(battle.playerA.activePet.stat.atk).toBe(55)
  data.root = { ref: data.nodes.length + 10 }
  expect(() => restoreBattle(data, catalog)).toThrow('reference')
  await battle.cleanup()
  await run
})

it('retains native form sources and rebuilds cross-target cleanup and reactive clamps', async () => {
  const {
    BaseMark,
    MarkInstanceImpl,
    Modifier,
    DurationType,
    ModifierHelpers,
    Signal,
    projectValue,
    EffectHandlingStrategy,
    RemoveMarkContext,
    TurnContext,
  } = await import('@arcadia-eternity/battle/v4')
  const ability = new BaseMark('save-native' as never, [], {
    ...new BaseMark('default' as never, []).config,
    persistent: false,
    duration: 3,
  })
  const { battle, debuff } = makeScenario(201, undefined, false, ability)
  battles.push(battle)
  const catalog = new SnapshotCatalog('form/1')
  for (const pet of [...battle.playerA.team, ...battle.playerB.team])
    for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
  for (const effect of debuff.effects) catalog.registerEffect(effect.id, effect)
  const ready = prompt(battle),
    run = battle.startBattle().catch(() => {})
  await ready
  const pet = battle.playerA.activePet,
    source = pet.marks[0]
  if (!(source instanceof MarkInstanceImpl)) throw new Error('Expected original native mark implementation')
  const originalDef = battle.playerB.activePet.stat.def
  source.addAttributeModifierCleanup(
    battle.playerB.activePet.attributeSystem.addModifier(
      'def',
      new Modifier(DurationType.binding, 'cross-owner', 9, 'delta', 0, source),
    ),
  )
  const max = projectValue(source.attributeSystem.getAttribute$('stack'), 'multiply', 10)
  const { modifier } = ModifierHelpers.createReactiveClamp('saved-clamp', new Signal(0), max, 0, source)
  source.addAttributeModifierCleanup(pet.attributeSystem.addModifier('atk', modifier))
  source.addAttributeModifierCleanup(pet.attributeSystem.addModifier('atk', modifier)) // Real duplicate registration returns a no-op.
  battle.transformationSystem.applyTransformation(
    pet,
    { ...pet.base, id: 'saved-form' as never, ability: [] },
    'temporary',
    0,
    source,
    undefined,
    EffectHandlingStrategy.Override,
  )
  expect(source.isSuppressed).toBe(true)
  pet.currentHp = 100
  const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  await battle.cleanup()
  await run
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  const restoredPet = restored.playerA.activePet,
    restoredSource = restoredPet.marks[0]
  expect(restoredPet.base.id).toBe('saved-form')
  expect(restoredPet.currentHp).toBe(100)
  expect(restoredSource.isSuppressed).toBe(true)
  restoredSource.isSuppressed = false
  restoredSource.stack = 2
  expect(restoredPet.stat.atk).toBe(20)
  expect(restored.playerB.activePet.stat.def).toBe(originalDef + 9)
  restored.removeMark(new RemoveMarkContext(new TurnContext(restored), restoredSource))
  expect(restored.transformationSystem.getTransformationState(restoredPet).isTransformed).toBe(false)
  expect(restoredPet.base).toBe(restoredPet.originalSpecies)
  expect(restoredPet.currentHp).toBe(100)
  expect(restoredPet.stat.atk).toBe(55)
  expect(restored.playerB.activePet.stat.def).toBe(originalDef)
})

it('settles cancellation and surrender after resuming an incomplete checkpoint', async () => {
  for (const operation of ['cancel', 'surrender'] as const) {
    const fixture = makeScenario(),
      { battle, debuff } = fixture
    battles.push(battle)
    const catalog = new SnapshotCatalog(`resume-${operation}/1`)
    for (const pet of [...battle.playerA.team, ...battle.playerB.team])
      for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
    for (const effect of debuff.effects) catalog.registerEffect(effect.id, effect)
    const ready = prompt(battle),
      original = battle.startBattle().catch(error => {
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBe('Battle cancelled')
      })
    await ready
    const payload = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
    await battle.cleanup()
    await original
    const restored = restoreBattle(payload, catalog)
    battles.push(restored)
    let turns = 0
    restored.registerListener(m => {
      if (m.type === BattleMessageType.TurnStart) turns++
    })
    const resumed = restored.resumeBattle().then(
      () => 'finished',
      error => error.message,
    )
    await Promise.resolve()
    if (operation === 'cancel') await restored.cleanup()
    else restored.abandonPlayer(restored.playerA.id)
    expect(await resumed).toBe(operation === 'cancel' ? 'Battle cancelled' : 'finished')
    expect(turns).toBe(0)
  }
})

it('rebinds the original AI and continues its random decisions after a JSON restore', async () => {
  const fixture = makeScenario(201, undefined, true),
    { battle, debuff } = fixture
  battles.push(battle)
  const catalog = new SnapshotCatalog('ai/1')
  for (const pet of [...battle.playerA.team, ...battle.playerB.team])
    for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
  for (const effect of debuff.effects) catalog.registerEffect(effect.id, effect)
  let ready = prompt(battle)
  const running = battle.startBattle()
  await ready
  expect(battle.playerA.selection).not.toBeNull()
  const payload = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  ready = prompt(battle)
  battle.setSelection(choose(battle, battle.playerB.id))
  await ready
  const nextAi = { ...battle.playerA.selection },
    draw = battle.random()
  battle.abandonPlayer(battle.playerB.id)
  await running
  await battle.cleanup()
  const restored = restoreBattle(payload, catalog)
  battles.push(restored)
  ready = prompt(restored)
  const resumed = restored.resumeBattle()
  restored.setSelection(choose(restored, restored.playerB.id))
  await ready
  expect(restored.playerA.selection).toEqual(nextAi)
  expect(restored.random()).toBe(draw)
  restored.abandonPlayer(restored.playerB.id)
  await resumed
})

it('refuses live phase-bound modifiers and real-time timer state instead of dropping them', async () => {
  const { ConfigModifier, ConfigModifierType, ConfigDurationType, PhaseType, PhaseScope } =
    await import('@arcadia-eternity/battle/v4')
  const { battle, debuff } = makeScenario()
  battles.push(battle)
  const catalog = new SnapshotCatalog('boundary/1')
  for (const pet of [...battle.playerA.team, ...battle.playerB.team])
    for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
  for (const effect of debuff.effects) catalog.registerEffect(effect.id, effect)
  const ready = prompt(battle),
    running = battle.startBattle().catch(error => {
      expect(error.message).toBe('Battle cancelled')
    })
  await ready
  battle.configSystem.registerConfig('phase-live', 10)
  const remove = battle.configSystem.addPhaseTypeConfigModifier(
    'phase-live',
    new ConfigModifier(ConfigDurationType.phaseType, 'next-turn', 5, ConfigModifierType.delta, 0),
    { phaseType: PhaseType.Turn, scope: PhaseScope.Next },
  )
  expect(() => snapshotBattle(battle, catalog)).toThrow('phase-bound')
  remove()
  battle.timerManager.updateConfig({ enabled: true })
  expect(() => snapshotBattle(battle, catalog)).toThrow('real-time')
  battle.timerManager.updateConfig({ enabled: false })
  expect(snapshotBattle(battle, catalog).format).toBe('arcadia.v1.battle-snapshot')
  await battle.cleanup()
  await running
})
