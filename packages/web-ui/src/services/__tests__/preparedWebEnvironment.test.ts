import { beforeEach, expect, it, vi } from 'vitest'
import { environmentVersion, gameplayRevision } from '@arcadia-eternity/pack-loader/native'
import { readEnvironmentJson } from '../serverEnvironment'
import { readBuiltinWebEnvironment, readPreparedWebCatalog } from '../preparedWebEnvironment'

vi.mock('../serverEnvironment', () => ({ readEnvironmentJson: vi.fn() }))
const identity = {
  kind: 'native-v4',
  contentRevision: 'revision',
  coreBuildId: 'core',
  registryBuildId: 'registry',
} as const
const material = 'revision/effects:' + 'a'.repeat(64)
const rules = { schemaVersion: 1 }
const catalog = { rules, content: { species: [], skills: [], marks: [] }, resources: [], runtimeRevision: material }
beforeEach(() => vi.mocked(readEnvironmentJson).mockReset())

it('reconstructs the same gameplay revision from a legacy paired distribution', async () => {
  vi.mocked(readEnvironmentJson)
    .mockResolvedValueOnce({ ...catalog })
    .mockResolvedValueOnce({ build: identity })
  expect((await readPreparedWebCatalog(true)).gameplayRevision).toBe(await gameplayRevision(identity, material, rules))
})

it('rejects a stale gameplay revision on the current catalog format', async () => {
  vi.mocked(readEnvironmentJson).mockResolvedValueOnce({
    ...catalog,
    runtimeIdentity: identity,
    gameplayRevision: '0'.repeat(64),
  })
  await expect(readPreparedWebCatalog(true)).rejects.toThrow('玩法版本不符')
})

it('rejects a presentation from a different version with unchanged gameplay', async () => {
  const gameplay = await gameplayRevision(identity, material, rules)
  vi.mocked(readEnvironmentJson).mockResolvedValueOnce({
    ...catalog,
    runtimeIdentity: identity,
    gameplayRevision: gameplay,
    presentationRevision: 'new-media',
    environmentVersion: environmentVersion(gameplay, 'old-media'),
  })
  await expect(readPreparedWebCatalog(true)).rejects.toThrow('展示材料与版本不符')
})

it('uses the selected definition’s own material and verifies its rules against that material', async () => {
  const otherIdentity = { ...identity, contentRevision: 'other' }
  const otherMaterial = 'other-runtime'
  const selectedRules = { schemaVersion: 2 as const, mechanics: { individualValues: { max: 90 } } }
  const selectedRevision = await gameplayRevision(otherIdentity, otherMaterial, selectedRules)
  const entry = {
    id: 'other',
    name: 'Other',
    material: 'environment/other',
    rules: selectedRules,
    gameplayRevision: selectedRevision,
  }
  vi.mocked(readEnvironmentJson)
    .mockResolvedValueOnce({
      ...catalog,
      runtimeIdentity: identity,
      gameplayRevision: await gameplayRevision(identity, material, rules),
      defaultEnvironment: 'main',
      builtins: [{ ...entry, id: 'main', material: 'environment' }, entry],
    })
    .mockResolvedValueOnce({
      ...catalog,
      runtimeIdentity: otherIdentity,
      runtimeRevision: otherMaterial,
      gameplayRevision: await gameplayRevision(otherIdentity, otherMaterial, rules),
    })
  await readPreparedWebCatalog(true)
  expect(await readBuiltinWebEnvironment('other')).toMatchObject({
    rules: selectedRules,
    gameplayRevision: selectedRevision,
    runtimeRevision: otherMaterial,
  })
  expect(vi.mocked(readEnvironmentJson).mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
    '/environment/catalog.json',
    '/environment/other/catalog.json',
  ])
})
