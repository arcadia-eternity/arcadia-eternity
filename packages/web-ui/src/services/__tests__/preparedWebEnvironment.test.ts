import { beforeEach, expect, it, vi } from 'vitest'
import { gameplayRevision } from '@arcadia-eternity/pack-loader/native'
import { readEnvironmentJson } from '../serverEnvironment'
import { readPreparedWebCatalog } from '../preparedWebEnvironment'

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
