import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { PackMetadataLoader } from '@arcadia-eternity/pack-loader/native'
import { validAssetPath } from '../../content-dev/src/lib/presentation.mjs'

/** Compile the built-in pack for HTTP hosts while preserving the ordinary pack manifest contract. */
export async function buildWebContent(root = fileURLToPath(new URL('../../../packs/base/', import.meta.url))) {
  const { data, locales, pack, lockfile, presentation } = await new PackMetadataLoader().loadMetadata(
    join(root, 'pack.json'),
    { enforceLockfile: true },
  )
  const files = new Map()
  const media = new Map()
  const writeJson = (path, value) => files.set(path, JSON.stringify(value))
  const manifest = {
    ...pack,
    data: { effects: [], marks: ['marks.json'], skills: ['skills.json'], species: ['species.json'] },
    locales: Object.entries(locales).map(([locale, namespaces]) => ({
      locale,
      files: Object.keys(namespaces).map(namespace => `${locale}/${namespace}.json`),
    })),
  }
  const { dataDir, localesDir } = manifest.paths
  for (const kind of ['marks', 'skills', 'species']) writeJson(`${dataDir}/${kind}.json`, data[kind])
  for (const [locale, namespaces] of Object.entries(locales))
    for (const [namespace, value] of Object.entries(namespaces))
      writeJson(`${localesDir}/${locale}/${namespace}.json`, value)

  const [display] = presentation
  writeJson(manifest.presentation, {
    ...display,
    resources: display.resources.map(resource => {
      if (resource.kind === 'http') return resource
      if (!validAssetPath(resource.source)) throw new Error(`Invalid base media path: ${resource.source}`)
      const source = `pack-assets/${resource.source}`
      media.set(source, join(root, resource.source))
      return { ...resource, source }
    }),
  })
  writeJson('pack.json', manifest)
  const { packageKey } = lockfile.importers['.'].dependencies[pack.id]
  lockfile.packages[packageKey].resolution = {
    integrity: `sha512-${createHash('sha512').update(files.get('pack.json')).digest('base64')}`,
  }
  files.set('pack-lock.yaml', YAML.stringify(lockfile))
  return {
    files,
    mediaTargets: Array.from(media, ([path, src]) => ({ src, dest: dirname(path) })),
  }
}
