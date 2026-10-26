import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  compileBehaviorUse,
  copyBehaviorDefinition,
  copyBehaviorUse,
  createCoreCapabilityRegistry,
  defineNativeBehavior,
  encapsulateRule,
  expandBehaviorUse,
  normalizeBehaviorDefinitions,
  normalizeBehaviorUses,
  validateBehaviorUse,
  compilePreparedBehaviorUse,
  BehaviorCompilationError,
  setGlobalLogger,
  type Battle,
  type NativeBehaviorBuildContext,
} from '@arcadia-eternity/battle/v4'
import {
  compileEffect,
  conditions,
  defineEffect,
  numberParam,
  stringParam,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const registry = createCoreCapabilityRegistry()
const owner = { kind: 'skill' as const, id: 'fixture/setup' }

function recovery() {
  return {
    formatVersion: 1,
    id: 'ugc/recovery',
    sourceKind: 'skill',
    parameters: { amount: { kind: 'number', default: 5, minimum: 0, maximum: 100 } },
    implementation: {
      kind: 'rule',
      rule: {
        formatVersion: 1,
        id: 'ugc/recovery-rule',
        parameters: { amount: { nodeId: 'amount-value', kind: 'number', value: 5 } },
        trigger: { nodeId: 'hit', id: 'core.selfSkillHit' },
        actions: [{ stepId: 'heal', id: 'core.healOwner', params: { amount: { parameter: 'amount' } } }],
      },
    },
  } as const
}

function apply(fixture: ReturnType<typeof makeScenario>) {
  const skill = fixture.a.activePet.skills[0]
  fixture.battle.applyEffects(
    new UseSkillContext(
      new TurnContext(fixture.battle),
      fixture.a,
      fixture.a.activePet,
      AttackTargetOpinion.opponent,
      skill,
    ),
    EffectTrigger.OnHit,
    skill,
  )
}

it('runs two saved uses of one rule with independent parameters and independent battle state', () => {
  const definition = JSON.parse(JSON.stringify(recovery()))
  const first = compileBehaviorUse(
    definition,
    { useId: 'small', definitionId: definition.id, params: { amount: 10 } },
    { owner, registry },
  )
  const second = compileBehaviorUse(
    definition,
    { useId: 'large', definitionId: definition.id, params: { amount: 20 } },
    { owner, registry },
  )
  if (!first.ok || !second.ok) throw new Error('Expected both behavior uses to compile')
  expect(first.effect.id).not.toBe(second.effect.id)
  const a = makeScenario(241)
  const b = makeScenario(241)
  battles.push(a.battle, b.battle)
  for (const fixture of [a, b]) {
    first.parameters.install(fixture.battle.configSystem)
    second.parameters.install(fixture.battle.configSystem)
    const skill = fixture.a.activePet.skills[0]
    skill.effects.splice(0, skill.effects.length, first.effect, second.effect)
    fixture.a.activePet.currentHp = 1
  }
  apply(a)
  expect(a.a.activePet.currentHp).toBe(31)
  expect(b.a.activePet.currentHp).toBe(1)
  first.parameters.set(a.battle.configSystem, first.parameterAddresses.amount, 15)
  a.a.activePet.currentHp = 1
  apply(a)
  apply(b)
  expect(a.a.activePet.currentHp).toBe(36)
  expect(b.a.activePet.currentHp).toBe(31)
})

function nativeRecovery(legacyAliases?: readonly string[]) {
  return defineNativeBehavior({
    id: 'trusted/recovery',
    sourceKind: 'skill',
    parameters: recovery().parameters,
    build({ effectId, params }) {
      const amount = numberParam({ default: params.amount as number, legacyAliases })
      return defineEffect({
        id: effectId,
        on: 'OnHit',
        parameters: { amount },
        when: conditions.selfUsesSkill,
        execute: targets.ownerPet.apply(ops.heal(amount)),
      })
    },
  })
}

function nativeDefinition() {
  return { ...recovery(), implementation: { kind: 'native', exportId: 'trusted/recovery' } } as const
}

it('rebuilds native parameter readers independently for each saved use', () => {
  const nativeExports = [nativeRecovery()]
  const first = compileBehaviorUse(
    nativeDefinition(),
    { useId: 'small', definitionId: 'ugc/recovery', params: { amount: 10 } },
    { owner, registry, nativeExports },
  )
  const second = compileBehaviorUse(
    nativeDefinition(),
    { useId: 'large', definitionId: 'ugc/recovery', params: { amount: 20 } },
    { owner, registry, nativeExports },
  )
  if (!first.ok || !second.ok) throw new Error('Expected native uses to compile')
  const fixture = makeScenario(242)
  battles.push(fixture.battle)
  first.parameters.install(fixture.battle.configSystem)
  second.parameters.install(fixture.battle.configSystem)
  const skill = fixture.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, first.effect, second.effect)
  fixture.a.activePet.currentHp = 1
  apply(fixture)
  expect(fixture.a.activePet.currentHp).toBe(31)
  first.parameters.set(fixture.battle.configSystem, first.parameterAddresses.amount, 15)
  fixture.a.activePet.currentHp = 1
  apply(fixture)
  expect(fixture.a.activePet.currentHp).toBe(36)
  expect(() => first.parameters.set(fixture.battle.configSystem, first.parameterAddresses.amount, 101)).toThrow()
})

