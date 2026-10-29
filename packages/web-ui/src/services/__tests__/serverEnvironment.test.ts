import { describe, expect, it, vi } from 'vitest'
import { SpeciesSchema, SkillSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { createHash } from 'node:crypto'
import type { ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import { environmentServerUrl, listServerEnvironments, prepareServerEnvironment } from '../serverEnvironment'

const bytes = new Uint8Array([1, 2, 3])
const hash = createHash('sha256').update(bytes).digest('hex')
const descriptor: ServerEnvironmentDescriptor = {
  id: 'a'.repeat(64),
  protocolVersion: 1,
  runtime: { kind: 'native-v4', contentRevision: 'r', coreBuildId: 'c', registryBuildId: 'b' },
  packages: [{ name: 'sample', version: '1.0.0', projectId: 'sample-pack', namespace: 'sample' }],
  resourceRevision: 'b'.repeat(64),
  resources: [
    {
      id: 'icon',
      variant: 'default',
      projectId: 'sample-pack',
      sha256: hash,
      bytes: 3,
      mime: 'image/png',
      url: `/api/v1/environments/${'a'.repeat(64)}/assets/${hash}`,
    },
  ],
}
const { effect: _effect, ...skill } = parseWithErrors(SkillSchema, { id: 'sample:strike' })
const content = {
  species: [parseWithErrors(SpeciesSchema, { id: 'sample:pet', assetRef: 'icon' })],
  skills: [skill],
  marks: [],
}
const fake = (resource = bytes, displayed: unknown = content) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/content')) return new Response(JSON.stringify(displayed), { status: 200 })
    if (url.includes('/assets/')) return new Response(resource, { status: 200 })
    return new Response(JSON.stringify({ protocolVersion: 1, environments: [descriptor] }), { status: 200 })
  }) as unknown as typeof fetch

describe('server environment display readiness', () => {
  it('reads each server catalog independently without downloading display assets', async () => {
    const request = fake()
    expect(environmentServerUrl('wss://server-a.test/')).toBe('https://server-a.test')
    expect(await listServerEnvironments('https://server-a.test', request)).toEqual([descriptor])
    expect(await listServerEnvironments('https://server-b.test', request)).toEqual([descriptor])
    const result = await prepareServerEnvironment('https://server-a.test', descriptor, request)
    expect(result.readiness).toEqual({ catalog: 'ready', compatibility: 'compatible', media: 'on-demand' })
    expect(result.acceptance).toEqual({
      environmentId: descriptor.id,
      protocolVersion: 1,
      resourceRevision: descriptor.resourceRevision,
      resourcesReady: true,
    })
    expect(vi.mocked(request).mock.calls.some(([url]) => String(url).includes('/assets/'))).toBe(false)
    expect(result.content.species[0].assetRef).toBe(`https://server-a.test${descriptor.resources[0].url}`)
    expect(vi.mocked(request).mock.calls.map(([url]) => String(url))).toContain(
      'https://server-b.test/api/v1/environments',
    )
  })
  it('rejects invalid file addresses, without requiring WebCrypto or downloading resources', async () => {
    const malicious = structuredClone(descriptor)
    malicious.resources[0].url = 'https://attacker.test/asset.png'
    await expect(prepareServerEnvironment('https://server-a.test', malicious, fake())).rejects.toThrow('地址无效')
    await expect(prepareServerEnvironment('http://server-a.test', descriptor, fake())).resolves.toMatchObject({
      acceptance: { resourcesReady: true },
    })
  })
  it('resolves separate image/SWF purposes and server-approved HTTP references without fetching them', async () => {
    const catalog = structuredClone(descriptor)
    catalog.remoteResources = [
      { projectId: 'sample-pack', id: 'https://media.test/pet.swf', url: 'https://media.test/pet.swf' },
    ]
    const displayed = {
      ...content,
      species: [
        {
          ...content.species[0],
          assetRef: undefined,
          presentation: {
            icon: 'icon',
            portrait: 'icon',
            battle: { renderer: 'seer2-swf', source: 'https://media.test/pet.swf', fallback: 'icon' },
          },
        },
      ],
    }
    const request = fake(bytes, displayed as typeof content)
    const result = await prepareServerEnvironment('https://server-a.test', catalog, request)
    expect(result.content.species[0].presentation).toEqual({
      icon: `https://server-a.test${catalog.resources[0].url}`,
      portrait: `https://server-a.test${catalog.resources[0].url}`,
      battle: {
        renderer: 'seer2-swf',
        source: 'https://media.test/pet.swf',
        fallback: `https://server-a.test${catalog.resources[0].url}`,
      },
    })
    expect(vi.mocked(request).mock.calls).toHaveLength(1)
  })
  it('rejects undeclared UGC references while preserving official display references', async () => {
    for (const assetRef of ['https://external.test/image.png', '../unchecked.png', 'unknown']) {
      const displayed = { ...content, species: [{ ...content.species[0], assetRef }] }
      await expect(
        prepareServerEnvironment('https://server-a.test', descriptor, fake(bytes, displayed)),
      ).rejects.toThrow('内容资源未在服务器目录声明')
    }
    const official = {
      ...content,
      species: [{ ...content.species[0], id: 'pet_official', assetRef: 'https://official.test/pet.png' }],
    }
    const result = await prepareServerEnvironment('https://server-a.test', descriptor, fake(bytes, official))
    expect(result.content.species[0].assetRef).toBe('https://official.test/pet.png')
  })
})

it('rejects missing definitions, server effect payloads, unsupported renderers and UI locale overrides', async () => {
  for (const invalid of [
    { ...content, species: [{ ...content.species[0], baseStats: undefined }] },
    { ...content, species: [content.species[0], content.species[0]] },
    { ...content, skills: [{ ...skill, effect: ['remote-code'] }] },
    {
      ...content,
      species: [{ ...content.species[0], learnable_skills: [{ skill_id: 'missing', level: 1, hidden: false }] }],
    },
    {
      ...content,
      species: [{ ...content.species[0], presentation: { battle: { renderer: 'third-party-js', source: 'icon' } } }],
    },
    {
      ...content,
      locales: { defaultLocale: 'zh-CN', bundles: { 'zh-CN': { webui: { login: { name: 'Override' } } } } },
    },
  ]) {
    await expect(prepareServerEnvironment('https://server.test', descriptor, fake(bytes, invalid))).rejects.toThrow()
  }
})

it('rejects non-HTTP core references and excessive metadata nesting before readiness', async () => {
  for (const assetRef of ['javascript:alert(1)', 'file:///tmp/a.png', '/local-workspace.png']) {
    const invalid = { ...content, species: [{ ...content.species[0], id: 'pet_core', assetRef }] }
    await expect(prepareServerEnvironment('https://server.test', descriptor, fake(bytes, invalid))).rejects.toThrow()
  }
  let nested: unknown = 'value'
  for (let index = 0; index < 18; index++) nested = { next: nested }
  const invalid = { ...content, extra: nested }
  await expect(prepareServerEnvironment('https://server.test', descriptor, fake(bytes, invalid))).rejects.toThrow()
})
