import type { MarkSchemaType, SkillSchemaType, SpeciesSchemaType } from '@arcadia-eternity/schema'
import type { NativeRuntimeIdentity } from './session'

/** Server execution identity. A browser acknowledges this; it does not independently load the code. */
export interface ServerEnvironmentDescriptor {
  id: string
  protocolVersion: 1
  runtime: NativeRuntimeIdentity
  packages: { name: string; version: string; projectId: string; namespace: string }[]
  resourceRevision: string
  resources: {
    projectId: string
    id: string
    variant: string
    sha256: string
    bytes: number
    mime: string
    url: string
  }[]
}

export interface ServerEnvironmentContent {
  species: SpeciesSchemaType[]
  skills: Omit<SkillSchemaType, 'effect'>[]
  marks: Pick<MarkSchemaType, 'id' | 'iconRef' | 'tags'>[]
}

/** Client assertion of protocol/display readiness, never a code-admission credential. */
export interface ServerEnvironmentAcceptance {
  environmentId: string
  protocolVersion: 1
  resourceRevision: string
  resourcesReady: boolean
}
