import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as sdk from '@arcadia-eternity/battle/v4/authoring'
import type {
  BaseMark,
  BehaviorCatalogOptions,
  ContentCatalog,
  ContentPrototypeData,
  NativeBehaviorExport,
} from '@arcadia-eternity/battle/v4'
import { compileRelease, prepareWorkEnvironment } from '../works/compiler'
import { cloneJson, digestJson, fail, runtimeId, type Json, type WorkHost, type WorkRelease } from '../works/model'
import { inspectNpmProject, packageFile, type InstalledNpmPackage, type NpmProjectInspection } from './inspect'
import { captureNpmProject } from './capture'

export interface NpmEffectModuleContext {
  /** Use the host SDK so packages share its domain types and restoration registry. */
  readonly sdk: typeof sdk
  readonly marks: ReadonlyMap<string, BaseMark>
  readonly id: (localId: string) => string
}
export interface NpmEffectModule {
  readonly createEffects: (context: NpmEffectModuleContext) => readonly NativeBehaviorExport[]
}
export interface NpmContentHost extends Omit<WorkHost, 'createContent'> {
  readonly createContent: (
    data: ContentPrototypeData,
    revision: string,
    additional: BehaviorCatalogOptions,
  ) => ContentCatalog
}
export type PreparedNpmEnvironment = Awaited<ReturnType<typeof prepareWorkEnvironment>> & {
  readonly installation: NpmProjectInspection
  readAsset(hash: string): Uint8Array | undefined
  dispose(): Promise<void>
}

/** Host-only activation. The administrator admits the project; local file edits do not revoke that decision.
 * Each environment captures its package files. The caller disposes it after all its battles finish.
 * This API admits trusted code; it is not an arbitrary JavaScript sandbox.
 */
export async function prepareNpmProject(
  directory: string,
  host: NpmContentHost,
  approval: { policy: Readonly<Record<string, Json>>; /** Ignored for legacy callers. */ installationDigest?: string },
): Promise<Readonly<PreparedNpmEnvironment>> {
  const source = await realpath(directory)
  const original = await inspectNpmProject(source)
  const captured = await captureNpmProject(source, original)
  try {
    const inspected = await inspectNpmProject(captured.root)
    if (inspected.digest !== original.digest)
      fail('NPM_CHANGED', 'node_modules', 'The installed dependency graph changed while capturing the environment')
    // Relocation only changes private npm source paths. Audit the administrator's original lockfile.
    const installation = Object.freeze({ ...inspected, lockfileDigest: original.lockfileDigest })
    return Object.freeze({
      ...(await compileInstallation(captured.root, host, installation, approval.policy)),
      dispose: captured.dispose,
    })
  } catch (error) {
    await captured.dispose()
    throw error
  }
}

