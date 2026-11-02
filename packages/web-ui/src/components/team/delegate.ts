import type { Ref } from 'vue'
import type { PetSchemaType } from '@arcadia-eternity/schema'

/** Storage and optional actions belong to the caller, never to the editor UI. */
export interface TeamEditorDelegate {
  team: Ref<PetSchemaType[]>
  name: Readonly<Ref<string>>
  ready: Readonly<Ref<boolean>>
  persist(): void
  createPet(): PetSchemaType | undefined
  removePet(id: string, onRemoved: () => void): void | Promise<void>
  removeLabel?: string
  subtitle?: Readonly<Ref<string>>
  storageRoute?: string
  moveToStorage?(id: string, onRemoved: () => void): void
  importTeam?(): void | Promise<void>
  exportTeam?(team: PetSchemaType[]): void
  save?(): boolean | void
  clearLabel?: string
  clear?(): Promise<boolean>
}
