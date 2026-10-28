import type { MarkSchemaType, SkillSchemaType, SpeciesSchemaType, ContentPresentation } from '@arcadia-eternity/schema'
import type { NativeRuntimeIdentity } from './session'

/** Server execution identity. A browser acknowledges this; it does not independently load the code. */
export interface ServerEnvironmentDescriptor {
  id: string
  protocolVersion: 1
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
  marks: (Pick<MarkSchemaType, 'id' | 'iconRef' | 'tags'> & ContentDisplayText)[]
}

/** Client assertion of protocol/display readiness, never a code-admission credential. */
export interface ServerEnvironmentAcceptance {
  environmentId: string
  protocolVersion: 1
  resourceRevision: string
  resourcesReady: boolean
}