it('does not execute a native use when attached to another skill definition', () => {
  const compiled = compileBehaviorUse(
    nativeDefinition(),
    { useId: 'foreign', definitionId: 'ugc/recovery', params: { amount: 10 } },
    { owner: { kind: 'skill', id: 'ugc/other-skill' }, registry, nativeExports: [nativeRecovery()] },
  )
  if (!compiled.ok) throw new Error('Expected a use bound to the declared owner')
  const fixture = makeScenario(245)
  battles.push(fixture.battle)
  compiled.parameters.install(fixture.battle.configSystem)
  const skill = fixture.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, compiled.effect)
  fixture.a.activePet.currentHp = 1
  apply(fixture)
  expect(fixture.a.activePet.currentHp).toBe(1)
})

it('retains its compiled skill source when the caller changes the source options', () => {
  const fixture = makeScenario(248)
  battles.push(fixture.battle)
  const skill = fixture.a.activePet.skills[0]
  const source = { kind: 'skill' as const, id: skill.baseId as string }
  const effect = compileEffect(
    defineEffect({
      id: 'trusted/fixed-source',
      on: 'OnHit',
      execute: targets.ownerPet.apply(ops.heal(10)),
    }),
    { source },
  )
  source.id = 'ugc/another-skill'
  skill.effects.splice(0, skill.effects.length, effect)
  fixture.a.activePet.currentHp = 1
  apply(fixture)
  expect(fixture.a.activePet.currentHp).toBe(11)
})

it('validates native candidates before invoking their trusted builder', () => {
  let builds = 0
  const native = defineNativeBehavior({
    id: 'trusted/recovery',
    sourceKind: 'skill',
    parameters: recovery().parameters,
    build({ effectId, params }) {
      builds++
      const amount = numberParam({ default: params.amount as number })
      return defineEffect({
        id: effectId,
        on: 'OnHit',
        parameters: { amount },
        execute: targets.ownerPet.apply(ops.heal(amount)),
      })
    },
  })
  const definitions = normalizeBehaviorDefinitions([nativeDefinition()])
  const prepared = validateBehaviorUse(
    definitions,
    { useId: 'small', definitionId: 'ugc/recovery', params: { amount: 10 } },
    { owner, registry, nativeExports: [native] },
  )
  expect(builds).toBe(0)
  expect(compilePreparedBehaviorUse(prepared).ok).toBe(true)
  expect(builds).toBe(1)
  expect(() =>
    validateBehaviorUse(
      definitions,
      { useId: 'invalid', definitionId: 'ugc/recovery', params: { amount: -1 } },
      { owner, registry, nativeExports: [native] },
    ),
  ).toThrow(BehaviorCompilationError)
  expect(builds).toBe(1)
})

