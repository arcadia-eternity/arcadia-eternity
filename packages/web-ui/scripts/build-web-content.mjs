import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import {
  buildDisplayCatalog,
  buildDisplayLocales,
  mapPresentationResources,
  PackMetadataLoader,
} from '@arcadia-eternity/pack-loader/native'
import { emptyNpmContentHost, prepareCatalogPackage, prepareNpmProject } from '@arcadia-eternity/pack-loader/node'
import { validAssetPath } from '../../content-dev/src/lib/presentation.mjs'

/** Stage the selected package's prepared default environment for static delivery. */
export async function buildWebContent(
  root = fileURLToPath(new URL('../../../packs/base/', import.meta.url)),
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
    : undefined
  try {
    const selected = prepared ?? (await prepareCatalogPackage(root))
    const { data, sandbox } = selected
    const authoring = prepared
      ? {
          build: prepared.build,
          templates: sandbox.data.behaviors ?? [],
          effectIds: [],
          effectTemplates: [],
          effectMarkRelations: {},
        }
      : JSON.parse(await readFile(join(root, 'dist/catalog.json'), 'utf8'))
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

    const webPresentation = prepared
      ? { version: 2, bindings: [], locales: {}, resources: [], defaultLocale: 'zh-CN' }
      : stagePresentation(selected.presentation[0], root, media)
    const content = prepared
      ? buildDisplayCatalog(data, [], prepared.presentation, { includeRuleDetails: true })
      : buildDisplayCatalog(data, [webPresentation], [], { includeRuleDetails: true })
    const resources = prepared
      ? stageEnvironmentMedia(content, prepared.presentation, media)
      : webPresentation.resources
    if (prepared) content.locales = buildDisplayLocales(prepared.presentation, {}, content)
    if (prepared) webPresentation.resources = resources
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
      dispose: () => prepared?.dispose(),
    }
  } catch (error) {
    await prepared?.dispose()
    throw error
  }
}

function stagePresentation(display, root, media) {
  return {
    ...display,
    resources: display.resources.map(resource => {
      if (resource.kind === 'http') return resource
      if (!validAssetPath(resource.source)) throw new Error(`Invalid package media path: ${resource.source}`)
      const source = `pack-assets/${resource.source}`
      media.set(source, join(root, resource.source))
      return { ...resource, source }
    }),
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
