import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import {
  buildDisplayCatalog,
  buildDisplayLocales,
  mapPresentationResources,
  PackMetadataLoader,
} from '@arcadia-eternity/pack-loader/native'
import { emptyNpmContentHost, prepareShippedEnvironment, prepareNpmProject } from '@arcadia-eternity/pack-loader/node'

/** Stage the selected package's prepared default environment for static delivery. */
export async function buildWebContent(
  root = fileURLToPath(new URL('.', import.meta.resolve('@arcadia-eternity/data-pack-base/package.json'))),
  projectDirectory,
) {
  const { locales, pack, lockfile } = await new PackMetadataLoader().loadMetadata(join(root, 'pack.json'), {
    enforceLockfile: true,
    includeData: false,
  })
  const files = new Map()
  const media = new Map()
  const prepared = projectDirectory
    ? await prepareNpmProject(
        projectDirectory,
        emptyNpmContentHost,
        { policy: { profile: 'self-hosted' } },
        { effectPreparation: 'prebuilt-only' },
      )
    : await prepareShippedEnvironment(root)
  try {
    const { data, sandbox } = prepared
    const authoring = {
      build: prepared.build,
      templates: sandbox.data.behaviors ?? [],
      effectIds: prepared.authoring?.effectIds ?? [],
      effectTemplates: prepared.authoring?.effectTemplates ?? [],
      effectMarkRelations: prepared.authoring?.effectMarkRelations ?? {},
    }
    const writeJson = (path, value) => files.set(path, JSON.stringify(value))
    const manifest = {
      ...pack,
      content: 'dist/content.json',
      data: { effects: [], marks: [], skills: [], species: [] },
      locales: Object.entries(locales).map(([locale, namespaces]) => ({
        locale,
        files: Object.keys(namespaces).map(namespace => `${locale}/${namespace}.json`),
      })),
    }
    const { localesDir } = manifest.paths
    writeJson(manifest.content, { data })
    writeJson('dist/catalog.json', authoring)
    for (const [locale, namespaces] of Object.entries(locales))
      for (const [namespace, value] of Object.entries(namespaces))
        writeJson(`${localesDir}/${locale}/${namespace}.json`, value)

    const content = buildDisplayCatalog(data, [], prepared.presentation, { includeRuleDetails: true })
    const resources = stageEnvironmentMedia(content, prepared.presentation, media)
    content.locales = buildDisplayLocales(prepared.presentation, {}, content)
    const webPresentation = {
      version: 2,
      bindings: prepared.presentation.find(pkg => !pkg.namespace)?.manifest.bindings ?? [],
      locales: {},
      resources,
      defaultLocale: content.locales.defaultLocale,
    }
    writeJson(manifest.presentation, webPresentation)
    writeJson('environment/catalog.json', {
      content,
      resources: resources.filter(resource => resource.tags?.length),
      runtimeRevision: sandbox.revision,
      effectMarkRelations: authoring.effectMarkRelations,
    })
    writeJson('environment/runtime.json', sandbox)
    writeJson('pack.json', manifest)
    const { packageKey } = lockfile.importers['.'].dependencies[pack.id]
    lockfile.packages[packageKey].resolution = {
      integrity: `sha512-${createHash('sha512').update(files.get('pack.json')).digest('base64')}`,
    }
    files.set('pack-lock.yaml', YAML.stringify(lockfile))
    return {
      files,
      mediaTargets: Array.from(media, ([path, src]) => ({ src, dest: dirname(path) })),
      dispose: prepared.dispose,
    }
  } catch (error) {
    await prepared.dispose()
    throw error
  }
}

function stageEnvironmentMedia(content, packages, media) {
  const index = new Map()
  const resources = []
  for (const pkg of packages) {
    const files = new Map(pkg.resources.map(resource => [resource.id, resource.file]))
    const urls = new Map()
    index.set(pkg.namespace, urls)
    if (!pkg.namespace && pkg.projectId) index.set(pkg.projectId, urls)
    for (const resource of pkg.manifest.resources) {
      let source = resource.source
      if (resource.kind === 'file') {
        const file = files.get(resource.id)
        if (!file) throw new Error(`Missing prepared media: ${resource.id}`)
        source = `pack-assets/${resource.sha256}/${basename(file)}`
        media.set(source, file)
      }
      urls.set(resource.id, source)
      resources.push({ ...resource, id: pkg.namespace ? `${pkg.namespace}:${resource.id}` : resource.id, source })
    }
  }
  for (const kind of ['species', 'skills', 'marks'])
    for (const row of content[kind])
      if (row.presentation) {
        const owner = row.id.includes(':') ? row.id.split(':', 1)[0] : ''
        row.presentation = mapPresentationResources(row.presentation, ref => {
          const namespace = typeof ref === 'string' ? owner : ref.namespace
          const id = typeof ref === 'string' ? ref : ref.id
          const source = index.get(namespace)?.get(id)
          if (!source) throw new Error(`Missing prepared media: ${namespace}/${id}`)
          return source
        })
      }
  return resources
}
