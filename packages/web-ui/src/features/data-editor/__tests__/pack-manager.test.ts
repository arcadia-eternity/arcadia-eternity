import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkspacePackSummary } from '@/services/packWorkspace'

vi.mock('@/services/packWorkspace', () => ({
  listWorkspacePacks: vi.fn(),
  setWorkspacePackEnabled: vi.fn().mockResolvedValue(undefined),
  readWorkspacePackManifest: vi.fn(),
  writeWorkspacePackManifest: vi.fn(),
  readWorkspacePackFile: vi.fn(),
  writeWorkspacePackFile: vi.fn(),
  listWorkspacePackFiles: vi.fn(),
  deleteWorkspacePackPath: vi.fn(),
  renameWorkspacePackPath: vi.fn(),
  createWorkspacePackFolder: vi.fn(),
  createPackFromTemplate: vi.fn(),
  resolveWorkspaceFileUrl: vi.fn(),
  listPackTemplates: vi.fn(),
}))

vi.mock('@/utils/env', () => ({
  isDesktop: false,
  getDesktopApi: () => null,
}))

const BASE_PACK: WorkspacePackSummary = {
  folderName: 'base',
  id: 'arcadia-eternity.base',
  version: '1.0.0',
  manifestPath: 'base/pack.json',
  enabled: true,
  canDisable: false,
}

const CUSTOM_PACK: WorkspacePackSummary = {
  folderName: 'my-pack',
  id: 'com.example.my-pack',
  version: '0.1.0',
  manifestPath: 'my-pack/pack.json',
  enabled: true,
  canDisable: true,
}

const DISABLED_PACK: WorkspacePackSummary = {
  folderName: 'disabled-pack',
  id: 'com.example.disabled',
  version: '0.2.0',
  manifestPath: 'disabled-pack/pack.json',
  enabled: false,
  canDisable: true,
}

function mapEnabledToFolderNames(packs: WorkspacePackSummary[]): string[] {
  return packs.filter(p => p.enabled).map(p => p.folderName)
}

describe('PackManagerTab – enabledPacks mapping', () => {
  let listWorkspacePacks: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('@/services/packWorkspace')
    listWorkspacePacks = (mod as { listWorkspacePacks: ReturnType<typeof vi.fn> }).listWorkspacePacks
  })

  it('refresh() → enabledPacks contains folder names (not pack IDs)', async () => {
    listWorkspacePacks.mockResolvedValue([BASE_PACK, CUSTOM_PACK])

    const packs = await listWorkspacePacks()
    const enabledPacks = mapEnabledToFolderNames(packs)

    expect(enabledPacks).toEqual(['base', 'my-pack'])
    expect(enabledPacks).toContain('base')
    expect(enabledPacks).not.toContain('arcadia-eternity.base')
    expect(enabledPacks).toContain('my-pack')
    expect(enabledPacks).not.toContain('com.example.my-pack')
  })

  it('refresh() → disabled packs are excluded from enabledPacks', async () => {
    listWorkspacePacks.mockResolvedValue([BASE_PACK, CUSTOM_PACK, DISABLED_PACK])

    const packs = await listWorkspacePacks()
    const enabledPacks = mapEnabledToFolderNames(packs)

    expect(enabledPacks).toEqual(['base', 'my-pack'])
    expect(enabledPacks).not.toContain('disabled-pack')
    expect(enabledPacks).not.toContain('com.example.disabled')
  })

  it('togglePack() → enabledPacks updates correctly after disable', async () => {
    const mutablePacks: WorkspacePackSummary[] = [{ ...BASE_PACK }, { ...CUSTOM_PACK }]
    listWorkspacePacks.mockResolvedValue(mutablePacks)

    const packs = await listWorkspacePacks()
    let enabledPacks = mapEnabledToFolderNames(packs)
    expect(enabledPacks).toEqual(['base', 'my-pack'])

    const packToToggle = packs.find(p => p.folderName === 'my-pack')!
    packToToggle.enabled = false
    enabledPacks = packs.filter(p => p.enabled).map(p => p.folderName)

    expect(enabledPacks).toEqual(['base'])
    expect(enabledPacks).not.toContain('my-pack')
  })

  it('togglePack() → re-enabling a pack restores it in enabledPacks', () => {
    const packs: WorkspacePackSummary[] = [{ ...BASE_PACK }, { ...CUSTOM_PACK, enabled: false }]

    let enabledPacks = mapEnabledToFolderNames(packs)
    expect(enabledPacks).toEqual(['base'])

    const packToToggle = packs.find(p => p.folderName === 'my-pack')!
    packToToggle.enabled = true
    enabledPacks = packs.filter(p => p.enabled).map(p => p.folderName)

    expect(enabledPacks).toEqual(['base', 'my-pack'])
  })
})
