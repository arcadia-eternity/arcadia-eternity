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
export interface ProjectTeamBridge {
  (action: 'list'): Promise<ProjectTeam[]>
  (action: 'save', input: { document: TeamDocument; expectedVersion: string | null }): Promise<ProjectTeam>
  (action: 'remove', input: { id: string; expectedVersion: string }): Promise<void>
  (action: 'draft-read'): Promise<ProjectTeamDraft | null>
  (action: 'draft-write', input: ProjectTeamDraft): Promise<void>
}
/** Selection belongs to the caller's library, while editing continues through TeamEditorDelegate. */
export interface TeamLibraryDelegate {
  entries: Readonly<Ref<{ id: string; name: string; size: number }[]>>
  selected: Ref<string>
}
