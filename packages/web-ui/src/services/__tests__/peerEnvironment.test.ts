import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { digestJson } from '@arcadia-eternity/pack-loader/native'
import { MarkSchema, SkillSchema, parseWithErrors } from '@arcadia-eternity/schema'
import type { ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import { preparePeerEnvironment } from '../peerEnvironment'

const server = 'https://paired-server.test'
const content = { species: [], skills: [], marks: [] }

async function fixture() {
  const descriptor: ServerEnvironmentDescriptor & { peerRevision: string } = {
    id: 'a'.repeat(64),
    protocolVersion: 1,
    executionPolicy: 'peer',
    runtime: {
      kind: 'native-v4',
      contentRevision: 'content:fixed-1',
      coreBuildId: 'core-1',
      registryBuildId: 'registry-1',
    },
    packages: [{ name: 'sample', version: '1.0.0', projectId: 'sample-pack', namespace: 'sample' }],
    resourceRevision: 'b'.repeat(64),
    peerRevision: 'content:fixed-1/effects:captured-1',
    resources: [],
  }
  const module = (namespace: string, role: string, packageId: string) => ({
    namespace,
    role,
    artifact: {
      format: 'arcadia.effect-module',
      version: 1,
      sdkApi: 2,
      packageId,
      // The transport must only copy this text. Neither metadata loading nor preparation may evaluate it.
      source: 'globalThis.__peerMaterialExecuted = true; export function createEffects() { return [] }',
    },
  })
  const materials = {
    protocolVersion: 1,
    environmentId: descriptor.id,
    resourceRevision: descriptor.resourceRevision,
    runtime: structuredClone(descriptor.runtime),
    packages: structuredClone(descriptor.packages),
    environment: {
      revision: descriptor.peerRevision,
      data: {
        ...structuredClone(content),
        behaviors: [
          {
            formatVersion: 1,
            id: 'sample:effect',
            sourceKind: 'skill',
            parameters: {},
            implementation: { kind: 'native', exportId: 'sample:effect' },
          },
        ],
      },
      modules: [module('', 'catalog', '@arcadia-eternity/data-pack-base'), module('sample', 'behaviors', 'sample')],
    },
  }
  descriptor.peerRevision = `${descriptor.runtime.contentRevision}/effects:${await digestJson(materials.environment.modules)}`
  materials.environment.revision = descriptor.peerRevision
  return { descriptor, materials }
}

async function reseal(value: Awaited<ReturnType<typeof fixture>>) {
  value.descriptor.peerRevision = `${value.descriptor.runtime.contentRevision}/effects:${await digestJson(value.materials.environment.modules)}`
  value.materials.environment.revision = value.descriptor.peerRevision
}

function transport(materials: unknown, options: { status?: number; raw?: string; displayed?: unknown } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === `${server}/api/v1/environments/${'a'.repeat(64)}/content`)
      return new Response(JSON.stringify(options.displayed ?? content))
    if (url === `${server}/api/v1/environments/${'a'.repeat(64)}/peer-materials`)
      return new Response(options.raw ?? JSON.stringify(materials), { status: options.status ?? 200 })
    throw new Error(`Unexpected network request: ${url}`)
  })
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fixed peer environment acquisition', () => {
  it('captures executable materials and exact revision before acknowledging readiness', async () => {
    const { descriptor, materials } = await fixture()
    const request = transport(materials)
    const result = await preparePeerEnvironment(server, descriptor, request as typeof fetch)

    expect(result.environment).toEqual(materials.environment)
    expect(result.content).toEqual(content)
    expect(result.acceptance).toEqual({
      environmentId: descriptor.id,
      protocolVersion: 1,
      resourceRevision: descriptor.resourceRevision,
      resourcesReady: true,
      peerRevision: descriptor.peerRevision,
    })
    expect(result.readiness).toMatchObject({
      catalog: 'ready',
      compatibility: 'compatible',
      media: 'on-demand',
      execution: 'prepared',
    })
    expect(request.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        `${server}/api/v1/environments/${descriptor.id}/content`,
        `${server}/api/v1/environments/${descriptor.id}/peer-materials`,
      ]),
    )
  })

  it('keeps remote acquisition independent of desktop selection and never evaluates module source', async () => {
    const { descriptor, materials } = await fixture()
    const prepareLocalContent = vi.fn(() => {
      throw new Error('Remote acquisition cannot access the desktop workspace')
    })
    vi.stubGlobal('window', { arcadiaDesktop: { prepareLocalContent } })
    vi.stubGlobal('__peerMaterialExecuted', false)
    const request = transport(materials)

    await preparePeerEnvironment(server, descriptor, request as typeof fetch)

    expect(prepareLocalContent).not.toHaveBeenCalled()
    expect((globalThis as unknown as Record<string, unknown>).__peerMaterialExecuted).toBe(false)
    for (const [url, options] of vi.mocked(request as typeof fetch).mock.calls) {
      expect(new URL(String(url)).origin).toBe(server)
      expect(options).toMatchObject({
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      })
    }
  })

  it('accepts a data-only content package without demanding an executable module', async () => {
    const { descriptor, materials } = await fixture()
    materials.environment.data.behaviors = []
    materials.environment.modules.pop()
    await reseal({ descriptor, materials })
    const result = await preparePeerEnvironment(server, descriptor, transport(materials) as typeof fetch)
    expect(result.environment.modules).toHaveLength(1)
    expect(result.acceptance.peerRevision).toBe(descriptor.peerRevision)
  })

  it('validates omitted schema defaults without modifying captured raw skill or mark records', async () => {
    const { descriptor, materials } = await fixture()
    const rawSkill = { id: 'sample:strike' }
    const rawMark = { id: 'sample:mark', config: { duration: 2 } }
    const rawData = { ...materials.environment.data, skills: [rawSkill], marks: [rawMark] }
    const captured = { ...materials, environment: { ...materials.environment, data: rawData } }
    const { effect: _effect, ...skill } = parseWithErrors(SkillSchema, rawSkill)
    const mark = parseWithErrors(MarkSchema, rawMark)
    const displayed = { species: [], skills: [skill], marks: [{ id: mark.id, tags: mark.tags ?? [] }] }

    const result = await preparePeerEnvironment(server, descriptor, transport(captured, { displayed }) as typeof fetch)

    expect(result.environment.data).toEqual(rawData)
    expect(result.environment.data.skills[0]).toEqual({ id: 'sample:strike' })
    expect(result.environment.data.marks[0]).toEqual({ id: 'sample:mark', config: { duration: 2 } })
    expect(result.content.skills[0]).toMatchObject({ id: rawSkill.id, sureCrit: false })
    expect(result.acceptance.peerRevision).toBe(descriptor.peerRevision)
  })

  it.each([
    ['skill power', 'skills', { id: 'sample:strike', power: 'bad' }],
    ['skill critical flag', 'skills', { id: 'sample:strike', sureCrit: 'bad' }],
    ['mark duration', 'marks', { id: 'sample:mark', config: { duration: 'bad' } }],
  ])('rejects an invalid supplied %s instead of replacing it with defaults', async (_name, kind, raw) => {
    const { descriptor, materials } = await fixture()
    const captured = {
      ...materials,
      environment: {
        ...materials.environment,
        data: { ...materials.environment.data, [kind as string]: [raw] },
      },
    }
    const request = transport(captured)
    await expect(preparePeerEnvironment(server, descriptor, request as typeof fetch)).rejects.toThrow()
    expect(request.mock.calls.some(([url]) => String(url).endsWith('/content'))).toBe(false)
  })

  const identityChanges: [string, (materials: Awaited<ReturnType<typeof fixture>>['materials']) => void][] = [
    ['environment instance', value => (value.environmentId = 'c'.repeat(64))],
    ['resource revision', value => (value.resourceRevision = 'c'.repeat(64))],
    ['captured execution revision', value => (value.environment.revision = 'another-capture')],
    ['content revision', value => (value.runtime.contentRevision = 'another-content')],
    ['core identity', value => (value.runtime.coreBuildId = 'another-core')],
    ['registry identity', value => (value.runtime.registryBuildId = 'another-registry')],
    ['package version', value => (value.packages[0].version = '2.0.0')],
    ['package namespace', value => (value.packages[0].namespace = 'another')],
  ]
  it.each(identityChanges)('rejects a different %s instead of accepting display metadata', async (_name, change) => {
    const { descriptor, materials } = await fixture()
    change(materials)
    await expect(preparePeerEnvironment(server, descriptor, transport(materials) as typeof fetch)).rejects.toThrow()
  })

  it('requires a declared peer revision before requesting executable materials', async () => {
    const { descriptor, materials } = await fixture()
    const request = transport(materials)
    const missing = { ...descriptor }
    delete (missing as Partial<typeof descriptor>).peerRevision
    await expect(preparePeerEnvironment(server, missing, request as typeof fetch)).rejects.toThrow()
  })

  it('rejects changed code even when the response repeats the expected revision string', async () => {
    const { descriptor, materials } = await fixture()
    materials.environment.modules[1].artifact.source = 'export function createEffects() { throw Error("substituted") }'
    await expect(preparePeerEnvironment(server, descriptor, transport(materials) as typeof fetch)).rejects.toThrow()
  })

  const moduleChanges: [string, (materials: Awaited<ReturnType<typeof fixture>>['materials']) => void][] = [
    ['official catalog', value => value.environment.modules.shift()],
    ['module for a referenced behavior namespace', value => value.environment.modules.pop()],
    ['compatible SDK', value => (value.environment.modules[1].artifact.sdkApi = 99)],
    ['supported artifact format', value => (value.environment.modules[1].artifact.format = 'javascript')],
    ['supported artifact version', value => (value.environment.modules[1].artifact.version = 99)],
    ['module source', value => (value.environment.modules[1].artifact.source = '')],
    ['unique packages', value => value.environment.modules.push(structuredClone(value.environment.modules[1]))],
    ['valid module role', value => (value.environment.modules[1].role = 'native')],
  ]
  it.each(moduleChanges)('requires %s for client execution', async (_name, change) => {
    const { descriptor, materials } = await fixture()
    change(materials)
    await reseal({ descriptor, materials })
    await expect(preparePeerEnvironment(server, descriptor, transport(materials) as typeof fetch)).rejects.toThrow()
  })

  it('rejects oversized source before handing it to a Worker', async () => {
    const { descriptor, materials } = await fixture()
    materials.environment.modules[1].artifact.source = 'x'.repeat(4 * 1024 * 1024 + 1)
    await reseal({ descriptor, materials })
    await expect(preparePeerEnvironment(server, descriptor, transport(materials) as typeof fetch)).rejects.toThrow()
  })

  it('rejects too many executable modules', async () => {
    const { descriptor, materials } = await fixture()
    materials.environment.modules = Array.from({ length: 33 }, (_, index) => ({
      ...structuredClone(materials.environment.modules[0]),
      namespace: `package-${index}`,
      artifact: { ...materials.environment.modules[0].artifact, packageId: `package-${index}` },
    }))
    await reseal({ descriptor, materials })
    await expect(preparePeerEnvironment(server, descriptor, transport(materials) as typeof fetch)).rejects.toThrow()
  })

  it.each([
    ['unavailable', { status: 404 }],
    ['malformed', { raw: '{ incomplete' }],
    ['metadata only', { raw: JSON.stringify(content) }],
  ])('does not fall back to display readiness when materials are %s', async (_name, options) => {
    const { descriptor, materials } = await fixture()
    await expect(
      preparePeerEnvironment(server, descriptor, transport(materials, options) as typeof fetch),
    ).rejects.toThrow()
  })

  it('aborts pending material reads without returning an acceptance', async () => {
    const { descriptor } = await fixture()
    const controller = new AbortController()
    const cancel = vi.fn()
    const request = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/peer-materials')
        ? new Response(new ReadableStream({ cancel }))
        : new Response(JSON.stringify(content)),
    )
    const pending = preparePeerEnvironment(server, descriptor, request as typeof fetch, controller.signal)
    const rejected = expect(pending).rejects.toThrow('selection changed')
    await vi.waitFor(() =>
      expect(request.mock.calls.some(([url]) => String(url).endsWith('/peer-materials'))).toBe(true),
    )
    controller.abort(new Error('selection changed'))
    await rejected
    expect(cancel).toHaveBeenCalledOnce()
  })
})
