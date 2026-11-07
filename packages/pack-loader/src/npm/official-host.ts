import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { NpmContentHost } from './prepare'
import { packageFile, type NpmProjectInspection } from './inspect'
import { validatePrebuiltEffectModule } from './prebuilt-artifact'
import { createDraft, fail } from '../works/model'
import { parseWithErrors, PresentationManifestSchema } from '@arcadia-eternity/schema'
import type { InstalledNpmPackage } from './inspect'

/** Bridge the existing global official IDs into the ordinary npm preparation path.
 * The selected installation owns the version. Never resolve a workspace/global base
 * or import executable package modules while preparing content.
 */
export async function installedOfficialHost(root: string, installation: NpmProjectInspection, host: NpmContentHost) {
  const packages = installation.packages.filter(pkg => pkg.officialHost)
  if (!packages.length) return { host, presentationPackages: installation.packages }
  if (packages.length !== 1) fail('CONTENT_VERSION_CONFLICT', 'base', 'Official base must have one installed version')
  const pkg = packages[0]!
  const metadata = JSON.parse(await readFile(packageFile(resolve(root, pkg.location), pkg.officialHost!), 'utf8'))
  if (
    !metadata ||
    metadata.formatVersion !== 1 ||
    metadata.build?.formatVersion !== 1 ||
    metadata.build.coreBuildId !== host.build.coreBuildId ||
    !/^[a-f0-9]{64}$/.test(metadata.build.registryBuildId) ||
    !['species', 'skills', 'marks'].every(kind => Array.isArray(metadata.data?.[kind])) ||
    !Array.isArray(metadata.templates) ||
    !Array.isArray(metadata.effectIds) ||
    metadata.effectIds.some((id: unknown) => typeof id !== 'string')
  )
    fail('NPM_BASE_HOST_INVALID', pkg.location, 'Incompatible official base host artifact')
  const artifact = validatePrebuiltEffectModule(metadata.effectArtifact, pkg.name)
  let presentationPackages = installation.packages
  if (metadata.presentation) {
    const draft = createDraft('official-catalog', 'Official catalog')
    draft.data = { ...metadata.data, behaviors: [] }
    const presentationPackage: InstalledNpmPackage = {
      ...pkg,
      manifest: { formatVersion: 1, projectId: 'base', namespace: '', content: pkg.officialHost!, assets: {} },
      draft,
      presentation: parseWithErrors(PresentationManifestSchema, metadata.presentation),
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
      effectModules: [...(host.effectModules ?? []), { artifact, namespace: '', role: 'catalog' as const }],
    } satisfies NpmContentHost,
  }
}