it('captures the trusted builder at registration instead of following later configuration edits', () => {
  const input = {
    id: 'trusted/recovery',
    sourceKind: 'skill' as const,
    parameters: recovery().parameters,
    build({ effectId, params }: NativeBehaviorBuildContext) {
      const amount = numberParam({ default: params.amount as number })
      return defineEffect({
        id: effectId,
        on: 'OnHit',
        priority: 3,
        parameters: { amount },
        execute: targets.ownerPet.apply(ops.heal(amount)),
      })
    },
  }
  const native = defineNativeBehavior(input)
  input.build = ({ effectId, params }) => {
    const amount = numberParam({ default: params.amount as number })
    return defineEffect({
      id: effectId,
      on: 'OnHit',
      priority: 99,
      parameters: { amount },
      execute: targets.ownerPet.apply(ops.heal(20)),
    })
  }
  const compiled = compileBehaviorUse(
    nativeDefinition(),
    { useId: 'stable-builder', definitionId: 'ugc/recovery', params: { amount: 10 } },
    { owner, registry, nativeExports: [native] },
  )
  if (!compiled.ok) throw new Error('Expected registered native export to compile')
  expect(compiled.effect.priority).toBe(3)
  const fixture = makeScenario(247)
  battles.push(fixture.battle)
  compiled.parameters.install(fixture.battle.configSystem)
  const skill = fixture.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, compiled.effect)
  fixture.a.activePet.currentHp = 1
  apply(fixture)
  expect(fixture.a.activePet.currentHp).toBe(11)
})

it('keeps a native string selection within its published enum and length contract', () => {
  const parameters = {
    mode: { kind: 'string' as const, default: 'small', enum: ['small', 'large'], maxLength: 5 },
  }
  const native = defineNativeBehavior({
    id: 'trusted/mode',
    sourceKind: 'skill',
    parameters,
    build({ effectId, params }) {
      const mode = stringParam({ default: params.mode as string })
      return defineEffect({
        id: effectId,
        on: 'OnHit',
        parameters: { mode },
        execute: ctx => targets.ownerPet.apply(ops.heal(ctx.read(mode) === 'small' ? 10 : 20))(ctx),
      })
    },
  })
  const definition = {
    formatVersion: 1,
    id: 'ugc/mode',
    sourceKind: 'skill',
    parameters,
    implementation: { kind: 'native', exportId: 'trusted/mode' },
  }
  const use = { useId: 'mode', definitionId: 'ugc/mode' }
  const options = { owner, registry, nativeExports: [native] }
  const compiled = compileBehaviorUse(definition, use, options)
  if (!compiled.ok) throw new Error('Expected native enum parameter to compile')
  const fixture = makeScenario(244)
  battles.push(fixture.battle)
  compiled.parameters.install(fixture.battle.configSystem)
  const skill = fixture.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, compiled.effect)
  fixture.a.activePet.currentHp = 1
  apply(fixture)
  expect(fixture.a.activePet.currentHp).toBe(11)
  compiled.parameters.set(fixture.battle.configSystem, compiled.parameterAddresses.mode, 'large')
  fixture.a.activePet.currentHp = 1
  apply(fixture)
  expect(fixture.a.activePet.currentHp).toBe(21)
  expect(compileBehaviorUse(definition, { ...use, params: { mode: 'huge' } }, options).ok).toBe(false)
  expect(() => compiled.parameters.set(fixture.battle.configSystem, compiled.parameterAddresses.mode, 'huge')).toThrow()
  expect(() =>
    normalizeBehaviorDefinitions([{ ...definition, parameters: { mode: { ...parameters.mode, maxLength: 4 } } }]),
  ).toThrow(BehaviorCompilationError)
})

it.each([
  ['negative', { amount: -1 }, '/params/amount'],
  ['over maximum', { amount: 101 }, '/params/amount'],
  ['wrong type', { amount: 'ten' }, '/params/amount'],
  ['unpublished parameter', { hidden: 10 }, '/params/hidden'],
] as const)('rejects %s with the owner and use location before activation', (_name, params, field) => {
  const result = compileBehaviorUse(
    recovery(),
    { useId: 'invalid', definitionId: 'ugc/recovery', params },
    { owner, registry },
  )
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'INVALID_PARAMETERS', contentId: 'fixture/setup', useId: 'invalid', field }],
  })
  expect(result).not.toHaveProperty('effect')
})

