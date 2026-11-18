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
  importTeam?(): void | Promise<void>
  exportTeam?(team: PetSchemaType[]): void
  warehouse?: {
    pets: Readonly<Ref<readonly PetSchemaType[]>>
    teamsUsing(id: string): readonly { id: string; name: string }[]
    replace(current: string, next: string): boolean
  }
  affected?: Readonly<Ref<string[]>>
  save?(scope?: 'original' | 'copy'): boolean | void | Promise<boolean | void>
  saveLabel?: string
  clearLabel?: string
  clear?(): Promise<boolean>
}
