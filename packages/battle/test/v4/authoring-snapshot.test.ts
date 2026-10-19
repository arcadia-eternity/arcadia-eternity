import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  effectAuthoring,
  createOfficialAuthoredEffects,
  defineValue,
  values as planValues,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  AddMarkContext,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  PhaseType,
  PhaseScope,
  SwitchPetPhase,
  parameterAddress,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  BattleMessageType,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const { targets, ops, compileEffect, defineEffect, registerEffect, actions } = effectAuthoring
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
type Mode = 'capture' | 'follow' | 'entry' | 'official' | 'parameter-capture' | 'parameter-follow'
function definition(mode: Mode, custom = false) {
  if (mode === 'parameter-capture' || mode === 'parameter-follow') {
    const amount = effectAuthoring.numberParam({ default: -25, legacyAliases: ['snapshot.amount'] })
    const value =
      mode === 'parameter-capture'
        ? amount.capture({ key: 'amount', scope: 'binding' })
        : amount.follow({ key: 'amount' })
    return compileEffect(
      defineEffect({
        id: 'snapshot/parameter',
        on: 'OnMarkCreated',
        parameters: { amount },
        execute: targets.ownerPet.apply(
          ops.bindAttribute({
            key: 'speed',
            attribute: 'spe',
            operation: 'delta',
            value,
            lifetime: 'sourceMark',
            missing: 'detach',
          }),
        ),
      }),
    )
  }
  if (mode === 'official') return createOfficialAuthoredEffects().effect_mark_reduce_speed_ruodian
  const root = targets.ownerMarks.where(mark => mark.baseId === 'mark_ruodianjihao').first()
  const selected = mode === 'capture' ? root.capture({ key: 'mark', scope: 'binding' }) : root.follow({ key: 'mark' })
  const stack = selected.attribute('stack')
  const value = (
    mode === 'entry' ? stack.capture({ key: 'stack', scope: 'input' }) : stack.follow({ key: 'stack' })
  ).map(n => n * -25)
  const apply = targets.ownerPet.apply(
    ops.bindAttribute({
      key: 'speed',
      attribute: 'spe',
      operation: 'delta',
      value,
      lifetime: 'sourceMark',
      missing: 'detach',
    }),
  )
  return compileEffect(
    defineEffect({
      id: 'snapshot/authored',
      on: 'OnMarkCreated',
      ...(custom ? { bindings: { speed: value } } : {}),
      execute: custom ? ctx => apply(ctx) : actions.sequence(apply),
    }),
  )
}
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  return f
}
function catalog(mode: Mode, custom = false) {
  // Fresh code and content instances: no captured execution frames from the original Battle.
  const f = fixture()
  const result = new SnapshotCatalog(`authoring/${mode}/${custom}`)
  for (const pet of [...f.a.team, ...f.b.team])
    for (const skill of pet.skills) for (const effect of skill.effects) result.registerEffect(effect.id, effect)
  for (const effect of f.debuff.effects) result.registerEffect(effect.id, effect)
  registerEffect(result, definition(mode, custom))
  return result
}
async function checkpoint(mode: Mode, missing = false, custom = false) {
  const f = fixture(),
    pet = f.a.activePet
  const setup = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, pet.skills[0])
  const markBase = new BaseMark('mark_ruodianjihao' as baseMarkId, [], {
    ...f.debuff.config,
    maxStacks: 10,
    stackable: true,
    persistent: true,
    keepOnSwitchOut: true,
  })
  if (!missing) f.battle.addMark(new AddMarkContext(setup, pet, markBase, 2))
  const effect = definition(mode, custom)
  effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
  const sourceBase = new BaseMark('snapshot/source' as baseMarkId, [effect], {
    ...f.debuff.config,
    persistent: true,
    keepOnSwitchOut: true,
  })
  f.battle.addMark(new AddMarkContext(setup, pet, sourceBase, 1))
  const ready = new Promise<void>(resolve =>
    f.battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = f.battle.startBattle().catch(() => {})
  await ready
  pet.attributeSystem.updateBaseValue('spe', 300)
  if (mode === 'parameter-capture' || mode === 'parameter-follow') {
    const source = pet.marks.find(m => m.baseId === 'snapshot/source')!
    f.battle.configSystem.set(parameterAddress(effect.id, 'parameters', 'amount'), -35, source)
    expect(pet.stat.spe).toBe(mode === 'parameter-capture' ? 275 : 265)
  }
  const original = catalog(mode, custom)
  // The export catalog must register the actual live effect identity; use its static plans.
  const exportCatalog = new SnapshotCatalog(original.revision)
  for (const p of [...f.a.team, ...f.b.team])
    for (const skill of p.skills) for (const e of skill.effects) exportCatalog.registerEffect(e.id, e)
  for (const e of f.debuff.effects) exportCatalog.registerEffect(e.id, e)
  registerEffect(exportCatalog, effect)
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, exportCatalog)))
  await f.battle.cleanup()
  await run
  const fresh = catalog(mode, custom)
  const restored = restoreBattle(saved, fresh)
  battles.push(restored)
  return { restored, catalog: fresh, markBase, saved }
}
it.each(['capture', 'follow', 'entry'] as const)(
  'restores %s plans with fresh factories and source identities',
  async mode => {
    const { restored, catalog } = await checkpoint(mode)
    const pet = restored.playerA.activePet
    const mark = pet.marks.find(m => m.baseId === 'mark_ruodianjihao')!
    expect(pet.stat.spe).toBe(250)
    mark.stack = 3
    expect(pet.stat.spe).toBe(mode === 'entry' ? 250 : 225)
    const replacement = mark.base.createInstance({ stack: 1 })
    replacement.setOwner(pet, restored.emitter)
    pet.marks.splice(pet.marks.indexOf(mark), 1, replacement)
    expect(pet.stat.spe).toBe(mode === 'capture' ? 225 : 275)
    // No read between exit and re-entry; hydration must already have connected the listeners.
    pet.marks = pet.marks.filter(m => m !== replacement)
    replacement.stack = 4
    pet.marks.push(replacement)
    expect(pet.stat.spe).toBe(mode === 'capture' ? 225 : 200)
    const again = JSON.parse(JSON.stringify(snapshotBattle(restored, catalog)))
    await restored.cleanup()
    const twice = restoreBattle(again, catalog)
    battles.push(twice)
    expect(twice.playerA.activePet.stat.spe).toBe(mode === 'capture' ? 225 : 200)
    const source = twice.playerA.activePet.marks.find(m => m.baseId === 'snapshot/source')!
    const ctx = new EffectContext(new TurnContext(twice), EffectTrigger.TurnStart, twice.playerA.activePet.skills[0])
    source.consumeStack(ctx, 1)
    expect(twice.playerA.activePet.stat.spe).toBe(300)
  },
)
it('restores an initially absent follow and discovers later membership', async () => {
  const { restored, markBase } = await checkpoint('follow', true)
  const pet = restored.playerA.activePet
  expect(pet.stat.spe).toBe(300)
  const ctx = new EffectContext(new TurnContext(restored), EffectTrigger.TurnStart, pet.skills[0])
  restored.addMark(new AddMarkContext(ctx, pet, markBase, 3))
  expect(pet.stat.spe).toBe(225)
})
it('supports explicit plans inside custom execute callbacks', async () => {
  const { restored } = await checkpoint('follow', false, true)
  expect(restored.playerA.activePet.stat.spe).toBe(250)
})
it('rejects conflicting static binding keys before registering or executing effects', () => {
  const p = targets.ownerPet.first().follow({ key: 'owner' }).attribute('def').follow({ key: 'def' })
  const q = p.map(n => n + 1)
  const apply = (value: typeof p) =>
    targets.ownerPet.apply(
      ops.bindAttribute({
        key: 'duplicate',
        attribute: 'atk',
        operation: 'delta',
        value,
        lifetime: 'sourceMark',
        missing: 'detach',
      }),
    )
  expect(() =>
    compileEffect(
      defineEffect({ id: 'duplicate', on: 'OnMarkCreated', execute: actions.sequence(apply(p), apply(q)) }),
    ),
  ).toThrow('Conflicting authored binding')
})

