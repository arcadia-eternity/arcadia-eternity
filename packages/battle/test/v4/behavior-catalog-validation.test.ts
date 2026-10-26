import { expect, it, vi } from 'vitest'
import { Category, Element, type baseSkillId } from '@arcadia-eternity/const'
import { createContentCatalog as assembleCatalog } from '../../src/v4/content/definition-catalog'
import { BehaviorCompilationError, behaviorEffectId, defineNativeBehavior } from '../../src/v4/content/behaviors'
import { defineEffect, numberParam, ops, targets } from '../../src/v4/content/authoring'

function definition() {
  return {
    formatVersion: 1,
    id: 'ugc/heal',
    sourceKind: 'skill',
    parameters: { amount: { kind: 'number', default: 10, minimum: 0, maximum: 100 } },
    implementation: { kind: 'native', exportId: 'trusted/heal' },
  }
}
function createContentCatalog(...args: Parameters<typeof assembleCatalog>) {
  const native = defineNativeBehavior({
    id: 'trusted/heal',
    sourceKind: 'skill',
    parameters: {
      amount: { kind: 'number', default: 10, minimum: 0, maximum: 100 },
    },
    build({ effectId, params }) {
      const amount = numberParam({ default: params.amount as number })
      return defineEffect({
        id: effectId,
        on: 'OnHit',
        parameters: { amount },
        execute: targets.ownerPet.apply(ops.heal(amount)),
      })
    },
  })
  return assembleCatalog(args[0], args[1], args[2], args[3] ?? { nativeExports: [native] })
}
function skill(id = 'ugc/skill', behaviors: unknown = [{ useId: 'first', definitionId: 'ugc/heal', params: {} }]) {
  return { id, element: Element.Normal, category: Category.Status, power: 0, rage: 0, accuracy: 100, behaviors }
}
function data() {
  return { marks: [], skills: [skill()], species: [], behaviors: [definition()] }
}
function expectDiagnostic(run: () => unknown, code: string, contentId: string, field?: string) {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(BehaviorCompilationError)
  expect((caught as BehaviorCompilationError).diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code, contentId, ...(field ? { field } : {}) })]),
  )
}

it('installs both independent uses through the existing content catalog', () => {
  const input = data()
  input.skills[0] = skill('ugc/skill', [
    { useId: 'first', definitionId: 'ugc/heal', params: { amount: 10 } },
    { useId: 'second', definitionId: 'ugc/heal', params: { amount: 20 } },
  ])
  const catalog = createContentCatalog(JSON.parse(JSON.stringify(input)), 'behavior-catalog/test')
  const ids = ['first', 'second'].map(useId => behaviorEffectId({ kind: 'skill', id: 'ugc/skill' }, useId))
  expect(catalog.getSkill('ugc/skill' as baseSkillId).effects.map(effect => effect.id)).toEqual(ids)
  expect(ids.map(id => catalog.parametersFor(id))).not.toContain(undefined)
})

it('rejects duplicate definition and owner-local use identities', () => {
  const duplicateDefinition = data()
  duplicateDefinition.behaviors.push(definition())
  expectDiagnostic(() => createContentCatalog(duplicateDefinition, 'invalid'), 'DUPLICATE_ID', 'ugc/heal', 'id')
  const duplicateUse = data()
  duplicateUse.skills[0] = skill('ugc/skill', [
    { useId: 'same', definitionId: 'ugc/heal' },
    { useId: 'same', definitionId: 'ugc/heal' },
  ])
  expectDiagnostic(
    () => createContentCatalog(duplicateUse, 'invalid'),
    'DUPLICATE_ID',
    'ugc/skill',
    '/behaviors/1/useId',
  )
})

it('rejects unknown definitions and wrong source ownership before activation', () => {
  const unknown = data()
  unknown.skills[0] = skill('ugc/skill', [{ useId: 'first', definitionId: 'missing' }])
  expectDiagnostic(() => createContentCatalog(unknown, 'invalid'), 'MISSING_REFERENCE', 'ugc/skill', 'definitionId')
  const source = data()
  source.behaviors[0].sourceKind = 'petMark'
  expectDiagnostic(() => createContentCatalog(source, 'invalid'), 'CAPABILITY_MISMATCH', 'ugc/skill', 'sourceKind')
})

it.each([null, {}, [{ useId: 'first', definitionId: 'ugc/heal', params: { hidden: 1 } }]])(
  'does not silently strip malformed behavior metadata: %j',
  behaviors => {
    const input = data()
    input.skills[0] = skill('ugc/skill', behaviors)
    expectDiagnostic(() => createContentCatalog(input, 'invalid'), 'INVALID_PARAMETERS', 'ugc/skill')
  },
)

it('rejects references to a use owned by another skill through the legacy effect field', () => {
  const input = data()
  const foreignId = behaviorEffectId({ kind: 'skill', id: 'ugc/skill' }, 'first')
  const foreign = { ...skill('ugc/other', []), effect: [foreignId] }
  input.skills.push(foreign)
  expectDiagnostic(() => createContentCatalog(input, 'invalid'), 'CAPABILITY_MISMATCH', 'ugc/other', 'effect')
})

it.each(['parameters', 'capability'] as const)('rejects invalid %s before calling either trusted factory', invalid => {
  const build = vi.fn(({ effectId, params }) => {
    const amount = numberParam({ default: params.amount as number })
    return defineEffect({
      id: effectId,
      on: 'OnHit',
      parameters: { amount },
      execute: targets.ownerPet.apply(ops.heal(amount)),
    })
  })
  const native = defineNativeBehavior({
    id: 'trusted/heal',
    sourceKind: 'skill',
    parameters: { amount: { kind: 'number', default: 10, minimum: 0, maximum: 100 } },
    build,
  })
  const input = {
    ...data(),
    behaviors: [
      { ...definition(), id: 'ugc/native', implementation: { kind: 'native', exportId: 'trusted/heal' } },
      definition(),
    ],
    skills: [
      skill('ugc/first', [{ useId: 'first', definitionId: 'ugc/native' }]),
      skill('ugc/second', [{ useId: 'bad', definitionId: 'ugc/heal', params: { amount: -1 } }]),
    ],
  }
  if (invalid === 'capability') {
    input.skills[1] = skill('ugc/second', [{ useId: 'bad', definitionId: 'ugc/heal', params: { amount: 10 } }])
    input.behaviors[1].implementation.exportId = 'unknown/export'
  }
  const legacy = vi.fn(() => ({ effects: new Map(), parameters: new Map() }))
  expectDiagnostic(
    () => createContentCatalog(input, 'invalid', legacy, { nativeExports: [native] }),
    invalid === 'parameters' ? 'INVALID_PARAMETERS' : 'MISSING_REFERENCE',
    'ugc/second',
    invalid === 'parameters' ? '/params/amount' : 'implementation.exportId',
  )
  expect(build).not.toHaveBeenCalled()
  expect(legacy).not.toHaveBeenCalled()
})

it('keeps definition identity and field when a bulk catalog contains a malformed native definition', () => {
  const input = data()
  input.behaviors[0].implementation.exportId = ''
  expectDiagnostic(
    () => createContentCatalog(input, 'invalid'),
    'INVALID_PARAMETERS',
    'ugc/heal',
    '/implementation/exportId',
  )
})
