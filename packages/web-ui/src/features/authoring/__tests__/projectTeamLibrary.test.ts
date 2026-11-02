import { expect, it, vi } from 'vitest'
import type { PlayerSchemaType } from '@arcadia-eternity/schema'
import type { ProjectTeam, ProjectTeamStorage, ProjectTeamDraft } from '@/components/team/library'
import { createBrowserTeamStorage } from '../browserTeamStorage'
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
  const bridge: ProjectTeamStorage = {
    list: vi.fn(async () => structuredClone(files)),
    readDraft: vi.fn(async () => structuredClone(draft)),
    writeDraft: vi.fn(async input => {
      draft = structuredClone(input)
    }),
    files: {
      save: vi.fn(async input => {
        const index = files.findIndex(entry => entry.id === input.document.id)
        if ((files[index]?.version ?? null) !== input.expectedVersion) throw new Error('REVISION_CONFLICT')
        const result = { ...structuredClone(input.document), version: `v${Math.random()}` }
        if (index < 0) files.push(result)
        else files[index] = result
        return result
      }),
      remove: vi.fn(async input => {
        const index = files.findIndex(entry => entry.id === input.id)
        if (files[index]?.version !== input.expectedVersion) throw new Error('REVISION_CONFLICT')
        files.splice(index, 1)
      }),
    },
  }
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
  expect(await bridge.list()).toEqual([])
  first.selectors[1]!.selected.value = first.selected.value[0]
  first.editors[0]!.team.value[0]!.level = 65
  first.editors[0]!.persist()
  expect(first.players.value[1]!.team[0]!.level).toBe(65)
  await first.flush()
  const reopened = await createProjectTeamLibrary(bridge, defaults)
  expect(reopened.players.value[0]!.team[0]!.level).toBe(65)
  expect(reopened.selected.value[0]).toBe(reopened.selected.value[1])
  await reopened.files!.save(0)
  const file = (await bridge.list())[0]!
  expect(file.team[0]).not.toHaveProperty('id')
  expect(reopened.current(0).dirty).toBe(false)
  reopened.editors[0]!.persist()
  expect(reopened.current(0).dirty).toBe(false)
  reopened.create(0, true)
  expect(reopened.entries.value).toHaveLength(3)
  expect(reopened.current(0).id).not.toBe(file.id)
  await reopened.files!.remove(0)
  expect(reopened.entries.value).toHaveLength(2)
})
it('retains dirty bases after Git edits and offers explicit reload instead of silent overwrite', async () => {
  const fixtureData = fixture()
  const library = await createProjectTeamLibrary(fixtureData.bridge, defaults)
  await library.files!.save(0)
  library.rename(library.selected.value[0], 'local draft')
  await library.flush()
  fixtureData.external()
  const reopened = await createProjectTeamLibrary(fixtureData.bridge, defaults)
  expect(reopened.current(0).name).toBe('local draft')
  await expect(reopened.files!.save(0)).rejects.toThrow('REVISION_CONFLICT')
  expect(reopened.current(0).name).toBe('local draft')
  await reopened.files!.reload(0)
  expect(reopened.current(0).name).toBe('Git team')
})

it('can add pets to an entirely empty project library from the prepared catalog', async () => {
  const { bridge } = fixture()
  const empty = defaults.map(player => ({ ...player, team: [] }))
  const library = await createProjectTeamLibrary(bridge, empty, () => structuredClone(defaults[0]!.team[0]!))
  expect(library.editors[0]!.createPet()?.species).toBe('sample:pet')
})

it('uses the same library in browsers with isolated drafts and no project file capabilities', async () => {
  localStorage.clear()
  localStorage.setItem('petStorage', 'personal-data')
  const { bridge } = fixture(),
    desktop = await createProjectTeamLibrary(bridge, defaults)
  await desktop.files!.save(0)
  const saved = await bridge.list()
  const first = await createProjectTeamLibrary(createBrowserTeamStorage(saved, 'project-a'), defaults)
  expect(first.files).toBeUndefined()
  first.editors[0]!.team.value[0]!.level = 65
  await first.flush()
  const reopened = await createProjectTeamLibrary(createBrowserTeamStorage(saved, 'project-a'), defaults)
  const separate = await createProjectTeamLibrary(createBrowserTeamStorage(saved, 'project-b'), defaults)
  expect(reopened.players.value[0]!.team[0]!.level).toBe(65)
  expect(separate.players.value[0]!.team[0]!.level).toBe(100)
  expect(localStorage.getItem('petStorage')).toBe('personal-data')
  expect((await bridge.list())[0]!.team[0]!.level).toBe(100)
})

it('renames a captured team identity even if the selected side changes before confirmation', async () => {
  const { bridge } = fixture(),
    library = await createProjectTeamLibrary(bridge, defaults)
  const id = library.selected.value[0]
  library.selectors[0]!.selected.value = library.selected.value[1]
  library.rename(id, 'Renamed team')
  expect(library.entries.value.find(entry => entry.id === id)?.name).toBe('Renamed team')
  expect(library.current(0).name).toBe(defaults[1]!.name)
})
