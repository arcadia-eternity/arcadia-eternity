import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoad = vi.fn()

vi.mock('@arcadia-eternity/pack-loader', () => {
  return {
    PackLoader: class {
      load = mockLoad
      summarize() {
        return {
          effectCount: 0,
          markCount: 0,
          skillCount: 0,
          speciesCount: 0,
          errorCount: 0,
        }
      }
    },
  }
})

vi.mock('@arcadia-eternity/data-repository', () => {
  return {
    ScriptLoader: class {
      constructor(_options: unknown) {}
      async loadScriptsFromFileSystem(_path: string): Promise<void> {}
      getLoadedScriptsStats() {
        return { total: 0, byType: { effect: 0, species: 0, skill: 0, mark: 0 } }
      }
    },
  }
})

describe('ResourceLoadingManager', () => {
  beforeEach(async () => {
    mockLoad.mockReset()
    const { ResourceLoadingManager } = await import('../src/resourceLoadingManager')
    ResourceLoadingManager.getInstance().reset()
  })

  it('marks ready when pack load succeeds', async () => {
    const fakeRepo = { stats: () => ({ effects: 1, marks: 1, skills: 1, species: 1 }) }
    mockLoad.mockResolvedValue({
      repository: fakeRepo,
      errors: [],
      source: 'node-fs',
      packRef: 'builtin:base',
    })

    const { ResourceLoadingManager, ResourceLoadingStatus } = await import('../src/resourceLoadingManager')
    const manager = ResourceLoadingManager.getInstance()
    await manager.startAsyncLoading({ validateData: true, continueOnError: false })

    expect(manager.isReady()).toBe(true)
    expect(manager.getProgress().status).toBe(ResourceLoadingStatus.Completed)
    expect(manager.getLoadedRepository()).toBe(fakeRepo)
  })

  it('fails when validation is enabled and pack load has errors', async () => {
    const fakeRepo = { stats: () => ({ effects: 0, marks: 0, skills: 0, species: 0 }) }
    mockLoad.mockResolvedValue({
      repository: fakeRepo,
      errors: ['bad ref'],
      source: 'node-fs',
      packRef: 'builtin:base',
    })

    const { ResourceLoadingManager, ResourceLoadingStatus } = await import('../src/resourceLoadingManager')
    const manager = ResourceLoadingManager.getInstance()
    await expect(
      manager.startAsyncLoading({ validateData: true, continueOnError: false }),
    ).rejects.toThrow('数据包校验失败')

    expect(manager.isReady()).toBe(false)
    expect(manager.getProgress().status).toBe(ResourceLoadingStatus.Failed)
  })
})
