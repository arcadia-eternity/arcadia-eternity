import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { resolve } from 'node:path'
import {
  ContentPresentationSchema,
  parseWithErrors,
  type ContentPresentation,
  type PresentationManifest,
  type PresentationResource,
} from '@arcadia-eternity/schema'
import type { InstalledNpmPackage } from './inspect'
import { packageFile } from './inspect'

export interface PreparedPresentation {
  projectId: string
  namespace: string
  manifest: PresentationManifest
  resources: (Extract<PresentationResource, { kind: 'file' }> & { file: string })[]
}

/** Validate package files in place. HTTP references stay URLs; no remote request or resource cache is created. */
export async function preparePresentation(
  root: string,
  packages: readonly InstalledNpmPackage[],
): Promise<PreparedPresentation[]> {
  const output: PreparedPresentation[] = []
  const byLocation = new Map(packages.map(pkg => [pkg.location, pkg]))
  const byNamespace = new Map(packages.filter(pkg => pkg.manifest).map(pkg => [pkg.manifest!.namespace, pkg]))
  for (const pkg of packages) {
    if (!pkg.manifest || !pkg.draft) continue
    const accessible = new Set<string>()
    function visit(dependency: InstalledNpmPackage) {
      if (accessible.has(dependency.location)) return
      accessible.add(dependency.location)
      for (const location of Object.values(dependency.dependencies)) {
        const next = byLocation.get(location)
        if (next) visit(next)
      }
    }
    visit(pkg)
    for (const [language, namespaces] of Object.entries(pkg.presentation?.locales ?? {}))
      for (const [namespace, entries] of Object.entries(namespaces)) {
        const kind = {
          species: 'species',
          skill: 'skills',
          mark: 'marks',
          mark_ability: 'marks',
          mark_emblem: 'marks',
          mark_global: 'marks',
        }[namespace] as 'species' | 'skills' | 'marks' | undefined
        if (!kind) throw new Error(`LOCALE_NAMESPACE: ${language}/${namespace}`)
        for (const [id, entry] of Object.entries(entries)) {
          if (!pkg.draft.data[kind].some(record => record.id === id))
            throw new Error(`LOCALE_REFERENCE: ${language}/${namespace}/${id}`)
          if (
            !entry ||
            typeof entry !== 'object' ||
            Array.isArray(entry) ||
            Object.entries(entry).some(
              ([field, value]) => !['name', 'description'].includes(field) || typeof value !== 'string',
            )
          )
            throw new Error(`LOCALE_FORMAT: ${language}/${namespace}/${id}`)
        }
      }
    function check(ref: unknown) {
      const namespace = typeof ref === 'string' ? pkg.manifest!.namespace : (ref as { namespace: string }).namespace
      const id = typeof ref === 'string' ? ref : (ref as { path: string }).path
      const provider = byNamespace.get(namespace)
      if (
        !provider ||
        !accessible.has(provider.location) ||
        !provider.presentation?.resources.some(asset => asset.id === id)
      )
        throw new Error(`RESOURCE_REFERENCE: ${pkg.manifest!.namespace} references unavailable ${namespace}/${id}`)
    }
    for (const records of [pkg.draft.data.species, pkg.draft.data.skills, pkg.draft.data.marks])
      for (const record of records) {
        if (!record.presentation) continue
        const presentation = parseWithErrors(ContentPresentationSchema, record.presentation) as ContentPresentation
        for (const [key, value] of Object.entries(presentation)) {
          if (key === 'battle') {
            check(presentation.battle!.source)
            if (presentation.battle!.fallback) check(presentation.battle!.fallback)
          } else check(value)
        }
      }
  }
  for (const pkg of packages) {
    if (!pkg.presentation || !pkg.manifest) continue
    const resources: PreparedPresentation['resources'] = []
    for (const resource of pkg.presentation.resources) {
      if (resource.kind === 'http') continue
      const file = packageFile(resolve(root, pkg.location), resource.source)
      const hash = createHash('sha256')
      let bytes = 0
      for await (const chunk of createReadStream(file)) {
        bytes += chunk.length
        if (bytes > resource.bytes) throw new Error(`RESOURCE_INTEGRITY: ${resource.id} exceeds declared size`)
        hash.update(chunk)
      }
      if (bytes !== resource.bytes || hash.digest('hex') !== resource.sha256)
        throw new Error(`RESOURCE_INTEGRITY: ${resource.id}`)
      resources.push({ ...resource, file })
    }
    output.push({
      projectId: pkg.manifest.projectId,
      namespace: pkg.manifest.namespace,
      manifest: pkg.presentation,
      resources,
    })
  }
  return output
}
