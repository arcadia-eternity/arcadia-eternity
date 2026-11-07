import { readFileSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as sdk from '@arcadia-eternity/battle/v4/authoring'
import type { SandboxEnvironment } from '@arcadia-eternity/battle/v4/sandbox/effects'
import { createContentIndex, type ContentIndex } from '@arcadia-eternity/battle/v4'
import { compileRelease, prepareWorkEnvironment } from '../works/compiler'
import { cloneJson, digestJson, fail, runtimeId, type Json, type WorkHost, type WorkRelease } from '../works/model'
import { inspectNpmProject, packageFile, type InstalledNpmPackage, type NpmProjectInspection } from './inspect'
import { captureNpmProject } from './capture'
import { preparePresentation, type PreparedPresentation } from './resources'
import { compileEffectModule } from './effect-artifact'
import { readPrebuiltEffectModule } from './prebuilt-artifact'
import { bindEffectEnvironment } from '../effect-environment'
import { installedOfficialHost } from './official-host'

export interface NpmContentHost extends Omit<WorkHost<ContentIndex>, 'createContent'> {
  readonly effectModules?: SandboxEnvironment['modules']
  readonly effectIds?: readonly string[]
}
export interface NpmPreparationOptions {
  /** prebuilt-only never invokes the author compiler, module loader or a VM. */
  readonly effectPreparation?: 'compile' | 'prebuilt-only'
}
export type PreparedNpmEnvironment = Awaited<ReturnType<typeof prepareWorkEnvironment<ContentIndex>>> & {
  readonly installation: NpmProjectInspection
  readonly sandbox: SandboxEnvironment
  presentation: PreparedPresentation[]
  assetFile(hash: string): string | undefined
  readAsset(hash: string): Uint8Array | undefined
  dispose(): Promise<void>
}

/** Host-only activation. The administrator admits the project; local file edits do not revoke that decision.
 * Each environment captures its package files. The caller disposes it after all its battles finish.
 * Preparation reads and validates metadata and bundles author text without evaluation.
 * Each battle evaluates the immutable recipe in its own Worker and Arena VMs.
 */
export async function prepareNpmProject(
  directory: string,
  host: NpmContentHost,
  approval: { policy: Readonly<Record<string, Json>> },
  options: NpmPreparationOptions = {},
): Promise<Readonly<PreparedNpmEnvironment>> {
  if (options.effectPreparation !== undefined && !['compile', 'prebuilt-only'].includes(options.effectPreparation))
    fail('NPM_PREPARATION_MODE', 'effectPreparation', 'Unsupported effect preparation mode')
  if (approval.policy.profile === 'official' && options.effectPreparation === 'compile')
    fail('NPM_PREPARATION_POLICY', 'effectPreparation', 'Official hosts consume prebuilt author artifacts only')
  const preparation: NpmPreparationOptions = {
    effectPreparation:
      options.effectPreparation ?? (approval.policy.profile === 'official' ? 'prebuilt-only' : 'compile'),
  }
  const source = await realpath(directory)
  const original = await inspectNpmProject(source)
  const captured = await captureNpmProject(source, original)
  const dispose = () => captured.dispose()
  try {
    const inspected = await inspectNpmProject(captured.root)
    // Relocation only changes private npm source paths. Audit the administrator's original lockfile.
    const installation = Object.freeze({ ...inspected, lockfileDigest: original.lockfileDigest })
    const selected = await installedOfficialHost(captured.root, installation, host)
    return Object.freeze({
      ...(await compileInstallation(captured.root, selected.host, installation, approval.policy, preparation)),
      presentation: await preparePresentation(captured.root, selected.presentationPackages),
      dispose,
    })
  } catch (error) {
    await dispose()
    throw error
  }
}

async function compileInstallation(
  root: string,
  host: NpmContentHost,
  installation: NpmProjectInspection,
  policyInput: Readonly<Record<string, Json>>,
  options: NpmPreparationOptions,
) {
  const policy = cloneJson(policyInput)
  const contentPackages = installation.packages.filter(pkg => pkg.manifest)
  if (!contentPackages.length && !installation.packages.some(pkg => pkg.officialHost))
    fail('NPM_CONTENT_MISSING', 'dependencies', 'No installed Arcadia content packages')
  // A content attachment already identifies the effect and its source kind. Do not ask
  // authors to repeat those declarations in package.json; the actual code is checked
  // when the battle Worker initializes the module with its canonical mark prototypes.
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
          if ((!provider?.manifest!.effects && !provider?.manifest!.effectArtifact) || typeof ref.id !== 'string')
            continue
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
  const artifacts: SandboxEnvironment['modules'][number][] = [...(host.effectModules ?? [])]
  for (const pkg of contentPackages) {
    const manifest = pkg.manifest!
    if (!manifest.effects && !manifest.effectArtifact) continue
    // Published artifacts are canonical for every consumer, including clients that
    // also have a compiler. A declared artifact never silently falls back to source.
    if (options.effectPreparation === 'prebuilt-only' && !manifest.effectArtifact)
      fail('NPM_ARTIFACT_REQUIRED', pkg.location, 'This host requires an author-published effect artifact')
    const artifact = manifest.effectArtifact
      ? await readPrebuiltEffectModule(
          packageFile(resolve(root, pkg.location), manifest.effectArtifact),
          root,
          pkg.name,
        )
      : await compileEffectModule(packageFile(resolve(root, pkg.location), manifest.effects!), root, pkg.name)
    artifacts.push({ artifact, namespace: manifest.namespace, role: 'behaviors' })
  }
  const combinedHost: WorkHost<ContentIndex> = {
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
    createContent: (data, revision) =>
      createContentIndex(data, revision, { templates: host.templates, effectIds: host.effectIds }),
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
  const sandbox = await bindEffectEnvironment(
    prepared.content,
    { ...prepared.data, behaviors: [...host.templates, ...(prepared.data.behaviors ?? [])] },
    prepared.revision,
    artifacts,
  )
  return Object.freeze({
    ...prepared,
    installation,
    sandbox,
    assetFile: (hash: string) => assetFiles.get(hash),
    readAsset: (hash: string) => {
      const file = assetFiles.get(hash)
      return file ? new Uint8Array(readFileSync(file)) : undefined
    },
  })
}
