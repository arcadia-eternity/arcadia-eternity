import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoad = vi.fn()

vi.mock('../src/pack/serverPackManager', () => {
  return {
    serverPackManager: { load: mockLoad },
  }
})

describe('ResourceLoadingManager', () => {
  beforeEach(async () => {
    mockLoad.mockReset()
    const { ResourceLoadingManager } = await import('../src/resourceLoadingManager')
    ResourceLoadingManager.getInstance().reset()
  })

  it('marks ready when pack load succeeds', async () => {
    const metadata = { species: [], skills: [], marks: [] }
    mockLoad.mockResolvedValue({
      data: metadata,
      errors: [],
      source: 'node-fs',
      packRef: 'builtin:base',
    })

    const { ResourceLoadingManager, ResourceLoadingStatus } = await import('../src/resourceLoadingManager')
    const manager = ResourceLoadingManager.getInstance()
    await manager.startAsyncLoading({ validateData: true, continueOnError: false })

    expect(manager.isReady()).toBe(true)
    expect(manager.getProgress().status).toBe(ResourceLoadingStatus.Completed)
    expect(manager.getLoadedMetadata()).toBe(metadata)
    expect(manager.getProgress().scriptsLoaded).toBe(true)
    expect(mockLoad).toHaveBeenCalledWith('builtin:workspace', { enforceLockfile: true })
  })

  it('fails when validation is enabled and pack load has errors', async () => {
    mockLoad.mockResolvedValue({
      data: { species: [], skills: [], marks: [] },
      errors: ['bad ref'],
      source: 'node-fs',
      packRef: 'builtin:base',
    })

    const { ResourceLoadingManager, ResourceLoadingStatus } = await import('../src/resourceLoadingManager')
    const manager = ResourceLoadingManager.getInstance()
    await expect(manager.startAsyncLoading({ validateData: true, continueOnError: false })).rejects.toThrow(
      '数据包校验失败',
    )

    expect(manager.isReady()).toBe(false)
    expect(manager.getProgress().status).toBe(ResourceLoadingStatus.Failed)
    expect(manager.getLoadedMetadata()).toBeNull()
  })

  it('does not expose metadata when native reference validation fails', async () => {
    mockLoad.mockRejectedValue(new Error('Unknown content effect: effect_missing'))
    const { ResourceLoadingManager, ResourceLoadingStatus } = await import('../src/resourceLoadingManager')
    const manager = ResourceLoadingManager.getInstance()
    await expect(manager.startAsyncLoading({ continueOnError: false })).rejects.toThrow('Unknown content effect')
    expect(manager.getLoadedMetadata()).toBeNull()
    expect(manager.getProgress().status).toBe(ResourceLoadingStatus.Failed)
    expect(manager.getProgress().scriptsLoaded).toBe(false)
  })
})
