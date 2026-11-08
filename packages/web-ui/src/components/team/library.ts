import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { Ref } from 'vue'

export interface TeamDocument {
  schemaVersion: 1
  id: string
  name: string
  team: Omit<PetSchemaType, 'id'>[]
}
export interface ProjectTeam extends TeamDocument {
  version: string | null
}
export interface TeamDraft extends ProjectTeam {
  dirty: boolean
}
export interface ProjectTeamDraft {
  schemaVersion: 1
  entries: TeamDraft[]
  selected: [string, string]
  names: [string, string]
}
interface ProjectTeamFiles {
  save(input: { document: TeamDocument; expectedVersion: string | null }): Promise<ProjectTeam>
  remove(input: { id: string; expectedVersion: string }): Promise<void>
}
export interface ProjectTeamStorage {
  list(): Promise<ProjectTeam[]>
  readDraft(): Promise<ProjectTeamDraft | null>
  writeDraft(draft: ProjectTeamDraft): Promise<void>
  files?: ProjectTeamFiles
}
/** Selection belongs to the caller's library, while editing continues through TeamEditorDelegate. */
export interface TeamLibraryDelegate {
  entries: Readonly<Ref<{ id: string; name: string; size: number }[]>>
  selected: Ref<string>
}