it('registers effect factories atomically and supports repeated references to the same effect', () => {
  const plan = targets.ownerPet.first().follow({ key: 'owner' }).attribute('def').follow({ key: 'def' })
  const action = (key: string) =>
    targets.ownerPet.apply(
      ops.bindAttribute({
        key,
        attribute: 'atk',
        operation: 'delta',
        value: plan,
        lifetime: 'sourceMark',
        missing: 'detach',
      }),
    )
  const effect = compileEffect(
    defineEffect({ id: 'atomic', on: 'OnMarkCreated', execute: actions.sequence(action('first'), action('second')) }),
  )
  const firstKey = 'authoring/["atomic","first"]'
  const secondKey = 'authoring/["atomic","second"]'
  const failed = new SnapshotCatalog('atomic/1')
  failed.registerValueBinding(defineValue(secondKey, () => planValues.constant(99)))
  expect(() => registerEffect(failed, effect)).toThrow('Duplicate value binding')
  expect(() => failed.effectKey(effect)).toThrow()
  expect(() => failed.assertValueBinding(firstKey)).toThrow()
  const good = new SnapshotCatalog('atomic/1')
  registerEffect(good, effect)
  expect(() => registerEffect(good, effect)).not.toThrow()
  expect(good.effectKey(effect)).toBe('atomic')
  good.assertValueBinding(firstKey)
  good.assertValueBinding(secondKey)
  good.seal()
  expect(() => registerEffect(good, effect)).toThrow()
})
it('rejects export with a missing authored factory', async () => {
  const { restored } = await checkpoint('follow')
  const incomplete = new SnapshotCatalog('authoring/follow/false')
  for (const pet of [...restored.playerA.team, ...restored.playerB.team]) {
    for (const skill of pet.skills) for (const effect of skill.effects) incomplete.registerEffect(effect.id, effect)
    for (const mark of pet.marks) for (const effect of mark.effects) incomplete.registerEffect(effect.id, effect)
  }
  expect(() => snapshotBattle(restored, incomplete)).toThrow('Missing value binding definition')
})