it.each([
  [
    'nested scalar value',
    { useId: 'bad', definitionId: 'ugc/recovery', params: { amount: { value: 10 } } },
    '/behaviors/1/params/amount',
  ],
  ['unknown use field', { useId: 'bad', definitionId: 'ugc/recovery', unknown: true }, '/behaviors/1/unknown'],
  [
    'prototype field',
    JSON.parse('{"useId":"bad","definitionId":"ugc/recovery","params":{"__proto__":{"polluted":true}}}'),
    '/behaviors/1/params/__proto__',
  ],
] as const)('locates a malformed %s in its containing use array', (_name, invalid, field) => {
  const valid = { useId: 'good', definitionId: 'ugc/recovery', params: { amount: 10 } }
  let caught: unknown
  try {
    normalizeBehaviorUses([valid, invalid], owner)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(BehaviorCompilationError)
  expect(caught).toMatchObject({
    diagnostics: [{ code: 'INVALID_PARAMETERS', contentId: owner.id, useId: 'bad', field }],
  })
  expect(Object.prototype).not.toHaveProperty('polluted')
})

it.each([
  { definitionId: 'ugc/recovery', params: { amount: 10 } },
  { useId: '', definitionId: 'ugc/recovery', params: { amount: 10 } },
] as const)('locates a missing or invalid use identity without inventing one: %j', invalid => {
  let caught: unknown
  try {
    normalizeBehaviorUses([{ useId: 'good', definitionId: 'ugc/recovery' }, invalid], owner)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(BehaviorCompilationError)
  expect(caught).toMatchObject({
    diagnostics: [{ code: 'INVALID_PARAMETERS', contentId: owner.id, field: '/behaviors/1/useId' }],
  })
  if (caught instanceof BehaviorCompilationError) expect(caught.diagnostics[0]).not.toHaveProperty('useId')
})

it('rejects unknown definitions, mismatched sources and unregistered native implementations', () => {
  const use = { useId: 'checked', definitionId: 'ugc/recovery' }
  expect(compileBehaviorUse(recovery(), { ...use, definitionId: 'missing' }, { owner, registry })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'MISSING_REFERENCE', useId: 'checked', field: 'definitionId' }],
  })
  expect(compileBehaviorUse(recovery(), use, { owner: { kind: 'petMark', id: 'ugc/mark' }, registry })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'CAPABILITY_MISMATCH', field: 'sourceKind' }],
  })
  expect(compileBehaviorUse(nativeDefinition(), use, { owner, registry })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'MISSING_REFERENCE', field: 'implementation.exportId' }],
  })
  expect(() => normalizeBehaviorUses([use, use], owner)).toThrow(BehaviorCompilationError)
  expect(() => normalizeBehaviorDefinitions([recovery(), recovery()])).toThrow(BehaviorCompilationError)
})

