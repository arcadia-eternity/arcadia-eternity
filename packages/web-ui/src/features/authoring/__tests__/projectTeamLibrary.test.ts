import { expect, it, vi } from 'vitest'
import type { PlayerSchemaType } from '@arcadia-eternity/schema'
import type { ProjectTeam, ProjectTeamBridge, ProjectTeamDraft, TeamDocument } from '@/components/team/library'
import { createProjectTeamLibrary } from '../projectTeamLibrary'

const defaults = [0, 1].map(side => ({
  id: String(side).repeat(21),
  name: `Side ${side}`,
  team: [
    {
      id: String(side + 2).repeat(21),
      name: 'Pet',
      species: 'sample:pet',
      level: 100,
      nature: 'Hardy',
      skills: ['sample:hit'],
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    },
  ],
})) as PlayerSchemaType[]
function fixture() {
  const files: ProjectTeam[] = []
  let draft: ProjectTeamDraft | null = null
  const bridge = vi.fn(async (action: string, input?: unknown) => {
    if (action === 'list') return structuredClone(files)
    if (action === 'draft-read') return structuredClone(draft)
    if (action === 'draft-write') {
      draft = structuredClone(input) as ProjectTeamDraft
      return
    }
    const change = input as { document?: TeamDocument; id?: string; expectedVersion: string | null }
    const index = files.findIndex(entry => entry.id === (change.document?.id ?? change.id))
    if ((files[index]?.version ?? null) !== change.expectedVersion) throw new Error('REVISION_CONFLICT')
    if (action === 'remove') {
      files.splice(index, 1)
      return
    }
    const result = { ...structuredClone(change.document!), version: `v${Math.random()}` }
    if (index < 0) files.push(result)
    else files[index] = result
    return result
  }) as unknown as ProjectTeamBridge
  return {
    bridge,
    external: () => {
      files[0]!.version = 'external'
      files[0]!.name = 'Git team'
    },
  }
}
it('shares a library across sides, persists drafts across new candidates and saves portable files explicitly', async () => {
  const { bridge } = fixture()
  const first = await createProjectTeamLibrary(bridge, defaults)
  expect(await bridge('list')).toEqual([])
  first.selectors[1]!.selected.value = first.selected.value[0]
  first.editors[0]!.team.value[0]!.level = 65
  first.editors[0]!.persist()
  expect(first.players.value[1]!.team[0]!.level).toBe(65)
  await first.flush()
  const reopened = await createProjectTeamLibrary(bridge, defaults)
  expect(reopened.players.value[0]!.team[0]!.level).toBe(65)
  expect(reopened.selected.value[0]).toBe(reopened.selected.value[1])
  await reopened.save(0)
  const file = (await bridge('list'))[0]!
  expect(file.team[0]).not.toHaveProperty('id')
  expect(reopened.current(0).dirty).toBe(false)
  reopened.editors[0]!.persist()
  expect(reopened.current(0).dirty).toBe(false)
  reopened.create(0, true)
  expect(reopened.entries.value).toHaveLength(3)
  expect(reopened.current(0).id).not.toBe(file.id)
  await reopened.remove(0)
  expect(reopened.entries.value).toHaveLength(2)
})
it('retains dirty bases after Git edits and offers explicit reload instead of silent overwrite', async () => {
  const fixtureData = fixture()
  const library = await createProjectTeamLibrary(fixtureData.bridge, defaults)
  await library.save(0)
  library.rename(0, 'local draft')
  await library.flush()
  fixtureData.external()
  const reopened = await createProjectTeamLibrary(fixtureData.bridge, defaults)
  expect(reopened.current(0).name).toBe('local draft')
  await expect(reopened.save(0)).rejects.toThrow('REVISION_CONFLICT')
  expect(reopened.current(0).name).toBe('local draft')
  await reopened.reload(0)
  expect(reopened.current(0).name).toBe('Git team')
})
