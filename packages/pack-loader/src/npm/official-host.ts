import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  type BehaviorDefinition,
  type ContentPrototypeData,
  type EnvironmentBuildIdentity,
} from '@arcadia-eternity/battle/engine'
import type { NpmContentHost } from './prepare'
import { packageFile, type NpmProjectInspection } from './inspect'
import { validatePrebuiltEffectModule } from './prebuilt-artifact'
import { createDraft, digestJson, fail } from '../works/model'
import { parseWithErrors, PresentationManifestSchema } from '@arcadia-eternity/schema'
import type { InstalledNpmPackage } from './inspect'
import { npmInvocation } from './runner'
import { parseNpmPackOutput } from './pack-output'

async function readPackageJson(root: string, path: string) {
  const file = packageFile(root, path)
  const info = await lstat(file)
  if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('NPM_FILE', path, 'Expected a bounded regular JSON file')
  return JSON.parse(await readFile(file, 'utf8'))
}

async function readCatalogPackage(root: string) {
  const pkg = await readPackageJson(root, 'package.json')
  const manifest = pkg.arcadia
  const metadata = await readPackageJson(root, manifest?.catalog)
  const data: ContentPrototypeData = (await readPackageJson(root, manifest.content)).data
  if (
    !metadata ||
    metadata.formatVersion !== 1 ||
    metadata.build?.formatVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(metadata.build.coreBuildId) ||
    !/^[a-f0-9]{64}$/.test(metadata.build.registryBuildId) ||
    !Array.isArray(data?.species) ||
    !Array.isArray(data?.skills) ||
    !Array.isArray(data?.marks) ||
    !Array.isArray(metadata.templates) ||
    !Array.isArray(metadata.effectIds) ||
    metadata.effectIds.some((id: unknown) => typeof id !== 'string')
  )
    fail('NPM_BASE_HOST_INVALID', root, 'Incompatible catalog package artifact')
  const artifact = validatePrebuiltEffectModule(await readPackageJson(root, manifest.effectArtifact), pkg.name)
  const presentation = manifest.presentation ? await readPackageJson(root, manifest.presentation) : undefined
  return {
    build: metadata.build as EnvironmentBuildIdentity,
    data,
    templates: metadata.templates as BehaviorDefinition[],
    effectIds: metadata.effectIds as string[],
    effectModules: [{ artifact, namespace: '', role: 'catalog' as const }],
    presentation: presentation ? parseWithErrors(PresentationManifestSchema, presentation) : undefined,
    effectMarkRelations: metadata.effectMarkRelations ?? {},
  }
}

