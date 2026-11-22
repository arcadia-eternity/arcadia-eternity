import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { ManagedProjects } from '@arcadia-eternity/content-sdk/managed-projects'
import { readOfficialEnvironments } from '@arcadia-eternity/content-sdk/management-workspace'
import { readInstalledEnvironmentDocument } from '@arcadia-eternity/content-sdk/prepared-document'
import { assertEnvironmentRequirements, prepareRulesForContent } from '@arcadia-eternity/content-sdk/environment-rules'
import {
  buildDisplayCatalog,
  buildDisplayLocales,
  gameplayRevision,
  mapPresentationResources,
  PackMetadataLoader,
} from '@arcadia-eternity/pack-loader/native'
import { emptyNpmContentHost, prepareNpmProject } from '@arcadia-eternity/pack-loader/node'

const basePackageRoot = fileURLToPath(
  new URL('.', import.meta.resolve('@arcadia-eternity/data-pack-base/package.json')),
)

// Resolve interface defaults even when the active environment has no tagged resources.
export async function readBaseBattleUi(root = basePackageRoot) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (!pkg.arcadia?.presentation) return {}
  const manifest = JSON.parse(await readFile(join(root, pkg.arcadia.presentation), 'utf8'))
  const roles = {}
  for (const resource of manifest.resources) {
    const tags = resource.tags?.filter(tag => tag.startsWith('battle-ui:')) ?? []
    if (!tags.length || resource.kind !== 'http') continue
    for (const tag of tags) roles[tag] = { id: resource.id, source: resource.source, sha256: resource.sha256 }
  }
  return roles
}