async function compileInstallation(
  root: string,
  host: NpmContentHost,
  installation: NpmProjectInspection,
  policyInput: Readonly<Record<string, Json>>,
) {
  const policy = cloneJson(policyInput)
  const contentPackages = installation.packages.filter(pkg => pkg.manifest)
  if (!contentPackages.length) fail('NPM_CONTENT_MISSING', 'dependencies', 'No installed Arcadia content packages')
  const build = Object.freeze({
    ...host.build,
    registryBuildId: await digestJson({
      host: host.build.registryBuildId,
      installation: installation.digest,
    }),
  })
  const modules = new Map<string, NpmEffectModule>()
  for (const pkg of contentPackages) {
    if (!pkg.manifest!.effects) continue
    const file = packageFile(resolve(root, pkg.location), pkg.manifest!.effects!)
    const module: unknown = await import(pathToFileURL(file).href)
    if (!module || typeof module !== 'object' || typeof Reflect.get(module, 'createEffects') !== 'function')
      fail('NPM_EXPORT', pkg.location, 'Effect module must export createEffects(context)')
    modules.set(pkg.location, module as NpmEffectModule)
  }
  const combinedHost: WorkHost = {
    ...host,
    build,
    allowedExports: [
      ...(host.allowedExports ?? host.templates.map(def => def.implementation.exportId)),
      ...contentPackages.flatMap(pkg =>
        pkg.manifest!.exports.map(entry => runtimeId(pkg.manifest!.namespace, entry.id)),
      ),
    ],
    createContent(data, revision) {
      const usedExports = new Set(
        (data.behaviors ?? []).map(raw => (raw as { implementation: { exportId: string } }).implementation.exportId),
      )
      return host.createContent(data, revision, ({ marks }) => ({
        nativeExports: contentPackages.flatMap(pkg => {
          const manifest = pkg.manifest!
          if (
            !manifest.effects ||
            !manifest.exports.some(entry => usedExports.has(runtimeId(manifest.namespace, entry.id)))
          )
            return []
          const exports = modules
            .get(pkg.location)!
            .createEffects({ sdk, marks, id: id => runtimeId(manifest.namespace, id) })
          if (!Array.isArray(exports) || exports.length !== manifest.exports.length)
            fail('NPM_EXPORT', pkg.location, 'Module exports differ from declared effects')
          const seen = new Set<string>()
          for (const effect of exports) {
            const declaration = manifest.exports.find(entry => runtimeId(manifest.namespace, entry.id) === effect?.id)
            if (
              !declaration ||
              seen.has(effect.id) ||
              effect.sourceKind !== declaration.sourceKind ||
              !effect.parameters ||
              typeof effect.parameters !== 'object' ||
              Object.keys(effect.parameters).length
            )
              fail('NPM_EXPORT', pkg.location, 'Unknown, duplicated or incompatible code effect export')
            seen.add(effect.id)
          }
          return exports
        }),
      }))
    },
  }
  const byLocation = new Map(installation.packages.map(pkg => [pkg.location, pkg]))
  const releases = new Map<string, WorkRelease>(),
    visiting = new Set<string>()
  const assetBytes = new Map<string, Uint8Array>()
  // npm resolves ordinary library versions. Only content registrations participate in the game dependency graph.
  function contentDependencies(pkg: InstalledNpmPackage): InstalledNpmPackage[] {
    const found = new Map<string, InstalledNpmPackage>(),
      visited = new Set<string>()
    function visit(location: string) {
      if (visited.has(location)) return
      visited.add(location)
      const dep = byLocation.get(location)
      if (!dep) fail('NPM_TREE', location, 'Dependency missing from inspected tree')
      if (dep.manifest) {
        found.set(location, dep)
        return
      }
      for (const child of Object.values(dep.dependencies)) visit(child)
    }
    for (const location of Object.values(pkg.dependencies)) visit(location)
    return [...found.values()]
  }
  async function compile(pkg: InstalledNpmPackage): Promise<WorkRelease> {
    const existing = releases.get(pkg.location)
    if (existing) return existing
    if (visiting.has(pkg.location)) fail('DEPENDENCY_CYCLE', pkg.location, 'Content packages form a registration cycle')
    visiting.add(pkg.location)
    const dependencies: WorkRelease[] = []
    for (const dep of contentDependencies(pkg)) dependencies.push(await compile(dep))
    const draft = cloneJson(pkg.draft!),
      manifest = pkg.manifest!
    for (const effect of manifest.exports) {
      draft.data.behaviors.push({
        ...sdk.codeEffectDefinition({ ...effect, id: runtimeId(manifest.namespace, effect.id) }),
        id: effect.id,
      })
      draft.requirements.push({
        exportId: runtimeId(manifest.namespace, effect.id),
        registryBuildId: build.registryBuildId,
      })
    }
    draft.dependencies = dependencies.map(dep => ({
      projectId: dep.project.id,
      version: dep.releaseVersion,
      digest: dep.digest,
    }))
    const blobs: Record<string, Uint8Array> = {}
    for (const [hash, file] of Object.entries(manifest.assets)) {
      blobs[hash] = await readFile(packageFile(resolve(root, pkg.location), file))
      assetBytes.set(hash, blobs[hash])
    }
    const release = await compileRelease(draft, pkg.version, combinedHost, [...releases.values()], blobs)
    visiting.delete(pkg.location)
    releases.set(pkg.location, release)
    return release
  }
  for (const pkg of contentPackages) await compile(pkg)
  const prepared = await prepareWorkEnvironment(combinedHost, [...releases.values()], [], {
    ...policy,
    npmInstallation: installation.digest,
  })
  return Object.freeze({ ...prepared, installation, readAsset: (hash: string) => assetBytes.get(hash)?.slice() })
}
