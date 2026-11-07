import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Blob as NodeBlob, Buffer } from 'node:buffer'
import { isProxy, reactive } from 'vue'
import { digestJson, presentationIndex } from '@arcadia-eternity/pack-loader/native'
import {
  MarkSchema,
  PetSchema,
  SkillSchema,
  SpeciesSchema,
  PresentationManifestSchema,
  parseWithErrors,
  type PetSchemaType,
} from '@arcadia-eternity/schema'
import { Nature } from '@arcadia-eternity/const'
import type { SandboxEnvironment } from '@arcadia-eternity/battle/v4/sandbox'
import type { EnvironmentRules, NativeRuntimeIdentity, PersonalEnvironmentReference } from '@arcadia-eternity/protocol'
import {
  createPersonalEnvironmentBundle,
  downloadPersonalEnvironment,
  encodePersonalEnvironmentBundle,
  parsePersonalEnvironmentBundle,
  validatePersonalEnvironmentTeam,
} from '../personalEnvironment'
import { readResourceBytes } from '../resourceTransport'

const OriginalURL = globalThis.URL
const createObjectURL = vi.fn((_blob: Blob) => 'blob:personal-environment/1')
const revokeObjectURL = vi.fn()
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jbmQAAAAASUVORK5CYII='

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('__personalSourceEvaluated', false)
  vi.stubGlobal(
    'URL',
    class extends OriginalURL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function capture(icon?: string) {
  const runtime: NativeRuntimeIdentity = {
    kind: 'native-v4',
    contentRevision: 'personal-content-v1',
    coreBuildId: 'core-v1',
    registryBuildId: 'registry-v1',
  }
  const species = parseWithErrors(SpeciesSchema, {
    id: 'sample:pet',
    ...(icon ? { presentation: { icon } } : {}),
  })
  const content = { species: [species], skills: [], marks: [] }
  const modules: SandboxEnvironment['modules'] = [
    {
      namespace: '',
      role: 'catalog',
      artifact: {
        format: 'arcadia.effect-module',
        version: 1,
        sdkApi: 2,
        packageId: '@arcadia-eternity/data-pack-base',
        source: 'globalThis.__personalSourceEvaluated = true; export function createEffects() { return [] }',
      },
    },
  ]
  const environment: SandboxEnvironment = {
    revision: `${runtime.contentRevision}/effects:${await digestJson(modules)}`,
    data: structuredClone(content),
    modules,
  }
  return {
    runtime,
    environment,
    content,
    packages: [{ name: 'sample', version: '1.0.0', projectId: 'sample-pack', namespace: 'sample' }],
  }
}

async function mediaBundle() {
  return createPersonalEnvironmentBundle({
    ...(await capture('arcadia-resource:pet-icon')),
    assets: [{ id: 'pet-icon', mime: 'image/png', data: png }],
  })
}

it('keeps the built-in Bingchuantun media portable when captured without an installed package', async () => {
  const manifest = parseWithErrors(
    PresentationManifestSchema,
    JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../../packs/base/dist/presentation.json'), 'utf8')),
  )
  const presentations = presentationIndex([manifest])
  for (const key of [
    'species:pet_tuntun',
    'species:pet_binghutun',
    'species:pet_bingchuantun',
    'marks:mark_hanbingjianren',
  ]) {
    const presentation = presentations.get(key)
    expect(presentation, key).toBeDefined()
    const original = await capture(presentation!.icon as string)
    original.content.species[0].presentation = presentation
    original.environment.data = structuredClone(original.content)
    await expect(createPersonalEnvironmentBundle(original), key).resolves.toBeDefined()
  }
})

async function httpsReference(bundle: Awaited<ReturnType<typeof createPersonalEnvironmentBundle>>) {
  const prepared = await parsePersonalEnvironmentBundle(bundle, {
    kind: 'https',
    url: 'https://content.test/recipe.json',
  })
  prepared.release()
  return prepared.reference
}

describe('personal environment files', () => {
  it('round-trips an exact captured recipe and rules without evaluating author code', async () => {
    const original = await capture()
    const rules = { schemaVersion: 1 as const, team: { minSize: 2, maxSize: 4, uniqueSpecies: true } }
    const bundle = await createPersonalEnvironmentBundle(original, rules)
    expect(bundle.format).toBe('arcadia.personal-environment')
    expect(bundle.version).toBe(1)
    expect(bundle.descriptor.executionPolicy).toBe('peer')
    expect(bundle.descriptor.peerRevision).toBe(original.environment.revision)
    expect(bundle.rules).toEqual(rules)
    const text = encodePersonalEnvironmentBundle(bundle)
    expect(typeof text).toBe('string')
    const prepared = await parsePersonalEnvironmentBundle(text, { kind: 'file', name: 'my-challenge.arcadia.json' })

    expect(prepared.environment).toEqual(original.environment)
    expect(prepared.content).toEqual(original.content)
    expect(prepared.reference).toEqual({
      kind: 'personal',
      protocolVersion: 1,
      descriptor: bundle.descriptor,
      rules,
      source: { kind: 'file', name: 'my-challenge.arcadia.json' },
    })
    expect(prepared.acceptance).toMatchObject({
      environmentId: bundle.descriptor.id,
      protocolVersion: 1,
      peerRevision: original.environment.revision,
      resourceRevision: bundle.descriptor.resourceRevision,
      resourcesReady: true,
    })
    expect((globalThis as unknown as Record<string, unknown>).__personalSourceEvaluated).toBe(false)
    prepared.release()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('changes the personal identity when its fixed rules change', async () => {
    const original = await capture()
    const first = await createPersonalEnvironmentBundle(original, { schemaVersion: 1, team: { maxSize: 3 } })
    const same = await createPersonalEnvironmentBundle(original, { schemaVersion: 1, team: { maxSize: 3 } })
    const changed = await createPersonalEnvironmentBundle(original, { schemaVersion: 1, team: { maxSize: 4 } })
    expect(first.descriptor.id).toBe(same.descriptor.id)
    expect(changed.descriptor.id).not.toBe(first.descriptor.id)
    expect(changed.descriptor.peerRevision).toBe(first.descriptor.peerRevision)
  })

  it('rejects a capture containing more than 32 content packages', async () => {
    const original = await capture()
    const packages = Array.from({ length: 33 }, (_, index) => ({
      name: `sample-${index}`,
      version: '1.0.0',
      projectId: `sample-project-${index}`,
      namespace: `sample${index}`,
    }))
    await expect(createPersonalEnvironmentBundle({ ...original, packages })).rejects.toThrow()
  })

  it('resolves explicitly exported local media and releases each blob once', async () => {
    const bundle = await mediaBundle()
    expect(bundle.content.species[0].presentation?.icon).toBe('arcadia-resource:pet-icon')
    const prepared = await parsePersonalEnvironmentBundle(bundle)
    expect(prepared.content.species[0].presentation?.icon).toBe('blob:personal-environment/1')
    expect(prepared.bundle.content.species[0].presentation?.icon).toBe('arcadia-resource:pet-icon')
    expect(createObjectURL).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.calls[0]?.[0] as unknown as Blob
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBeGreaterThan(0)
    expect(bundle.content.species[0].presentation?.icon).toBe('arcadia-resource:pet-icon')
    expect(revokeObjectURL).not.toHaveBeenCalled()
    prepared.release()
    prepared.release()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:personal-environment/1')
  })

  it('reads imported media bytes without a network request and invalidates the address after release', async () => {
    const prepared = await parsePersonalEnvironmentBundle(await mediaBundle())
    const url = prepared.content.species[0].presentation!.icon as string
    const request = vi.fn()

    const bytes = await readResourceBytes(url, {}, request as typeof fetch)
    expect(bytes).toEqual(new Uint8Array(Buffer.from(png, 'base64')))
    expect(request).not.toHaveBeenCalled()

    prepared.release()
    await expect(readResourceBytes(url, {}, request as typeof fetch)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('invalidates registered media when the importing consumer is aborted', async () => {
    const controller = new AbortController()
    const prepared = await parsePersonalEnvironmentBundle(await mediaBundle(), undefined, controller.signal)
    const url = prepared.content.species[0].presentation!.icon as string
    const request = vi.fn()
    expect(await readResourceBytes(url, {}, request as typeof fetch)).toEqual(
      new Uint8Array(Buffer.from(png, 'base64')),
    )

    controller.abort(new Error('selection changed'))
    await expect(readResourceBytes(url, {}, request as typeof fetch)).rejects.toThrow()
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url)
    prepared.release()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['https://media.test/pet.png', 'http://media.test/pet.png'])(
    'keeps approved remote media on demand: %s',
    async icon => {
      const request = vi.fn(() => {
        throw new Error('Media must not be prefetched')
      })
      vi.stubGlobal('fetch', request)
      const bundle = await createPersonalEnvironmentBundle(await capture(icon))
      const prepared = await parsePersonalEnvironmentBundle(bundle)
      expect(prepared.content.species[0].presentation?.icon).toBe(icon)
      expect(request).not.toHaveBeenCalled()
      expect(createObjectURL).not.toHaveBeenCalled()
      prepared.release()
    },
  )

  it.each([
    'arcadia-resource:missing',
    'file:///Users/owner/private.png',
    'javascript:alert(1)',
    'arcadia-content://private-session/asset',
    'blob:some-other-document/asset',
    '../private.png',
    '/local/assets/private.png',
    'https://user:password@media.test/private.png',
  ])('rejects undeclared or local media references: %s', async icon => {
    await expect(createPersonalEnvironmentBundle(await capture(icon))).rejects.toThrow()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it.each([
    ['missing data', { id: 'pet-icon', mime: 'image/png', data: '' }],
    ['invalid base64', { id: 'pet-icon', mime: 'image/png', data: '!!not-base64!!' }],
    ['active content', { id: 'pet-icon', mime: 'text/html', data: btoa('<script>bad()</script>') }],
  ])('rejects an invalid exported asset: %s', async (_reason, asset) => {
    await expect(
      createPersonalEnvironmentBundle({
        ...(await capture('arcadia-resource:pet-icon')),
        assets: [asset],
      }),
    ).rejects.toThrow()
  })

  it('rejects duplicate asset identities', async () => {
    const asset = { id: 'pet-icon', mime: 'image/png', data: png }
    await expect(
      createPersonalEnvironmentBundle({
        ...(await capture('arcadia-resource:pet-icon')),
        assets: [asset, asset],
      }),
    ).rejects.toThrow()
  })

  it('rejects changed module text despite repeated revision and descriptor strings', async () => {
    const bundle = await createPersonalEnvironmentBundle(await capture())
    const tampered = {
      ...bundle,
      environment: {
        ...bundle.environment,
        modules: [
          {
            ...bundle.environment.modules[0],
            artifact: { ...bundle.environment.modules[0].artifact, source: 'export const substituted = true' },
          },
        ],
      },
    }
    await expect(parsePersonalEnvironmentBundle(tampered)).rejects.toThrow()
  })

  it('rejects incompatible module SDK versions even with a matching content identity', async () => {
    const original = await capture()
    const modules = [
      { ...original.environment.modules[0], artifact: { ...original.environment.modules[0].artifact, sdkApi: 999 } },
    ]
    const environment = {
      ...original.environment,
      modules,
      revision: `${original.runtime.contentRevision}/effects:${await digestJson(modules)}`,
    }
    await expect(
      createPersonalEnvironmentBundle({ ...original, environment } as Parameters<
        typeof createPersonalEnvironmentBundle
      >[0]),
    ).rejects.toThrow()
  })

  it('rejects display content altered after export', async () => {
    const bundle = await createPersonalEnvironmentBundle(await capture())
    const tampered = {
      ...bundle,
      content: { ...bundle.content, species: [{ ...bundle.content.species[0], name: 'Changed display' }] },
    }
    await expect(parsePersonalEnvironmentBundle(tampered)).rejects.toThrow()
  })

  it('rejects embedded asset bytes altered after export even when the replacement is valid base64', async () => {
    const bundle = await mediaBundle()
    const tampered = { ...bundle, assets: bundle.assets!.map(asset => ({ ...asset, data: btoa('replacement media') })) }
    await expect(parsePersonalEnvironmentBundle(tampered)).rejects.toThrow()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('rejects a descriptor or rule substitution instead of recalculating its identity', async () => {
    const bundle = await createPersonalEnvironmentBundle(await capture())
    await expect(
      parsePersonalEnvironmentBundle({ ...bundle, descriptor: { ...bundle.descriptor, id: 'f'.repeat(64) } }),
    ).rejects.toThrow()
    await expect(
      parsePersonalEnvironmentBundle({ ...bundle, rules: { schemaVersion: 1, team: { maxSize: 1 } } }),
    ).rejects.toThrow()
  })

  it('does not allocate resources for an already-cancelled import', async () => {
    const bundle = await mediaBundle()
    const controller = new AbortController()
    controller.abort(new Error('selection changed'))
    await expect(parsePersonalEnvironmentBundle(bundle, undefined, controller.signal)).rejects.toThrow(
      'selection changed',
    )
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('releases a blob allocated just before an import is cancelled', async () => {
    const bundle = await mediaBundle()
    const controller = new AbortController()
    createObjectURL.mockImplementationOnce(() => {
      controller.abort(new Error('selection changed'))
      return 'blob:personal-environment/late'
    })
    await expect(parsePersonalEnvironmentBundle(bundle, undefined, controller.signal)).rejects.toThrow(
      'selection changed',
    )
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:personal-environment/late')
  })
})

const stats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
function pet(overrides: Partial<PetSchemaType> = {}): PetSchemaType {
  return parseWithErrors(PetSchema, {
    id: 'a'.repeat(21),
    name: 'Sample',
    species: 'sample:pet',
    level: 50,
    evs: { ...stats, hp: 255, atk: 255 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: Nature.Hardy,
    skills: ['sample:strike'],
    ability: 'sample:ability',
    emblem: 'sample:emblem',
    ...overrides,
  })
}

async function teamEnvironment(rules?: EnvironmentRules) {
  const original = await capture()
  const species = ['sample:pet', 'sample:other'].map(id =>
    parseWithErrors(SpeciesSchema, {
      id,
      learnable_skills: [
        { skill_id: 'sample:strike', level: 1 },
        { skill_id: 'sample:advanced', level: 60 },
      ],
      ability: ['sample:ability'],
      emblem: ['sample:emblem'],
    }),
  )
  const skills = ['sample:strike', 'sample:advanced', 'sample:foreign'].map(id => parseWithErrors(SkillSchema, { id }))
  const marks = ['sample:ability', 'sample:emblem', 'sample:foreign'].map(id => parseWithErrors(MarkSchema, { id }))
  const data = { species, skills, marks }
  const content = {
    species,
    skills: skills.map(({ effect: _effect, ...display }) => display),
    marks: marks.map(mark => ({ id: mark.id, tags: mark.tags ?? [] })),
  }
  const bundle = await createPersonalEnvironmentBundle(
    {
      ...original,
      environment: { ...original.environment, data },
      content,
    },
    rules,
  )
  return parsePersonalEnvironmentBundle(bundle)
}

describe('personal environment team admission', () => {
  it('rejects hidden executable mark data changed without changing the captured identity', async () => {
    const prepared = await teamEnvironment()
    const bundle = prepared.bundle
    const tampered = {
      ...bundle,
      environment: {
        ...bundle.environment,
        data: {
          ...bundle.environment.data,
          marks: bundle.environment.data.marks.map(mark => ({ ...(mark as object), config: { duration: 999 } })),
        },
      },
    }
    await expect(parsePersonalEnvironmentBundle(tampered)).rejects.toThrow()
    prepared.release()
  })

  it('accepts a valid captured team at the EV boundary without mutating it or evaluating effects', async () => {
    const prepared = await teamEnvironment()
    const team = [pet()]
    const before = structuredClone(team)
    const result = validatePersonalEnvironmentTeam(prepared, team)
    expect(result).toEqual(before)
    expect(team).toEqual(before)
    expect(result).not.toBe(team)
    expect((globalThis as unknown as Record<string, unknown>).__personalSourceEvaluated).toBe(false)
    prepared.release()
  })

  it.each([false, true])(
    'normalizes a reactive team with reactive prepared=%s without leaking proxies or mutating either input',
    async reactivePrepared => {
      const prepared = await teamEnvironment()
      const selected = reactivePrepared ? reactive(prepared) : prepared
      const team = reactive([pet()])
      const beforeTeam = JSON.parse(JSON.stringify(team))
      const beforeEnvironment = JSON.parse(JSON.stringify(prepared.environment))
      const beforeReference = JSON.parse(JSON.stringify(prepared.reference))
      expect(isProxy(team)).toBe(true)
      expect(isProxy(team[0].evs)).toBe(true)
      expect(() => structuredClone(team)).toThrow()

      const result = validatePersonalEnvironmentTeam(selected, team)

      expect(result).toEqual(beforeTeam)
      expect(() => structuredClone(result)).not.toThrow()
      expect(isProxy(result)).toBe(false)
      expect(isProxy(result[0])).toBe(false)
      expect(isProxy(result[0].evs)).toBe(false)
      expect(isProxy(result[0].ivs)).toBe(false)
      expect(isProxy(result[0].skills)).toBe(false)
      expect(result[0]).not.toBe(team[0])
      expect(result[0].evs).not.toBe(team[0].evs)
      expect(result[0].skills).not.toBe(team[0].skills)
      result[0].evs.hp = 0
      result[0].skills.push('sample:advanced')
      expect(team).toEqual(beforeTeam)
      expect(prepared.environment).toEqual(beforeEnvironment)
      expect(prepared.reference).toEqual(beforeReference)
      expect((globalThis as unknown as Record<string, unknown>).__personalSourceEvaluated).toBe(false)
      prepared.release()
    },
  )

  it.each([
    ['species', { species: 'sample:missing' }],
    ['skill', { skills: ['sample:missing'] }],
    ['ability', { ability: 'sample:missing' }],
    ['emblem', { emblem: 'sample:missing' }],
    ['skill outside learnset', { skills: ['sample:foreign'] }],
    ['ability outside species choices', { ability: 'sample:foreign' }],
    ['emblem outside species choices', { emblem: 'sample:foreign' }],
    ['skill above current level', { skills: ['sample:advanced'], level: 59 }],
    ['level above 100', { level: 101 }],
    ['total EVs above 510', { evs: { ...stats, hp: 255, atk: 255, def: 1 } }],
  ] as [string, Partial<PetSchemaType>][])('rejects %s from a personal team', async (_reason, overrides) => {
    const prepared = await teamEnvironment()
    expect(() => validatePersonalEnvironmentTeam(prepared, [pet(overrides)])).toThrow()
    prepared.release()
  })

  it('accepts an advanced skill at its exact learnable level', async () => {
    const prepared = await teamEnvironment()
    const team = [pet({ skills: ['sample:advanced'], level: 60 })]
    expect(validatePersonalEnvironmentTeam(prepared, team)).toEqual(team)
    prepared.release()
  })

  it('rejects duplicate pet identities while allowing repeated species with distinct identities', async () => {
    const prepared = await teamEnvironment()
    const duplicated = reactive([pet(), pet({ species: 'sample:other' })])
    expect(() => validatePersonalEnvironmentTeam(prepared, duplicated)).toThrow('重复的精灵标识')
    expect(validatePersonalEnvironmentTeam(prepared, reactive([pet(), pet({ id: 'b'.repeat(21) })]))).toHaveLength(2)
    prepared.release()
  })

  it.each(['maxHp', 'currentHp', 'hp'])('rejects %s overrides before schema cleaning', async field => {
    const prepared = await teamEnvironment()
    const team = [{ ...pet(), [field]: 999999 }]
    expect(() => validatePersonalEnvironmentTeam(prepared, team)).toThrow()
    prepared.release()
  })

  it.each(['species', 'skills', 'marks'] as const)('enforces environment %s allowlists', async kind => {
    const prepared = await teamEnvironment({ schemaVersion: 1, allow: { [kind]: [] } })
    expect(() => validatePersonalEnvironmentTeam(prepared, [pet()])).toThrow()
    prepared.release()
  })

  it.each([
    ['species', 'sample:pet'],
    ['skills', 'sample:strike'],
    ['marks', 'sample:ability'],
    ['marks', 'sample:emblem'],
  ] as const)('enforces environment %s denylist entry %s', async (kind, id) => {
    const prepared = await teamEnvironment({ schemaVersion: 1, deny: { [kind]: [id] } })
    expect(() => validatePersonalEnvironmentTeam(prepared, [pet()])).toThrow()
    prepared.release()
  })

  it('accepts a team whose species, skills and marks are all explicitly allowed', async () => {
    const prepared = await teamEnvironment({
      schemaVersion: 1,
      allow: { species: ['sample:pet'], skills: ['sample:strike'], marks: ['sample:ability', 'sample:emblem'] },
    })
    expect(validatePersonalEnvironmentTeam(prepared, [pet()])).toHaveLength(1)
    prepared.release()
  })

  it('enforces environment minimum and maximum team sizes', async () => {
    const prepared = await teamEnvironment({ schemaVersion: 1, team: { minSize: 2, maxSize: 2 } })
    expect(() => validatePersonalEnvironmentTeam(prepared, [pet()])).toThrow()
    expect(() => validatePersonalEnvironmentTeam(prepared, [pet(), pet(), pet()])).toThrow()
    expect(
      validatePersonalEnvironmentTeam(prepared, [pet(), pet({ species: 'sample:other', id: 'b'.repeat(21) })]),
    ).toHaveLength(2)
    prepared.release()
  })

  it('rejects repeated species when the environment requires unique species', async () => {
    const prepared = await teamEnvironment({ schemaVersion: 1, team: { uniqueSpecies: true } })
    expect(() => validatePersonalEnvironmentTeam(prepared, [pet(), pet({ id: 'b'.repeat(21) })])).toThrow()
    expect(
      validatePersonalEnvironmentTeam(prepared, [pet(), pet({ species: 'sample:other', id: 'b'.repeat(21) })]),
    ).toHaveLength(2)
    prepared.release()
  })
})

describe('explicit personal environment download', () => {
  it('downloads the selected HTTPS source without credentials, redirects or persistent cache', async () => {
    const bundle = await createPersonalEnvironmentBundle(await capture())
    const reference = await httpsReference(bundle)
    const request = vi.fn(async () => new Response(encodePersonalEnvironmentBundle(bundle)))
    const prepared = await downloadPersonalEnvironment(reference, undefined, request as typeof fetch)
    expect(request).toHaveBeenCalledWith(
      'https://content.test/recipe.json',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }),
    )
    expect(prepared.reference).toEqual(reference)
    expect(prepared.environment).toEqual(bundle.environment)
    prepared.release()
  })

  it.each([
    'http://content.test/recipe.json',
    'file:///tmp/recipe.json',
    'https://user:password@content.test/recipe.json',
  ])('rejects unsupported download sources before fetch: %s', async url => {
    const bundle = await createPersonalEnvironmentBundle(await capture())
    const reference: PersonalEnvironmentReference = {
      ...(await httpsReference(bundle)),
      source: { kind: 'https', url },
    }
    const request = vi.fn()
    await expect(downloadPersonalEnvironment(reference, undefined, request as typeof fetch)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps file references explicit instead of treating their names as a URL', async () => {
    const bundle = await createPersonalEnvironmentBundle(await capture())
    const reference: PersonalEnvironmentReference = {
      ...(await httpsReference(bundle)),
      source: { kind: 'file', name: 'recipe.json' },
    }
    const request = vi.fn()
    await expect(downloadPersonalEnvironment(reference, undefined, request as typeof fetch)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects downloaded materials that do not match the selected reference', async () => {
    const original = await capture()
    const selected = await createPersonalEnvironmentBundle(original, { schemaVersion: 1, team: { maxSize: 2 } })
    const substituted = await createPersonalEnvironmentBundle(original, { schemaVersion: 1, team: { maxSize: 4 } })
    const reference = await httpsReference(selected)
    const request = vi.fn(async () => new Response(encodePersonalEnvironmentBundle(substituted)))
    await expect(downloadPersonalEnvironment(reference, undefined, request as typeof fetch)).rejects.toThrow()
  })

  it('rejects a followed redirect even if its response contains a valid bundle', async () => {
    const bundle = await createPersonalEnvironmentBundle(await capture())
    const reference = await httpsReference(bundle)
    const response = new Response(encodePersonalEnvironmentBundle(bundle))
    Object.defineProperty(response, 'redirected', { value: true })
    await expect(
      downloadPersonalEnvironment(reference, undefined, vi.fn(async () => response) as typeof fetch),
    ).rejects.toThrow()
  })

  it('cancels a stalled response body when the selection changes', async () => {
    const bundle = await createPersonalEnvironmentBundle(await capture())
    const reference = await httpsReference(bundle)
    const controller = new AbortController()
    const cancel = vi.fn()
    const request = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    const pending = downloadPersonalEnvironment(reference, controller.signal, request as typeof fetch)
    const rejected = expect(pending).rejects.toThrow('selection changed')
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    controller.abort(new Error('selection changed'))
    await rejected
    expect(cancel).toHaveBeenCalledOnce()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('enforces the 64 MiB download limit on streamed bytes despite a smaller content-length header', async () => {
    const bundle = await createPersonalEnvironmentBundle(await capture())
    const reference = await httpsReference(bundle)
    const chunk = new Uint8Array(8 * 1024 * 1024)
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let index = 0; index < 9; index++) controller.enqueue(chunk)
        },
        cancel,
      }),
      { headers: { 'content-length': '1' } },
    )
    await expect(
      downloadPersonalEnvironment(reference, undefined, vi.fn(async () => response) as typeof fetch),
    ).rejects.toThrow()
    expect(cancel).toHaveBeenCalledOnce()
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
