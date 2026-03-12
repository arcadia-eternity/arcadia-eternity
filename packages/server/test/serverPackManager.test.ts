import { mkdir, rm, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { PackLockfile } from '@arcadia-eternity/pack-loader'
import { ServerPackManager } from '../src/pack/serverPackManager'

const basePackLockfile = (): PackLockfile => ({
  lockfileVersion: 1,
  generatedAt: '2026-03-10T12:00:00.000Z',
  importers: {
    '.': {
      dependencies: {
        'arcadia-eternity.base': {
          specifier: 'workspace:@arcadia-eternity/data-pack-base#pack.json',
          version: '1.0.0',
          packageKey: '/arcadia-eternity.base@1.0.0',
        },
      },
    },
  },
  packages: {
    '/arcadia-eternity.base@1.0.0': {
      name: 'arcadia-eternity.base',
      version: '1.0.0',
      kind: 'data',
      engine: 'seer2-v2',
      source: 'workspace:@arcadia-eternity/data-pack-base#pack.json',
      entry: 'pack.json',
      provenance: 'workspace',
      dependencies: {
        'arcadia-eternity.base-assets': '/arcadia-eternity.base-assets@1.0.0',
      },
    },
    '/arcadia-eternity.base-assets@1.0.0': {
      name: 'arcadia-eternity.base-assets',
      version: '1.0.0',
      kind: 'asset',
      engine: 'seer2-v2',
      source: 'workspace:@arcadia-eternity/data-pack-base#assets.json',
      entry: 'assets.json',
      provenance: 'workspace',
      dependencies: {},
    },
  },
})

describe('ServerPackManager', () => {
  const manager = new ServerPackManager()

  it('lists installed base pack and assets', async () => {
    const installed = await manager.listInstalled()

    expect(installed.some(pack => pack.id === 'arcadia-eternity.base' && pack.kind === 'data')).toBe(true)
    expect(installed.some(pack => pack.id === 'arcadia-eternity.base-assets' && pack.kind === 'asset')).toBe(true)
  })

  it('verifies generated base lockfile against installed packages', async () => {
    const result = await manager.verify(basePackLockfile())

    expect(result.missing).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it('reports missing package when lockfile requires unavailable pack', async () => {
    const lockfile = basePackLockfile()
    lockfile.packages['/community.demo@1.0.0'] = {
      name: 'community.demo',
      version: '1.0.0',
      kind: 'data',
      engine: 'seer2-v2',
      source: 'npm:@community/demo',
      entry: 'pack.json',
      provenance: 'npm',
      dependencies: {},
    }

    const result = await manager.verify(lockfile)
    expect(result.missing.some(item => item.name === 'community.demo')).toBe(true)
  })

  it('installs package through injected runner and returns installed pack', async () => {
    const workspaceRoot = process.cwd()
    const packageRoot = `${workspaceRoot}/node_modules/@demo/server-pack`
    const packageJsonPath = `${packageRoot}/package.json`
    const packJsonPath = `${packageRoot}/pack.json`

    const runner = vi.fn(async () => {
      await mkdir(packageRoot, { recursive: true })
      await writeFile(
        packageJsonPath,
        JSON.stringify({
          name: '@demo/server-pack',
          arcadiaEternityPack: 'pack.json',
        }),
        'utf8',
      )
      await writeFile(
        packJsonPath,
        JSON.stringify({
          id: 'demo.server-pack',
          version: '1.0.0',
          engine: 'seer2-v2',
          data: { effects: [], marks: [], skills: [], species: [] },
        }),
        'utf8',
      )
    })

    const installManager = new ServerPackManager(workspaceRoot, runner)
    try {
      const installed = await installManager.install({
        source: 'npm',
        specifier: '@demo/server-pack',
      })

      expect(runner).toHaveBeenCalledWith('@demo/server-pack', workspaceRoot)
      expect(installed.packageName).toBe('@demo/server-pack')
      expect(installed.id).toBe('demo.server-pack')
      expect(installed.kind).toBe('data')
    } finally {
      await rm(packageRoot, { recursive: true, force: true })
    }
  })
})
