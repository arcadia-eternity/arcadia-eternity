import { readFile } from 'node:fs/promises'
import { environmentManifestDocument, type EnvironmentDocumentV2 } from './debug-environments.ts'
import {
  officialBasePackage,
  officialEnvironmentPackages,
  resolveOfficialWorkspaceManifest,
} from './official-environment-packages.ts'
import { isRecord } from './types.ts'

export type OfficialEnvironmentCatalog = { defaultEnvironment: string; environments: EnvironmentDocumentV2[] }

export async function officialEnvironmentCatalog(
  baseVersion: string,
  read: (name: string) => Promise<unknown>,
): Promise<OfficialEnvironmentCatalog> {
  const environments = await Promise.all(
    Object.entries(officialEnvironmentPackages).map(async ([id, name]) => {
      const manifest = await read(name)
      if (!isRecord(manifest) || manifest.name !== name || manifest.version !== baseVersion)
        throw new Error('OFFICIAL_ENVIRONMENT_PACKAGE_MISMATCH: ' + name)
      const document = environmentManifestDocument(manifest)
      if (
        document.id !== id ||
        document.sources.length ||
        Object.keys(document.packages).length !== 1 ||
        document.packages[officialBasePackage] !== baseVersion
      )
        throw new Error('OFFICIAL_ENVIRONMENT_PACKAGE_MISMATCH: ' + name)
      return document
    }),
  )
  return { defaultEnvironment: 'builtin-server', environments }
}

export function bundledEnvironmentCatalog(baseVersion: string, resolve: (specifier: string) => string) {
  return officialEnvironmentCatalog(baseVersion, async name => {
    const manifest = JSON.parse(await readFile(resolve(name + '/package.json'), 'utf8'))
    return resolveOfficialWorkspaceManifest(manifest)
  })
}
