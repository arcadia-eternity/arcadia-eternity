import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { valid } from 'semver'
import { environmentManifestDocument, type EnvironmentDocumentV2 } from './debug-environments.ts'
import {
  officialBasePackage,
  officialEnvironmentPackages,
  resolveOfficialWorkspaceManifest,
} from './official-environment-packages.ts'
import { errorCode, isRecord } from './types.ts'
import { contentError, readJson } from './workspace-materials.ts'

export type OfficialEnvironmentCatalog = { defaultEnvironment: string; environments: EnvironmentDocumentV2[] }

async function officialEnvironmentCatalog(
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

export const officialEnvironmentPackagesDirectory = (release: string) => join(release, 'environment-packages')

async function officialBaseVersion(root: string) {
  const manifest = await readJson(join(root, 'package.json'))
  if (manifest.name !== officialBasePackage || typeof manifest.version !== 'string' || !valid(manifest.version))
    throw contentError('BUNDLED_PACKAGE_INVALID')
  return manifest.version
}

function bundledManifestReader(resolve: (specifier: string) => string) {
  return async (name: string) => {
    const manifest = JSON.parse(await readFile(resolve(name + '/package.json'), 'utf8'))
    return resolveOfficialWorkspaceManifest(manifest)
  }
}

export async function readOfficialEnvironments(root: string, resolve: (specifier: string) => string) {
  return officialEnvironmentCatalog(await officialBaseVersion(root), bundledManifestReader(resolve))
}

export async function readInstalledOfficialEnvironments(base: string, release: string) {
  const packages = officialEnvironmentPackagesDirectory(release)
  const info = await lstat(packages).catch(error => {
    if (errorCode(error) === 'ENOENT') throw contentError('OFFICIAL_ENVIRONMENT_PACKAGES_MISSING')
    throw error
  })
  if (!info.isDirectory()) throw contentError('OFFICIAL_ENVIRONMENT_PACKAGES_INVALID')
  return officialEnvironmentCatalog(await officialBaseVersion(base), name =>
    readJson(join(packages, name, 'package.json')),
  )
}

export async function stageOfficialEnvironmentPackages(
  version: string,
  release: string,
  read: (name: string) => Promise<unknown>,
) {
  const manifests = new Map<string, unknown>()
  const catalog = await officialEnvironmentCatalog(version, async name => {
    const manifest = await read(name)
    manifests.set(name, manifest)
    return manifest
  })
  for (const [name, manifest] of manifests) {
    const file = join(officialEnvironmentPackagesDirectory(release), name, 'package.json')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(manifest), { flag: 'wx' })
  }
  return catalog
}

export function stageBundledOfficialEnvironmentPackages(
  version: string,
  release: string,
  resolve: (specifier: string) => string,
) {
  return stageOfficialEnvironmentPackages(version, release, bundledManifestReader(resolve))
}