it('rejects a checkpoint that substitutes a different mark as the authored query source', async () => {
  const { restored, saved, catalog } = await checkpoint('follow')
  await restored.cleanup()
  const replacement = saved.nodes.findIndex(
    (node: { kind: string; fields: { base: { ref: number } } }) =>
      node.kind === 'MarkInstanceImpl' && saved.nodes[node.fields.base.ref].fields.id === 'mark_ruodianjihao',
  )
  expect(replacement).toBeGreaterThanOrEqual(0)
  const value = saved.nodes.find(
    (node: { kind: string; fields: { recipe: { ref: number } } }) =>
      node.kind === 'value' && saved.nodes[node.fields.recipe.ref].fields.type === 'bound',
  )
  const recipe = saved.nodes[value.fields.recipe.ref]
  const args = saved.nodes[recipe.fields.args.ref]
  args.fields.source = { ref: replacement }
  expect(() => restoreBattle(saved, catalog)).toThrow('Invalid bound contribution source')
})

it('checkpoints the actual weakness-speed candidate with a fresh compiled catalog', async () => {
  const { restored, catalog } = await checkpoint('official')
  const pet = restored.playerA.activePet
  expect(pet.stat.spe).toBe(250)
  const mark = pet.marks.find(m => m.baseId === 'mark_ruodianjihao')!
  const spd = pet.stat.spd
  mark.stack = 3
  expect(pet.stat.spe).toBe(225)
  expect(pet.stat.spd).toBe(spd)
  const saved = JSON.parse(JSON.stringify(snapshotBattle(restored, catalog)))
  await restored.cleanup()
  const fresh = new SnapshotCatalog(catalog.revision)
  const f = fixture()
  for (const p of [...f.a.team, ...f.b.team])
    for (const skill of p.skills) for (const effect of skill.effects) fresh.registerEffect(effect.id, effect)
  for (const effect of f.debuff.effects) fresh.registerEffect(effect.id, effect)
  registerEffect(fresh, createOfficialAuthoredEffects().effect_mark_reduce_speed_ruodian)
  const twice = restoreBattle(saved, fresh)
  battles.push(twice)
  expect(twice.playerA.activePet.stat.spe).toBe(225)
})

it.each(['parameter-capture', 'parameter-follow'] as const)(
  'restores %s with fresh parameter identities and later scoped changes',
  async mode => {
    const { restored } = await checkpoint(mode)
    const pet = restored.playerA.activePet
    expect(pet.stat.spe).toBe(mode === 'parameter-capture' ? 275 : 265)
    const source = pet.marks.find(m => m.baseId === 'snapshot/source')!
    const effect = source.effects.find(e => e.id === 'snapshot/parameter')!
    const catalog = effectAuthoring.effectParameters(effect)
    const remove = catalog.modify(
      restored.configSystem,
      'snapshot.amount',
      new ConfigModifier(ConfigDurationType.binding, 'amount-change', -50, ConfigModifierType.override, 0),
      source,
    )
    expect(pet.stat.spe).toBe(mode === 'parameter-capture' ? 275 : 250)
    remove()
    expect(pet.stat.spe).toBe(mode === 'parameter-capture' ? 275 : 265)
    const address = parameterAddress(effect.id, 'parameters', 'amount')
    restored.configSystem.set(address, -40, source)
    expect(pet.stat.spe).toBe(mode === 'parameter-capture' ? 275 : 260)
    restored.configSystem.releaseScope(source)
    expect(pet.stat.spe).toBe(275)
    const phase = new SwitchPetPhase(restored, restored.playerB, restored.playerB.team[1], new TurnContext(restored))
    const phaseModifier = new ConfigModifier(
      ConfigDurationType.phaseType,
      'phase-amount',
      -60,
      ConfigModifierType.override,
      0,
    )
    const cleanup = restored.configSystem.addScopedPhaseTypeConfigModifier(
      address,
      phaseModifier,
      { phaseType: PhaseType.Switch, scope: PhaseScope.Any },
      source,
    )
    expect(pet.stat.spe).toBe(275)
    restored.configSystem.pushPhase(phase)
    expect(pet.stat.spe).toBe(mode === 'parameter-capture' ? 275 : 240)
    const removeDuringPhase = restored.configSystem.addScopedPhaseTypeConfigModifier(
      address,
      new ConfigModifier(ConfigDurationType.phaseType, 'during-phase', -70, ConfigModifierType.override, -1),
      { phaseType: PhaseType.Switch, scope: PhaseScope.Current },
      source,
    )
    expect(pet.stat.spe).toBe(mode === 'parameter-capture' ? 275 : 230)
    removeDuringPhase()
    expect(pet.stat.spe).toBe(mode === 'parameter-capture' ? 275 : 240)
    restored.configSystem.popPhase(phase)
    expect(pet.stat.spe).toBe(275)
    cleanup()
  },
)