/** Export the distribution's environments and share identical installed materials between them. */
export async function buildWebContent(root = basePackageRoot, projectDirectory) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const manifestPath = join(root, pkg.arcadiaEternityPack ?? 'pack.json')
  const metadata = await new PackMetadataLoader().loadMetadata(manifestPath, {
    enforceLockfile: true,
    includeData: false,
  })
  const files = new Map()
  const media = new Map()
  const cleanup = []
  async function dispose() {
    while (cleanup.length) await cleanup.pop()()
  }
  try {
    let builtins = []
    let defaultId
    if (projectDirectory) {
      builtins = await exportMaterial(projectDirectory, [], 'environment')
      defaultId = builtins[0].id
    } else {
      const { environments, defaultEnvironment } = await readOfficialEnvironments(
        root,
        createRequire(import.meta.url).resolve,
      )
      const directory = await mkdtemp(join(tmpdir(), 'arcadia-web-environments-'))
      cleanup.push(() => rm(directory, { recursive: true, force: true }))
      const manager = new ManagedProjects(directory, { bundledPackageRoot: root })
      cleanup.push(() => manager.close())
      const groups = new Map()
      for (const doc of environments) {
        const key = JSON.stringify([doc.packages, doc.sources])
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(doc)
      }
      defaultId = defaultEnvironment
      for (const docs of groups.values()) {
        const primary = docs.find(doc => doc.id === defaultEnvironment) ?? docs[0]
        const material = primary.id === defaultEnvironment ? 'environment' : 'environment/' + primary.id
        const group = [primary, ...docs.filter(doc => doc !== primary)]
        const entries = await manager.prepareProject(primary, {}, installed =>
          exportMaterial(installed, group, material),
        )
        builtins.push(...entries)
      }
    }
    const file = 'environment/catalog.json'
    const catalog = JSON.parse(files.get(file))
    files.set(file, JSON.stringify({ ...catalog, defaultEnvironment: defaultId, builtins }))
    const battleUi = await readBaseBattleUi(root)
    return {
      battleUi,
      files,
      mediaTargets: Array.from(media, ([path, src]) => ({ src, dest: dirname(path) })),
      dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }

  async function exportMaterial(directory, definitions, material) {
    const prepared = await prepareNpmProject(
      directory,
      emptyNpmContentHost,
      { policy: { profile: 'self-hosted' } },
      { effectPreparation: 'prebuilt-only' },
    )
    cleanup.push(prepared.dispose)
    const { data, sandbox } = prepared
    const writeJson = (path, value) => files.set(path, JSON.stringify(value))
    const content = buildDisplayCatalog(data, [], prepared.presentation, { includeRuleDetails: true })
    const resources = stageEnvironmentMedia(content, prepared.presentation, media)
    content.locales = buildDisplayLocales(prepared.presentation, {}, content)
    if (!definitions.length) definitions = [await readInstalledEnvironmentDocument(directory, prepared.revision)]
    const runtimeIdentity = {
      kind: 'native-v4',
      contentRevision: prepared.revision,
      coreBuildId: prepared.build.coreBuildId,
      registryBuildId: prepared.build.registryBuildId,
    }
    const packages = prepared.installation.packages.map(({ name, version }) => ({ name, version }))
    const entries = []
    for (const doc of definitions) {
      assertEnvironmentRequirements(doc?.requires)
      const { rules } = prepareRulesForContent(doc?.rules, sandbox.data)
      const revision = await gameplayRevision(runtimeIdentity, sandbox.revision, rules)
      entries.push({
        id: doc?.id ?? 'default',
        name: doc?.name ?? '网页默认环境',
        material,
        packages,
        rules,
        gameplayRevision: revision,
      })
    }
    writeJson(material + '/catalog.json', {
      packages,
      rules: entries[0].rules,
      content,
      resources,
      runtimeRevision: sandbox.revision,
      runtimeIdentity,
      gameplayRevision: entries[0].gameplayRevision,
      effectMarkRelations: prepared.authoring?.effectMarkRelations ?? {},
    })
    writeJson(material + '/runtime.json', sandbox)
    if (material === 'environment') writeDefaultPack(prepared, content, resources)
    return entries
  }
  function writeDefaultPack(prepared, content, resources) {
    const { locales, pack, lockfile } = metadata
    const { data, sandbox } = prepared
    const writeJson = (path, value) => files.set(path, JSON.stringify(value))
    const authoring = {
      build: prepared.build,
      templates: sandbox.data.behaviors ?? [],
      effectIds: prepared.authoring?.effectIds ?? [],
      effectMarkRelations: prepared.authoring?.effectMarkRelations ?? {},
    }
    const manifest = {
      ...pack,
      content: 'dist/content.json',
      presentation: 'dist/presentation.json',
      data: { effects: [], marks: [], skills: [], species: [] },
      locales: Object.entries(locales).map(([locale, namespaces]) => ({
        locale,
        files: Object.keys(namespaces).map(namespace => `${locale}/${namespace}.json`),
      })),
    }
    const { localesDir = 'locales' } = manifest.paths ?? {}
    writeJson(manifest.content, { data })
    writeJson('dist/catalog.json', authoring)
    for (const [locale, namespaces] of Object.entries(locales))
      for (const [namespace, value] of Object.entries(namespaces)) {
        // Older web clients request the element names from the battle namespace.
        const bundle =
          namespace === 'battle' && namespaces.element && !value.element
            ? {
                ...value,
                element: Object.fromEntries(Object.entries(namespaces.element).map(([id, row]) => [id, row.name])),
              }
            : value
        writeJson(`${localesDir}/${locale}/${namespace}.json`, bundle)
      }

    const webPresentation = {
      version: 2,
      bindings: prepared.presentation.find(pkg => !pkg.namespace)?.manifest.bindings ?? [],
      locales: {},
      resources,
      defaultLocale: content.locales.defaultLocale,
    }
    writeJson(manifest.presentation, webPresentation)
    writeJson('pack.json', manifest)
    const { packageKey } = lockfile.importers['.'].dependencies[pack.id]
    lockfile.packages[packageKey].resolution = {
      integrity: `sha512-${createHash('sha512').update(files.get('pack.json')).digest('base64')}`,
    }
    files.set('pack-lock.yaml', YAML.stringify(lockfile))
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
