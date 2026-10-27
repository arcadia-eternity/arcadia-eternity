import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import YAML from 'yaml'
import { NativePackLoader } from '../src/native-loader'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/native'
import { createContentCatalog } from '@arcadia-eternity/battle/v4'

const basePath = fileURLToPath(new URL('../../../packs/base/', import.meta.url))
const origin = 'https://example.test/native/'
const build = { formatVersion: 1, coreBuildId: 'a'.repeat(64), registryBuildId: 'b'.repeat(64) } as const
const temporary: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})

function serveBase(change?: (path: string, raw: string) => string, extra: Record<string, string> = {}) {
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      const path = url.pathname.replace(/^\/native\//, '')
      requests.push(path)
      if (path.startsWith('data/effect_')) throw new Error(`Effect DSL must not be requested: ${path}`)
      try {
        const raw = extra[path] ?? (await readFile(resolve(basePath, path), 'utf8'))
        return new Response(change?.(path, raw) ?? raw)
      } catch {
        return new Response('not found', { status: 404 })
      }
    }),
  )
  return requests
}

describe('NativePackLoader', () => {
  it('rejects an HTTP lockfile that does not match the loaded pack', async () => {
    serveBase(undefined, {
      'pack.json': JSON.stringify({
        id: 'fixture.lock',
        version: '1.0.0',
        engine: 'seer2-v2',
        data: { effects: [], marks: [], skills: [], species: [] },
      }),
      'pack-lock.yaml': `lockfileVersion: 1
generatedAt: '2026-03-10T12:00:00.000Z'
importers:
  .:
    dependencies:
      fixture.lock:
        specifier: https://example.test/native/pack.json
        version: 9.9.9
        packageKey: /fixture.lock@9.9.9
packages:
  /fixture.lock@9.9.9:
    name: fixture.lock
    version: 9.9.9
    kind: data
    engine: seer2-v2
    source: https://example.test/native/pack.json
    entry: pack.json
    provenance: http
`,
    })
    await expect(
      new NativePackLoader(build, createContentCatalog).loadMetadata(origin, { source: 'http', enforceLockfile: true }),
    ).rejects.toThrow(/Pack lockfile validation failed/)
  })

  for (const yamlResponse of ['html', 'missing'] as const)
    it(`loads converted JSON locales when the YAML URL returns ${yamlResponse}`, async () => {
      const locale = { fight: 'Fight', category: { Physical: 'Physical' } }
      const requests = serveBase(undefined, {
        'pack.json': JSON.stringify({
          id: 'fixture.json-locales',
          version: '1.0.0',
          engine: 'seer2-v2',
          data: { effects: [], marks: [], skills: [], species: [] },
          locales: { en: ['battle'] },
        }),
        ...(yamlResponse === 'html' ? { 'locales/en/battle.yaml': '<!doctype html><html>app</html>' } : {}),
        'locales/en/battle.json': JSON.stringify(locale),
      })
      const result = await new NativePackLoader(build, createContentCatalog).loadMetadata(origin, { source: 'http' })
      expect(result.locales).toEqual({ en: { battle: locale } })
      expect(requests).toContain('locales/en/battle.json')
    })

  it('rejects invalid locale content even when a JSON fallback is available', async () => {
    serveBase(undefined, {
      'pack.json': JSON.stringify({
        id: 'fixture.invalid-locales',
        version: '1.0.0',
        engine: 'seer2-v2',
        data: { effects: [], marks: [], skills: [], species: [] },
        locales: { en: ['battle'] },
      }),
      'locales/en/battle.yaml': '<!doctype html><html>app</html>',
      'locales/en/battle.json': '[]',
    })
    await expect(
      new NativePackLoader(build, createContentCatalog).loadMetadata(origin, { source: 'http' }),
    ).rejects.toThrow()
  })

  for (const source of ['node-fs', 'http'] as const)
    it(`reads an incomplete metadata layer without executing its content factory: ${source}`, async () => {
      const skill = {
        id: 'skill_overlay',
        element: 'Normal',
        category: 'Physical',
        power: 40,
        rage: 0,
        accuracy: 95,
        effect: ['effect_from_another_layer'],
      }
      const manifest = JSON.stringify({
        id: 'fixture.overlay',
        version: '1.0.0',
        engine: 'seer2-v2',
        data: { effects: ['missing-effect.yaml'], marks: [], skills: ['skills.yaml'], species: [] },
      })
      const skills = YAML.stringify([skill])
      let ref = `${origin}overlay/pack.json`
      if (source === 'http') {
        serveBase(undefined, { 'overlay/pack.json': manifest, 'overlay/skills.yaml': skills })
      } else {
        const root = await mkdtemp(resolve(tmpdir(), 'native-metadata-overlay-'))
        temporary.push(root)
        ref = resolve(root, 'pack.json')
        await writeFile(ref, manifest)
        await writeFile(resolve(root, 'skills.yaml'), skills)
      }
      const factory = vi.fn(createContentCatalog)
      const loader = new NativePackLoader(build, factory)
      const metadata = await loader.loadMetadata(ref, { source })
      expect(metadata.data).toEqual({ marks: [], skills: [skill], species: [] })
      expect(metadata.pack?.id).toBe('fixture.overlay')
      expect(metadata.errors).toEqual([])
      expect(factory).not.toHaveBeenCalled()
      await expect(loader.load(ref, { source })).rejects.toThrow('Unknown content effect: effect_from_another_layer')
      await expect(loader.fromMetadata(metadata.data)).rejects.toThrow(
        'Unknown content effect: effect_from_another_layer',
      )
    })

  it('assembles captured metadata with the host-selected content factory', async () => {
    const data = { marks: [] as unknown[], skills: [], species: [] }
    const factory = vi.fn(createContentCatalog)
    const loader = new NativePackLoader(build, factory)
    const pending = loader.fromMetadata(data)
    data.marks.push({ id: 'changed-after-capture' })

    const result = await pending
    expect(factory).toHaveBeenCalledExactlyOnceWith({ marks: [], skills: [], species: [] }, result.revision)
    expect(factory.mock.calls[0][0]).not.toBe(data)
    expect(result.content).toBe(factory.mock.results[0].value)
    expect(result.content.revision).toBe(result.revision)
    expect(result.content.effects).toEqual([])
    expect(result.content.marks).toEqual([])
  })

  it('captures current in-memory metadata and its identity without requesting effect DSL', async () => {
    const manifest = JSON.parse(await readFile(resolve(basePath, 'pack.json'), 'utf8')) as {
      paths?: { dataDir?: string }
      data: Record<'marks' | 'skills' | 'species', string[]>
    }
    const read = async (kind: 'marks' | 'skills' | 'species') =>
      (
        await Promise.all(
          manifest.data[kind].map(
            async file =>
              YAML.parse(await readFile(resolve(basePath, manifest.paths?.dataDir ?? 'data', file), 'utf8'), {
                merge: true,
              }) as unknown[],
          ),
        )
      ).flat()
    const data = {
        marks: await read('marks'),
        skills: await read('skills'),
        species: await read('species'),
      },
      loader = new NativePackLoader(build, createOfficialContent)
    const skill = data.skills.find(value => (value as { id: string }).id === 'skill_paida') as {
      id: string
      power: number
    }
    const original = skill.power,
      pending = loader.fromMetadata(data)
    skill.power = original + 1
    const first = await pending,
      second = await loader.fromMetadata(data)
    expect(first.runtime).toBe('native-v4')
    expect(first.content.skills.find(value => value.id === skill.id)?.power).toBe(original)
    expect(second.content.skills.find(value => value.id === skill.id)?.power).toBe(original + 1)
    expect(second.revision).not.toBe(first.revision)
    expect((await loader.fromMetadata(structuredClone(data))).revision).toBe(second.revision)
    expect(first.build).toEqual(build)
  })
  it('loads the same native content identity from filesystem and HTTP without reading effect DSL', async () => {
    const requests = serveBase()
    const loader = new NativePackLoader(build, createOfficialContent)
    const local = await loader.load('builtin:base', { enforceLockfile: true })
    const remote = await loader.load(origin, {
      source: 'http',
      expectedRevision: local.revision,
      enforceLockfile: true,
    })
    expect(remote.runtime).toBe('native-v4')
    expect(remote.data).toEqual(local.data)
    expect(remote.revision).toBe(local.revision)
    expect(remote.errors).toEqual([])
    expect(remote.lockfileIssues).toEqual([])
    expect(remote.assetConflicts).toEqual([])
    expect(remote.locales).toEqual(local.locales)
    expect(remote.assets).toHaveLength(local.assets!.length)
    expect([
      remote.content.effects.length,
      remote.content.marks.length,
      remote.content.skills.length,
      remote.content.species.length,
    ]).toEqual([1065, 416, 966, 145])
    for (const prototype of [...remote.content.marks, ...remote.content.skills])
      for (const effect of prototype.effects) expect(remote.content.getEffect(effect.id)).toBe(effect)
    expect(requests.some(path => path.startsWith('data/effect_'))).toBe(false)
    expect(requests).toContain('locales/zh-CN/skill.yaml')
  })

  it('rejects a revision from another trusted code build', async () => {
    const initial = await new NativePackLoader(build, createOfficialContent).load('builtin:base')
    const other = new NativePackLoader({ ...build, registryBuildId: 'c'.repeat(64) }, createOfficialContent)
    await expect(other.load('builtin:base', { expectedRevision: initial.revision })).rejects.toThrow(
      'revision mismatch',
    )
  })

  it('copies the trusted build identity before any asynchronous load', async () => {
    const mutable = { ...build } as { formatVersion: 1; coreBuildId: string; registryBuildId: string }
    const loader = new NativePackLoader(mutable, createOfficialContent)
    mutable.registryBuildId = 'c'.repeat(64)
    expect((await loader.load('builtin:base')).build).toEqual(build)
    expect(() => new NativePackLoader({ ...build, coreBuildId: 'untrusted-name' }, createOfficialContent)).toThrow(
      'trusted native build',
    )
  })

  for (const invalid of ['effect-reference', 'non-array', 'manifest-engine'] as const)
    it(`rejects invalid metadata without a DSL fallback: ${invalid}`, async () => {
      serveBase((path, raw) => {
        if (invalid === 'manifest-engine' && path === 'pack.json')
          return JSON.stringify({ ...JSON.parse(raw), engine: 'unknown' })
        if (path !== 'data/mark.yaml') return raw
        if (invalid === 'non-array') return 'not: an array'
        const marks = YAML.parse(raw, { merge: true })
        marks[0].effect = ['effect_not_registered_in_typescript']
        return YAML.stringify(marks)
      })
      const loader = new NativePackLoader(build, createOfficialContent)
      await expect(loader.load(origin, { source: 'http' })).rejects.toThrow()
    })

  it('loads filesystem dependencies before the entry and never reads their effect files', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'native-pack-dependencies-'))
    temporary.push(root)
    const file = resolve(root, 'pack.json')
    await writeFile(
      file,
      JSON.stringify({
        id: 'fixture.native.entry',
        version: '1.0.0',
        engine: 'seer2-v2',
        dependencies: [{ id: 'arcadia-eternity.base', path: resolve(basePath, 'pack.json') }],
        data: { effects: ['missing-effect.yaml'], marks: [], skills: [], species: [] },
      }),
    )
    const result = await new NativePackLoader(build, createOfficialContent).load(file)
    expect(result.pack?.id).toBe('fixture.native.entry')
    expect(result.content.effects).toHaveLength(1065)
    expect(result.content.skills).toHaveLength(966)
    const options = { enforceLockfile: true }
    const strictLoad = new NativePackLoader(build, createOfficialContent).load(file, options)
    options.enforceLockfile = false
    await expect(strictLoad).rejects.toThrow('lockfile is required')
  })

  it('rejects dependency cycles before publishing content', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'native-pack-cycle-'))
    temporary.push(root)
    await mkdir(resolve(root, 'child'))
    const metadata = { version: '1.0.0', engine: 'seer2-v2', data: { effects: [], marks: [], skills: [], species: [] } }
    await writeFile(
      resolve(root, 'pack.json'),
      JSON.stringify({ ...metadata, id: 'fixture.root', dependencies: [{ path: 'child/pack.json' }] }),
    )
    await writeFile(
      resolve(root, 'child/pack.json'),
      JSON.stringify({ ...metadata, id: 'fixture.child', dependencies: [{ path: '../pack.json' }] }),
    )
    await expect(new NativePackLoader(build, createOfficialContent).load(resolve(root, 'pack.json'))).rejects.toThrow(
      'cycle',
    )
  })

  it('includes every dependency version in identity even when metadata is unchanged', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'native-pack-version-'))
    temporary.push(root)
    const entry = resolve(root, 'pack.json')
    const dependency = resolve(root, 'dependency.json')
    const metadata = { version: '1.0.0', engine: 'seer2-v2', data: { effects: [], marks: [], skills: [], species: [] } }
    await writeFile(
      entry,
      JSON.stringify({ ...metadata, id: 'fixture.root', dependencies: [{ path: 'dependency.json' }] }),
    )
    await writeFile(dependency, JSON.stringify({ ...metadata, id: 'fixture.dependency' }))
    const loader = new NativePackLoader(build, createContentCatalog)
    const first = await loader.load(entry)
    await writeFile(dependency, JSON.stringify({ ...metadata, id: 'fixture.dependency', version: '1.1.0' }))
    const next = await loader.load(entry)
    expect(next.data).toEqual(first.data)
    expect(next.revision).not.toBe(first.revision)
  })

  for (const source of ['node-fs', 'http'] as const)
    it(`checks dependency identity again when a manifest was already visited: ${source}`, async () => {
      const metadata = {
        version: '1.0.0',
        engine: 'seer2-v2',
        data: { effects: [], marks: [], skills: [], species: [] },
      }
      let ref = origin
      if (source === 'http') {
        serveBase(
          (path, raw) =>
            path === 'pack.json'
              ? JSON.stringify({
                  ...JSON.parse(raw),
                  dependencies: [
                    { path: 'empty/pack.json', id: 'fixture.empty' },
                    { path: 'empty/pack.json', id: 'fixture.wrong' },
                  ],
                })
              : raw,
          { 'empty/pack.json': JSON.stringify({ ...metadata, id: 'fixture.empty' }) },
        )
      } else {
        const root = await mkdtemp(resolve(tmpdir(), 'native-pack-identity-'))
        temporary.push(root)
        ref = resolve(root, 'pack.json')
        await writeFile(
          ref,
          JSON.stringify({
            ...metadata,
            id: 'fixture.root',
            dependencies: [
              { path: resolve(basePath, 'pack.json'), id: 'arcadia-eternity.base' },
              { path: resolve(basePath, 'pack.json'), id: 'fixture.wrong' },
            ],
          }),
        )
      }
      await expect(new NativePackLoader(build, createOfficialContent).load(ref, { source })).rejects.toThrow(
        /id mismatch/i,
      )
    })
})
