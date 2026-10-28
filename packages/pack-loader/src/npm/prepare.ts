import { readFileSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as sdk from '@arcadia-eternity/battle/v4/authoring'
import type { CodeEffectModule } from '@arcadia-eternity/battle/v4/authoring'
import type { BehaviorCatalogOptions, ContentCatalog, ContentPrototypeData } from '@arcadia-eternity/battle/v4'
import { compileRelease, prepareWorkEnvironment } from '../works/compiler'
import { cloneJson, digestJson, fail, runtimeId, type Json, type WorkHost, type WorkRelease } from '../works/model'
import { inspectNpmProject, packageFile, type InstalledNpmPackage, type NpmProjectInspection } from './inspect'
import { captureNpmProject } from './capture'
import { preparePresentation, type PreparedPresentation } from './resources'

export interface NpmContentHost extends Omit<WorkHost, 'createContent'> {
  readonly createContent: (
    data: ContentPrototypeData,
    revision: string,
    additional: BehaviorCatalogOptions,
  ) => ContentCatalog
}
export type PreparedNpmEnvironment = Awaited<ReturnType<typeof prepareWorkEnvironment>> & {
  readonly installation: NpmProjectInspection
  presentation: PreparedPresentation[]
  assetFile(hash: string): string | undefined
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
  approval: { policy: Readonly<Record<string, Json>> },
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
      presentation: await preparePresentation(captured.root, installation.packages),
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
  // A content attachment already identifies the effect and its source kind. Do not ask
  // authors to repeat those declarations in package.json; the actual code is checked
  // when the admitted module receives the canonical mark prototypes below.
  const byProject = new Map(contentPackages.map(pkg => [pkg.manifest!.projectId, pkg]))
  const codeUses = new Map(contentPackages.map(pkg => [pkg.location, new Map<string, 'skill' | 'petMark'>()]))
  for (const consumer of contentPackages)
    for (const [collection, sourceKind] of [
      ['skills', 'skill'],
      ['marks', 'petMark'],
    ] as const)
      for (const record of consumer.draft!.data[collection])
        for (const use of Array.isArray(record.behaviors) ? record.behaviors : []) {
          if (!use || typeof use !== 'object' || Array.isArray(use)) continue
          const reference = use.definitionId
          if (!reference || typeof reference !== 'object' || Array.isArray(reference)) continue
          const ref = reference.$ref
          if (!ref || typeof ref !== 'object' || Array.isArray(ref) || ref.kind !== 'behavior') continue
          const provider = typeof ref.projectId === 'string' ? byProject.get(ref.projectId) : undefined
          if (!provider?.manifest!.effects || typeof ref.id !== 'string') continue
          if (provider.draft!.data.behaviors.some(definition => definition.id === ref.id)) continue
          runtimeId(provider.manifest!.namespace, ref.id)
          const uses = codeUses.get(provider.location)!
          if (uses.has(ref.id) && uses.get(ref.id) !== sourceKind)
            fail('NPM_EXPORT', ref.id, 'The same effect cannot serve both skill and petMark attachments')
          uses.set(ref.id, sourceKind)
        }
  const build = Object.freeze({
    ...host.build,
    registryBuildId: await digestJson({
      host: host.build.registryBuildId,
      installation: installation.digest,
    }),
  })
  const modules = new Map<string, CodeEffectModule>()
  for (const pkg of contentPackages) {
    if (!pkg.manifest!.effects) continue
    const file = packageFile(resolve(root, pkg.location), pkg.manifest!.effects!)
    const module: unknown = await import(pathToFileURL(file).href)
    if (!module || typeof module !== 'object' || typeof Reflect.get(module, 'createEffects') !== 'function')
      fail('NPM_EXPORT', pkg.location, 'Effect module must export createEffects(context)')
    modules.set(pkg.location, module as CodeEffectModule)
  }
  const combinedHost: WorkHost = {
    ...host,
    build,
    allowedExports: [
      ...(host.allowedExports ?? host.templates.map(def => def.implementation.exportId)),
      ...contentPackages.flatMap(pkg =>
        [...codeUses.get(pkg.location)!.keys(), ...pkg.draft!.data.behaviors.map(definition => definition.id)].map(id =>
          runtimeId(pkg.manifest!.namespace, id),
        ),
      ),
    ],
    createContent(data, revision) {
      const usedExports = new Set(
        (data.behaviors ?? []).map(raw => (raw as { implementation: { exportId: string } }).implementation.exportId),
      )
      return host.createContent(data, revision, ({ marks }) => ({
        nativeExports: contentPackages.flatMap(pkg => {
          const manifest = pkg.manifest!
          if (!manifest.effects || ![...usedExports].some(id => id.startsWith(`${manifest.namespace}:`))) return []
          const exports = modules
            .get(pkg.location)!
            .createEffects({ sdk, marks, id: id => runtimeId(manifest.namespace, id) })
          if (!Array.isArray(exports) || exports.length > 5000)
            fail('NPM_EXPORT', pkg.location, 'Expected a bounded array of code effects')
          const seen = new Set<string>()
          for (const effect of exports) {
            if (
              typeof effect?.id !== 'string' ||
              !effect.id.startsWith(`${manifest.namespace}:`) ||
              seen.has(effect.id) ||
              !effect.parameters ||
              typeof effect.parameters !== 'object' ||
              Object.keys(effect.parameters).length
            )
              fail('NPM_EXPORT', pkg.location, 'Unknown, duplicated or incompatible code effect export')
            seen.add(effect.id)
          }
          return exports.filter(effect => usedExports.has(effect.id))
        }),
      }))
    },
  }
  const byLocation = new Map(installation.packages.map(pkg => [pkg.location, pkg]))
  const releases = new Map<string, WorkRelease>(),
    visiting = new Set<string>()
  const assetFiles = new Map<string, string>()
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
    for (const [id, sourceKind] of codeUses.get(pkg.location)!) {
      draft.data.behaviors.push({
        ...sdk.codeEffectDefinition({ id: runtimeId(manifest.namespace, id), sourceKind }),
        id,
      })
      draft.requirements.push({
        exportId: runtimeId(manifest.namespace, id),
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
      assetFiles.set(hash, packageFile(resolve(root, pkg.location), file))
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
  return Object.freeze({
    ...prepared,
    installation,
    assetFile: (hash: string) => assetFiles.get(hash),
    readAsset: (hash: string) => {
      const file = assetFiles.get(hash)
      return file ? new Uint8Array(readFileSync(file)) : undefined
    },
  })
}