export async function withShippedEnvironmentProject<T>(root: string, use: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(resolve(tmpdir(), 'arcadia-default-environment-'))
  try {
    return await use(await stageCatalogProject(directory, root))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Make the bundled content available to the same installer as any local npm archive. */
export function withShippedCatalogArchive<T>(
  root: string,
  npmCli: string | undefined,
  use: (file: string) => Promise<T>,
) {
  return withShippedEnvironmentProject(root, async project => {
    const { dependencies } = await readPackageJson(project, 'package.json')
    const name = Object.keys(dependencies)[0]!
    const npm = npmInvocation(['pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', project], {
      cli: npmCli,
    })
    const { stdout } = await promisify(execFile)(npm.file, npm.args, {
      cwd: resolve(project, 'node_modules', name),
      env: process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
      timeout: 60_000,
    })
    const [{ filename }] = parseNpmPackOutput(stdout)
    if (typeof filename !== 'string' || filename !== basename(filename) || !filename.endsWith('.tgz'))
      fail('NPM_FILE', name, 'Invalid npm archive filename')
    return use(packageFile(project, filename))
  })
}

async function catalogMaterials(root: string) {
  const { name, version, arcadia, arcadiaEternityPack, engines } = await readPackageJson(root, 'package.json')
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || !arcadia?.catalog)
    fail('NPM_METADATA', root, 'Expected a compiled catalog package with a valid npm name')
  const presentation = parseWithErrors(PresentationManifestSchema, await readPackageJson(root, arcadia.presentation))
  const paths = new Set<string>([
    arcadiaEternityPack,
    arcadia.content,
    arcadia.presentation,
    arcadia.effectArtifact,
    arcadia.catalog,
    ...(arcadia.environments !== undefined ? [arcadia.environments] : []),
    ...presentation.resources.filter(resource => resource.kind === 'file').map(resource => resource.source),
  ])
  const manifest = { name, version, arcadia, arcadiaEternityPack, ...(engines ? { engines } : {}) }
  return { manifest, paths: [...paths].sort() }
}

/** Identity of the files staged for play, independent of npm packaging and development metadata. */
export async function catalogMaterialDigest(root: string) {
  const { manifest, paths } = await catalogMaterials(root)
  const files = []
  for (const path of paths) {
    const file = packageFile(root, path)
    if (!(await lstat(file)).isFile()) fail('NPM_FILE', path, 'Expected an ordinary catalog material')
    files.push([
      path,
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
    ])
  }
  return digestJson({ manifest, files })
}

/** Stage the already acquired package as an explicit, relocatable npm project. */
export async function stageCatalogProject(directory: string, root: string) {
  const { manifest, paths } = await catalogMaterials(root)
  const { name, version } = manifest
  const location = `node_modules/${name}`
  const target = packageFile(directory, 'catalog-project')
  const installed = resolve(target, location)
  for (const path of paths) {
    const input = packageFile(root, path)
    if (!(await lstat(input)).isFile()) fail('NPM_FILE', path, 'Expected an ordinary catalog material')
    const output = packageFile(installed, path)
    await mkdir(dirname(output), { recursive: true })
    await copyFile(input, output)
  }
  const project = {
    name: 'arcadia-default-environment',
    version: '1.0.0',
    private: true,
    dependencies: { [name]: version },
  }
  await Promise.all([
    writeFile(resolve(installed, 'package.json'), JSON.stringify(manifest)),
    writeFile(resolve(target, 'package.json'), JSON.stringify(project)),
    writeFile(
      resolve(target, 'package-lock.json'),
      JSON.stringify({
        name: project.name,
        version: project.version,
        lockfileVersion: 3,
        packages: { '': project, [location]: { name, version } },
      }),
    ),
  ])
  return target
}

/** Bridge the existing global official IDs into the ordinary npm preparation path.
 * The selected installation owns the version. Never resolve a workspace/global base
 * or import executable package modules while preparing content.
 */
export async function installedOfficialHost(root: string, installation: NpmProjectInspection, host: NpmContentHost) {
  const packages = installation.packages.filter(pkg => pkg.officialHost)
  if (!packages.length) return { host, presentationPackages: installation.packages, authoring: undefined }
  if (packages.length !== 1) fail('CONTENT_VERSION_CONFLICT', 'base', 'Official base must have one installed version')
  const pkg = packages[0]!
  const metadata = await readCatalogPackage(resolve(root, pkg.location))
  const { build, templates, effectIds, effectMarkRelations } = metadata
  const authoring = { build, templates, effectIds, effectMarkRelations }
  let presentationPackages = installation.packages
  if (metadata.presentation) {
    const draft = createDraft('official-catalog', 'Official catalog')
    draft.data = {
      species: [...metadata.data.species] as typeof draft.data.species,
      skills: [...metadata.data.skills] as typeof draft.data.skills,
      marks: [...metadata.data.marks] as typeof draft.data.marks,
      elements: metadata.data.elements as typeof draft.data.elements,
      natures: metadata.data.natures as typeof draft.data.natures,
      enhancements: metadata.data.enhancements as typeof draft.data.enhancements,
      behaviors: [],
    }
    const presentationPackage: InstalledNpmPackage = {
      ...pkg,
      manifest: { formatVersion: 1, projectId: 'base', namespace: '', content: pkg.officialHost!, assets: {} },
      draft,
      presentation: metadata.presentation,
    }
    presentationPackages = installation.packages.map(entry => (entry === pkg ? presentationPackage : entry))
  }
  const populated = host.base.species.length || host.base.skills.length || host.base.marks.length
  if (populated) {
    if (host.build.registryBuildId !== metadata.build.registryBuildId)
      fail('NPM_BASE_HOST_CONFLICT', pkg.location, 'Installed official base differs from the host catalog')
    return { host, presentationPackages, authoring }
  }
  return {
    presentationPackages,
    authoring,
    host: {
      ...host,
      build: metadata.build,
      base: metadata.data,
      templates: [...host.templates, ...metadata.templates],
      effectIds: [...(host.effectIds ?? []), ...metadata.effectIds],
      effectModules: [...(host.effectModules ?? []), ...metadata.effectModules],
    } satisfies NpmContentHost,
  }
}
