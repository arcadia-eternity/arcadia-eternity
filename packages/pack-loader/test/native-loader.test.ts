import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import YAML from 'yaml'
import { NativePackLoader } from '../src/native-loader'

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
  it('loads the same native content identity from filesystem and HTTP without reading effect DSL', async () => {
    const requests = serveBase()
    const loader = new NativePackLoader(build)
    const local = await loader.load('builtin:base', { enforceLockfile: true })
    const remote = await loader.load(origin, {
      source: 'http',
      expectedRevision: local.revision,
      enforceLockfile: true,
    })
    expect(remote.runtime).toBe('native-v4')
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
    const initial = await new NativePackLoader(build).load('builtin:base')
    const other = new NativePackLoader({ ...build, registryBuildId: 'c'.repeat(64) })
    await expect(other.load('builtin:base', { expectedRevision: initial.revision })).rejects.toThrow(
      'revision mismatch',
    )
  })

  it('copies the trusted build identity before any asynchronous load', async () => {
    const mutable = { ...build } as { formatVersion: 1; coreBuildId: string; registryBuildId: string }
    const loader = new NativePackLoader(mutable)
    mutable.registryBuildId = 'c'.repeat(64)
    expect((await loader.load('builtin:base')).build).toEqual(build)
    expect(() => new NativePackLoader({ ...build, coreBuildId: 'untrusted-name' })).toThrow('trusted native build')
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
      const loader = new NativePackLoader(build)
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
    const result = await new NativePackLoader(build).load(file)
    expect(result.pack?.id).toBe('fixture.native.entry')
    expect(result.content.effects).toHaveLength(1065)
    expect(result.content.skills).toHaveLength(966)
    const options = { enforceLockfile: true }
    const strictLoad = new NativePackLoader(build).load(file, options)
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
    await expect(new NativePackLoader(build).load(resolve(root, 'pack.json'))).rejects.toThrow('cycle')
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
      await expect(new NativePackLoader(build).load(ref, { source })).rejects.toThrow(/id mismatch/i)
    })
})
