import { nanoid } from 'nanoid'
import type { PetSchemaType } from '@arcadia-eternity/schema'

export const MAX_STORED_TEAM_MEMBERS = 100

export interface PetOrigin {
  name: string
  version: string
}
export interface ShareablePet extends PetSchemaType {
  origin?: PetOrigin
}
export interface TeamSelection {
  name: string
  ruleSetId: string
  pets: ShareablePet[]
}

export interface OwnedPet extends ShareablePet {
  revision: number
}

export interface EnvironmentPreference {
  source: string
  environmentId: string
}
export interface PersonalTeam {
  environmentPreference?: EnvironmentPreference
  id: string
  name: string
  ruleSetId: string
  revision: number
  memberIds: string[]
}

export interface PersonalLibrary {
  version: 2
  storage: OwnedPet[]
  teams: PersonalTeam[]
  currentTeamIndex: number
}

export interface EmbeddedLibrary {
  storage: PetSchemaType[]
  teams: TeamSelection[]
  currentTeamIndex: number
}

/** Every old location owned its build, including equal builds with colliding IDs in different teams. */
export function migrateEmbeddedLibrary(old: EmbeddedLibrary): PersonalLibrary {
  const reserved = new Set(old.storage.map(pet => pet.id))
  for (const team of old.teams) for (const pet of team.pets) reserved.add(pet.id)
  const seen = new Set<string>()
  const storage: OwnedPet[] = []
  let counter = 0
  function own(pet: PetSchemaType) {
    let id = pet.id
    if (seen.has(id)) {
      do {
        id = 'p' + (++counter).toString(36).padStart(20, '0')
      } while (reserved.has(id))
    }
    seen.add(id)
    storage.push({ ...structuredClone(pet), id, revision: 1 })
    return id
  }
  old.storage.forEach(own)
  const teams = old.teams.map((team, index) => ({
    id: 't' + index.toString(36).padStart(20, '0'),
    name: team.name,
    ruleSetId: team.ruleSetId,
    revision: 1,
    memberIds: team.pets.map(own),
  }))
  return { version: 2, storage, teams, currentTeamIndex: old.currentTeamIndex }
}

/** Export and battle inputs carry independent selections with no dependency on this profile. */
export function expandTeam(library: PersonalLibrary, index: number): TeamSelection {
  const team = library.teams[index]
  if (!team) throw new Error('队伍不存在')
  const owned = new Map(library.storage.map(pet => [pet.id, pet]))
  return {
    name: team.name,
    ruleSetId: team.ruleSetId,
    pets: team.memberIds.map(id => {
      const pet = owned.get(id)
      if (!pet) throw new Error(`队伍 ${team.name} 缺少仓库精灵 ${id}`)
      const { revision: _revision, origin: _origin, ...selection } = pet
      return structuredClone(selection)
    }),
  }
}

export function newPersonalTeam(name: string, ruleSetId: string): PersonalTeam {
  return { id: nanoid(), name, ruleSetId, revision: 1, memberIds: [] }
}
