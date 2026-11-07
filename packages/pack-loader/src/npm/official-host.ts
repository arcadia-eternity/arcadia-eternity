import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  createContentIndex,
  type BehaviorDefinition,
  type ContentPrototypeData,
  type EnvironmentBuildIdentity,
} from '@arcadia-eternity/battle/v4'
import { nativeBuildIdentity } from '@arcadia-eternity/battle/v4/build'
import type { NpmContentHost } from './prepare'
import { packageFile, type NpmProjectInspection } from './inspect'
import { validatePrebuiltEffectModule } from './prebuilt-artifact'
import { createDraft, fail } from '../works/model'
import { parseWithErrors, PresentationManifestSchema } from '@arcadia-eternity/schema'
import type { InstalledNpmPackage } from './inspect'
import { NativePackLoader } from '../native-loader'

async function readPackageJson(root: string, path: string) {
  const file = packageFile(root, path)
  const info = await lstat(file)
  if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('NPM_FILE', path, 'Expected a bounded regular JSON file')
  return JSON.parse(await readFile(file, 'utf8'))
}

async function readCatalogPackage(root: string, coreBuildId: string) {
  const pkg = await readPackageJson(root, 'package.json')
  const manifest = pkg.arcadia
  const metadata = await readPackageJson(root, manifest?.catalog)
  const data: ContentPrototypeData = (await readPackageJson(root, manifest.content)).data
  if (
    !metadata ||
    metadata.formatVersion !== 1 ||
    metadata.build?.formatVersion !== 1 ||
    metadata.build.coreBuildId !== coreBuildId ||
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
    packPath: pkg.arcadiaEternityPack as string,
    member: { name: pkg.name as string, version: pkg.version as string, projectId: 'base', namespace: 'base' },
  }
}

/** Prepare the package selected by a shipped environment without importing its effects. */
export async function prepareCatalogPackage(root: string) {
  const selected = await readCatalogPackage(root, nativeBuildIdentity.coreBuildId)
  const { build, data, templates, effectIds, effectModules, presentation } = selected
  const pack = await readPackageJson(root, selected.packPath)
  const prepared = await new NativePackLoader(
    build,
    (rules, revision) => createContentIndex(rules, revision, { templates, effectIds }),
    { templates, effectModules },
  ).fromMetadata(data, { packs: [{ id: pack.id, version: pack.version }] })
  if (!prepared.sandbox) throw new Error('Catalog package has no prepared runtime')
  return {
    ...prepared,
    sandbox: prepared.sandbox,
    data,
    presentation: presentation ? [presentation] : [],
    locales: presentation?.locales ?? {},
    member: selected.member,
    host: { build, base: data, templates, effectIds, effectModules } satisfies NpmContentHost,
  }
}

/** Stage the already acquired package as an explicit, relocatable npm project. */
export async function stageCatalogProject(directory: string, root: string) {
  const source = await readPackageJson(root, 'package.json')
  const selected = await readCatalogPackage(root, nativeBuildIdentity.coreBuildId)
  const { name, version, arcadia, arcadiaEternityPack } = source
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || !arcadia?.catalog)
    fail('NPM_METADATA', root, 'Expected a compiled catalog package with a valid npm name')
  const location = `node_modules/${name}`
  const target = packageFile(directory, 'catalog-project')
  const installed = resolve(target, location)
  const paths = [
    arcadiaEternityPack,
    arcadia.content,
    arcadia.presentation,
    arcadia.effectArtifact,
    arcadia.catalog,
    ...(selected.presentation?.resources ?? [])
      .filter(resource => resource.kind === 'file')
      .map(resource => resource.source),
  ]
  for (const path of new Set(paths)) {
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
    writeFile(resolve(installed, 'package.json'), JSON.stringify({ name, version, arcadia, arcadiaEternityPack })),
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
  if (!packages.length) return { host, presentationPackages: installation.packages }
  if (packages.length !== 1) fail('CONTENT_VERSION_CONFLICT', 'base', 'Official base must have one installed version')
  const pkg = packages[0]!
  const metadata = await readCatalogPackage(resolve(root, pkg.location), host.build.coreBuildId)
  let presentationPackages = installation.packages
  if (metadata.presentation) {
    const draft = createDraft('official-catalog', 'Official catalog')
    draft.data = {
      species: [...metadata.data.species] as typeof draft.data.species,
      skills: [...metadata.data.skills] as typeof draft.data.skills,
      marks: [...metadata.data.marks] as typeof draft.data.marks,
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
    return { host, presentationPackages }
  }
  return {
    presentationPackages,
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
