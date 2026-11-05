import type { MarkSchemaType, SkillSchemaType, SpeciesSchemaType, ContentPresentation } from '@arcadia-eternity/schema'
import type { NativeRuntimeIdentity } from './session'
import type { ManagedEnvironmentDocument } from './management'

export type EnvironmentRules = ManagedEnvironmentDocument['rules']

/** A fixed, player-owned recipe. The signaling server never acquires or executes its materials. */
export interface PersonalEnvironmentReference {
  kind: 'personal'
  protocolVersion: 1
  descriptor: ServerEnvironmentDescriptor
  rules?: EnvironmentRules
  source: { kind: 'file'; name: string } | { kind: 'https'; url: string }
}

/** Server execution identity. A browser acknowledges this; it does not independently load the code. */
export interface ServerEnvironmentDescriptor {
  id: string
  protocolVersion: 1
  /** Omitted by older servers. A peer-only listing must never be submitted for server execution. */
  executionPolicy?: 'server' | 'peer'
  /** Captured sandbox revision required before a client can acknowledge peer execution readiness. */
  peerRevision?: string
  runtime: NativeRuntimeIdentity
  packages: { name: string; version: string; projectId: string; namespace: string }[]
  resourceRevision: string
  remoteResources?: { projectId: string; id: string; url: string; mime?: string }[]
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

/** Optional author-provided names and Markdown descriptions for the active room environment. */
export interface ContentDisplayText {
  name?: string
  description?: string
  presentation?: ContentPresentation
}

export interface ServerContentLocales {
  defaultLocale: string
  bundles: Record<string, Record<string, Record<string, unknown>>>
}

export interface ServerEnvironmentContent {
  locales?: ServerContentLocales
  species: (SpeciesSchemaType & ContentDisplayText)[]
  skills: (Omit<SkillSchemaType, 'effect'> & ContentDisplayText)[]
  marks: (Pick<MarkSchemaType, 'id' | 'tags'> & ContentDisplayText)[]
}

/** Client assertion of protocol/display readiness, never a code-admission credential. */
export interface ServerEnvironmentAcceptance {
  environmentId: string
  protocolVersion: 1
  resourceRevision: string
  peerRevision?: string
  /** Personal-room preparation is invalidated by a host or configuration change. */
  challengeGeneration?: number
  /** Legacy wire name: public catalog and core display compatibility are ready; media remains on-demand. */
  resourcesReady: boolean
}
