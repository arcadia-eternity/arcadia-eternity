import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generatePackLockfileFromEntry } from '../src/lockfile'

describe('pack lockfile generator', () => {
  it('generates valid lockfile from local pack manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pack-lock-test-'))
    const depDir = join(dir, 'dep')
    const rootDir = join(dir, 'root')
    await mkdir(depDir, { recursive: true })
    await mkdir(rootDir, { recursive: true })

    await writeFile(
      join(depDir, 'package.json'),
      JSON.stringify({
        name: '@demo/dep-pack',
        arcadiaEternityPack: 'pack.json',
      }),
      'utf8',
    )
    await writeFile(
      join(depDir, 'pack.json'),
      JSON.stringify({
        id: 'dep.pack',
        version: '1.0.0',
        engine: 'seer2-v2',
        data: { effects: [], marks: [], skills: [], species: [] },
      }),
      'utf8',
    )

    await writeFile(
      join(rootDir, 'package.json'),
      JSON.stringify({
        name: '@demo/root-pack',
        arcadiaEternityPack: 'pack.json',
        arcadiaEternityAssets: 'assets.json',
      }),
      'utf8',
    )
    await writeFile(
      join(rootDir, 'assets.json'),
      JSON.stringify({
        id: 'root.assets',
        version: '1.0.0',
        engine: 'seer2-v2',
        assets: [],
      }),
      'utf8',
    )
    await writeFile(
      join(rootDir, 'pack.json'),
      JSON.stringify({
        id: 'root.pack',
        version: '1.0.0',
        engine: 'seer2-v2',
        assetsRef: 'assets.json',
        dependencies: [{ path: '../dep/pack.json' }],
        data: { effects: [], marks: [], skills: [], species: [] },
      }),
      'utf8',
    )

    const lock = await generatePackLockfileFromEntry(join(rootDir, 'pack.json'))
    expect(lock.lockfileVersion).toBe(1)
    expect(typeof lock.generatedAt).toBe('string')
    expect(lock.importers['.']).toBeDefined()
    expect(lock.packages['/root.pack@1.0.0']).toBeDefined()
    expect(lock.packages['/dep.pack@1.0.0']).toBeDefined()
    expect(lock.packages['/root.assets@1.0.0']).toBeDefined()
    expect(lock.packages['/root.pack@1.0.0']?.source).toBe('workspace:@demo/root-pack#pack.json')
    expect(lock.packages['/root.assets@1.0.0']?.source).toBe('workspace:@demo/root-pack#assets.json')
    expect(Object.keys(lock.packages)).toHaveLength(3)
    await rm(dir, { recursive: true, force: true })
  })
})
