import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import {
  BehaviorCompilationError,
  behaviorEffectId,
  parameterAddress,
  createContentCatalog,
  defineNativeBehavior,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { defineEffect, stringParam, targets, ops } from '@arcadia-eternity/battle/v4/authoring'
import {
  officialEffectTemplates,
  officialTemplateDefinitions,
  withOfficialTemplates,
  createOfficialContent,
} from '@arcadia-eternity/data-pack-base/native'
import { SkillSchema } from '../../src/v4/legacy/schema/skill'
import { MarkSchema } from '../../src/v4/legacy/schema/mark'
import { templateData, templateCatalog, templateFixture, useTemplate } from './official-template-fixture'
import { loadBasePrototypeData } from './base-metadata'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

it('exposes all 23 mechanism families as native, serializable templates with unique identities', () => {
  expect(new Set(officialEffectTemplates.map(t => t.family)).size).toBe(23)
  expect(new Set(officialEffectTemplates.map(t => t.id)).size).toBe(officialEffectTemplates.length)
  expect(JSON.parse(JSON.stringify(officialEffectTemplates))).toEqual(officialEffectTemplates)
  expect(officialTemplateDefinitions.every(d => d.implementation.kind === 'native')).toBe(true)
})

it.each(officialEffectTemplates)('assembles $id through the same saved-data catalog', entry => {
  const params = Object.fromEntries(
    Object.entries(entry.definition.parameters).map(([name, p]) => [
      name,
      p.kind === 'string' && p.reference ? (p.reference === 'mark' ? 'ugc/state' : 'ugc/other') : p.default,
    ]),
  )
  const use = { useId: 'tested', definitionId: entry.id, params }
  const data = entry.definition.sourceKind === 'skill' ? templateData([use]) : templateData([], [use])
  const catalog = templateCatalog(data)
  expect(catalog.effects).toHaveLength(1)
  expect(catalog.parametersFor(catalog.effects[0].id)).toBeDefined()
})

it('preserves behavior uses through both authoritative metadata schemas and JSON', () => {
  const data = templateData(
    [useTemplate('apply-mark-on-hit', { mark: 'ugc/state', target: 'opponent' })],
    [useTemplate('mark-attribute-per-stack', { attribute: 'spe', amount: -10 })],
  )
  const saved = {
    ...data,
    marks: data.marks.map(mark => MarkSchema.parse(mark)),
    skills: data.skills.map(skill => SkillSchema.parse(skill)),
  }
  expect(JSON.parse(JSON.stringify(saved))).toMatchObject(data)
  expect(templateCatalog(saved).effects).toHaveLength(2)
})

it.each([
  ['apply-mark-on-hit', { mark: 'missing' }, 'MISSING_REFERENCE'],
  ['apply-mark-on-hit', { mark: 'ugc/skill' }, 'MISSING_REFERENCE'],
  ['apply-mark-on-hit', { mark: 'ugc/state', chance: 101 }, 'INVALID_PARAMETERS'],
  ['apply-mark-on-hit', { mark: 'ugc/state', stacks: 1.5 }, 'INVALID_PARAMETERS'],
  ['heal-fraction', { denominator: 0 }, 'INVALID_PARAMETERS'],
  ['heal-fixed', { amount: Number.NaN }, 'INVALID_PARAMETERS'],
] as const)('rejects invalid %s use before activation', (id, params, code) => {
  try {
    templateCatalog(templateData([useTemplate(id, params)]))
    throw new Error('Expected rejection')
  } catch (error) {
    expect(error).toBeInstanceOf(BehaviorCompilationError)
    expect((error as BehaviorCompilationError).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code, contentId: 'ugc/skill', useId: 'use' })]),
    )
  }
})

it('validates every reference before invoking any native builder', () => {
  const build = vi.fn(({ effectId, params }) => {
    const mark = stringParam({ default: params.mark as string })
    return defineEffect({
      id: effectId,
      on: 'OnHit',
      parameters: { mark },
      execute: targets.ownerPet.apply(ops.heal(1)),
    })
  })
  const native = defineNativeBehavior({
    id: 'test/native',
    sourceKind: 'skill',
    parameters: { mark: { kind: 'string', default: '', reference: 'mark' } },
    build,
  })
  const data = templateData()
  data.skills[0].behaviors = [
    { useId: 'valid', definitionId: 'test/definition', params: { mark: 'ugc/state' } },
    { useId: 'missing', definitionId: 'test/definition', params: { mark: 'missing' } },
  ]
  expect(() =>
    createContentCatalog(
      {
        ...data,
        behaviors: [
          {
            id: 'test/definition',
            formatVersion: 1,
            sourceKind: 'skill',
            parameters: native.parameters,
            implementation: { kind: 'native', exportId: native.id },
          },
        ],
      },
      'test',
      undefined,
      { nativeExports: [native] },
    ),
  ).toThrow(BehaviorCompilationError)
  expect(build).not.toHaveBeenCalled()
})

it('freezes references and structural choices while preserving bounded numeric runtime parameters', () => {
  const f = templateFixture(templateData([useTemplate('apply-mark-on-hit', { mark: 'ugc/state' })]))
  battles.push(f.battle)
  const id = behaviorEffectId({ kind: 'skill', id: 'ugc/skill' }, 'use')
  const catalog = f.catalog.parametersFor(id)!
  expect(() => catalog.set(f.battle.configSystem, parameterAddress(id, 'parameters', 'mark'), 'ugc/source')).toThrow()
  expect(() => catalog.set(f.battle.configSystem, parameterAddress(id, 'parameters', 'target'), 'opponent')).toThrow()
  expect(() => catalog.set(f.battle.configSystem, parameterAddress(id, 'parameters', 'chance'), 101)).toThrow()
  expect(() => catalog.set(f.battle.configSystem, parameterAddress(id, 'parameters', 'chance'), 25)).not.toThrow()
})

it('ordinary content cannot replace installed templates or introduce data rules', () => {
  expect(() => withOfficialTemplates({ ...templateData(), behaviors: [officialTemplateDefinitions[0]] })).toThrow(
    /cannot be replaced/,
  )
  const definition = {
    formatVersion: 1,
    id: 'untrusted/rule',
    sourceKind: 'skill',
    parameters: {},
    implementation: {
      kind: 'rule',
      rule: {
        formatVersion: 1,
        id: 'untrusted/rule',
        parameters: {},
        trigger: { nodeId: 'hit', id: 'core.selfSkillHit' },
        actions: [],
      },
    },
  }
  expect(() => withOfficialTemplates({ ...templateData(), behaviors: [definition] })).toThrow()
})

it('installs templates in the production base-pack factory without altering unused official effects', () => {
  const data = loadBasePrototypeData()
  const original = createOfficialContent(data, 'official/templates')
  expect(original.effects).toHaveLength(1065)
  const extended = createOfficialContent(
    {
      ...data,
      marks: [
        ...data.marks,
        templateData([], [useTemplate('mark-attribute', { attribute: 'spe', amount: 12 })]).marks[1],
      ],
    },
    'official/templates/extended',
  )
  expect(extended.effects).toHaveLength(1066)
})

it.each(['expiry', 'destroy'])('rejects recursive or mutex successors for %s before battle creation', event => {
  for (const reference of ['ugc/source', 'ugc/state']) {
    const data = templateData([], [useTemplate(`apply-mark-on-${event}`, { mark: reference })])
    if (reference === 'ugc/state') Object.assign(data.marks[0].config, { mutexGroup: 'ugc/group' })
    expect(() => templateCatalog(data)).toThrow(/Successor must be a different mark without a mutex group/)
  }
})