it('rejects native legacy aliases and attempts to widen the registered public contract', () => {
  const use = { useId: 'checked', definitionId: 'ugc/recovery', params: { amount: 10 } }
  expect(
    compileBehaviorUse(nativeDefinition(), use, {
      owner,
      registry,
      nativeExports: [nativeRecovery(['legacy.amount'])],
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_PARAMETERS' }] })
  const widened = {
    ...nativeDefinition(),
    parameters: { amount: { kind: 'number', default: 5, minimum: 0, maximum: 1000 } },
  }
  expect(compileBehaviorUse(widened, use, { owner, registry, nativeExports: [nativeRecovery()] })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'INVALID_PARAMETERS', field: 'parameters' }],
  })
  const compiledInsteadOfDefinition = defineNativeBehavior({
    id: 'trusted/recovery',
    sourceKind: 'skill',
    parameters: recovery().parameters,
    build: ({ effectId }) =>
      compileEffect(
        defineEffect({ id: effectId, on: 'OnHit', execute: targets.ownerPet.apply(ops.heal(10)) }),
      ) as never,
  })
  expect(
    compileBehaviorUse(nativeDefinition(), use, { owner, registry, nativeExports: [compiledInsteadOfDefinition] }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_PARAMETERS', field: 'implementation' }] })
})

it('keeps shared rule parameters connected while copying uses and expanding an independent rule', () => {
  const original = recovery()
  const rule = {
    ...original.implementation.rule,
    actions: [
      ...original.implementation.rule.actions,
      { ...original.implementation.rule.actions[0], stepId: 'second-heal' },
    ],
  }
  const definition = encapsulateRule(rule, {
    id: 'ugc/composite',
    sourceKind: 'skill',
    parameters: original.parameters,
  })
  const copiedDefinition = copyBehaviorDefinition(definition, 'ugc/copied-composite')
  const use = { useId: 'first', definitionId: definition.id, params: { amount: 10 } }
  const copiedUse = copyBehaviorUse({ ...use, params: { amount: 20 } }, 'second')
  const first = compileBehaviorUse(definition, use, { owner, registry })
  const second = compileBehaviorUse(
    copiedDefinition,
    { ...copiedUse, definitionId: copiedDefinition.id },
    { owner, registry },
  )
  const expanded = expandBehaviorUse(definition, { ...use, params: { amount: 7 } }, 'ugc/expanded', { owner, registry })
  if (!first.ok || !second.ok || !expanded.ok) throw new Error('Expected independent compiled rules')
  const fixture = makeScenario(243)
  battles.push(fixture.battle)
  for (const compiled of [first, second, expanded]) compiled.parameters.install(fixture.battle.configSystem)
  const skill = fixture.a.activePet.skills[0]
  skill.effects.splice(0, skill.effects.length, first.effect, second.effect, expanded.effect)
  fixture.a.activePet.currentHp = 1
  apply(fixture)
  expect(fixture.a.activePet.currentHp).toBe(75) // 10 + 10 + 20 + 20 + 7 + 7
  first.parameters.set(fixture.battle.configSystem, first.parameterAddresses.amount, 15)
  fixture.a.activePet.currentHp = 1
  apply(fixture)
  expect(fixture.a.activePet.currentHp).toBe(85)
  expect(expanded.rule.actions.map(action => action.stepId)).toEqual(['heal', 'second-heal'])
  expect(expanded.rule.actions.map(action => action.params)).toEqual([
    { amount: { parameter: 'amount' } },
    { amount: { parameter: 'amount' } },
  ])
  const saved = JSON.parse(JSON.stringify({ definition: expanded.expandedDefinition, use: expanded.expandedUse }))
  const recompiled = compileBehaviorUse(saved.definition, saved.use, { owner, registry })
  if (!recompiled.ok) throw new Error('Expected saved expansion to compile')
  expect(recompiled.use.params.amount).toBe(7)
  expect(definition.parameters.amount.default).toBe(5)
  expect(expanded.expandedDefinition.parameters.amount.default).toBe(7)
  expect(expanded.expandedUse.useId).toBe(use.useId)
  expect(expanded.expandedDefinition.id).toBe('ugc/expanded')
  const restoredFixture = makeScenario(246)
  battles.push(restoredFixture.battle)
  recompiled.parameters.install(restoredFixture.battle.configSystem)
  const restoredSkill = restoredFixture.a.activePet.skills[0]
  restoredSkill.effects.splice(0, restoredSkill.effects.length, recompiled.effect)
  restoredFixture.a.activePet.currentHp = 1
  apply(restoredFixture)
  expect(restoredFixture.a.activePet.currentHp).toBe(15)
  expect(
    compileBehaviorUse(saved.definition, { ...saved.use, params: { amount: 101 } }, { owner, registry }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'INVALID_PARAMETERS', field: '/params/amount' }] })
  expect(() => copyBehaviorUse(use, 'first')).toThrow(BehaviorCompilationError)
  expect(() => copyBehaviorDefinition(definition, definition.id)).toThrow(BehaviorCompilationError)
})

it('preserves use identities through serialization and action reordering, and refuses native expansion', () => {
  const definition = recovery()
  const use = { useId: 'stable', definitionId: definition.id, params: { amount: 10 } }
  const before = compileBehaviorUse(definition, use, { owner, registry })
  const saved = JSON.parse(JSON.stringify(definition))
  saved.implementation.rule.actions.push({ ...saved.implementation.rule.actions[0], stepId: 'second-heal' })
  saved.implementation.rule.actions.reverse()
  const after = compileBehaviorUse(saved, JSON.parse(JSON.stringify(use)), { owner, registry })
  if (!before.ok || !after.ok) throw new Error('Expected stable compilation')
  expect(after.effect.id).toBe(before.effect.id)
  expect(after.parameterAddresses).toEqual(before.parameterAddresses)
  expect(after.rule?.actions.map(action => action.stepId)).toEqual(['second-heal', 'heal'])
  expect(expandBehaviorUse(definition, use, definition.id, { owner, registry })).toMatchObject({
    ok: false,
    diagnostics: [{ code: 'DUPLICATE_ID' }],
  })
  expect(
    expandBehaviorUse(nativeDefinition(), use, 'ugc/no-native-expansion', {
      owner,
      registry,
      nativeExports: [nativeRecovery()],
    }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: 'CAPABILITY_MISMATCH' }] })
})
