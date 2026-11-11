import { effectDiscoveryPlugin } from '@arcadia-eternity/pack-loader/node'
import { bundledNotices } from './build-battle-environment.mjs'
import { readContentSources } from '../packages/content-dev/src/lib/content.ts'
import { buildPresentation } from '../packages/content-dev/src/lib/presentation.ts'
import { rolldown } from 'rolldown'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import YAML from 'yaml'

/** Host identity covers both the engine and the installed native content implementation. */
export function identifyBaseEnvironmentArtifact(code, core) {
  if (core.formatVersion !== 1 || !/^[a-f0-9]{64}$/.test(core.coreBuildId))
    throw new Error('Invalid engine build identity')
  return {
    formatVersion: 1,
    coreBuildId: core.coreBuildId,
    registryBuildId: createHash('sha256')
      .update('arcadia-base-registry/1\0')
      .update(core.coreBuildId)
      .update('\0')
      .update(code)
      .digest('hex'),
  }
}

export async function buildBaseEnvironmentArtifact() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const dir = resolve(root, 'packs/base/dist')
  const sources = await readContentSources(resolve(root, 'packs/base'))
  const presentation = await buildPresentation(resolve(root, 'packs/base'), sources, { includeLocales: false })
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'presentation.json'), JSON.stringify(presentation, null, 2) + '\n')
  const core = JSON.parse(await readFile(resolve(root, 'packages/battle/dist/environment-build.json'), 'utf8'))
  const bundle = await rolldown({
    cwd: root,
    input: resolve(root, 'packs/base/effects.ts'),
    platform: 'browser',
    plugins: [effectDiscoveryPlugin(resolve(root, 'packs/base'), ['src/effects'], true)],
  })
  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, minify: false })
    if (output.length !== 1 || output[0].type !== 'chunk')
      throw new Error('Native content must produce one executable identity artifact')
    const code = output[0].code
    const identity = identifyBaseEnvironmentArtifact(code, core)
    await mkdir(dir, { recursive: true })
    await writeFile(resolve(dir, 'THIRD_PARTY_NOTICES.md'), await bundledNotices(Object.keys(output[0].modules)))
    await writeFile(resolve(dir, 'environment-runtime.mjs'), code)
    // Only the trusted base build evaluates official code. Clients and environment
    // preparation consume this serializable description without loading effects.
    const official = await import(
      `${pathToFileURL(resolve(dir, 'environment-runtime.mjs')).href}?build=${identity.registryBuildId}`
    )
    const data = Object.fromEntries(
      ['marks', 'skills', 'species'].map(kind => [
        kind,
        sources.filter(source => source.kind === kind).flatMap(source => source.records),
      ]),
    )
    const catalog = official.createOfficialContent(data, identity.registryBuildId)
    const metadata = {
      officialEffectIds: catalog.effects.map(effect => effect.id),
      officialEffectMarkRelations: official.officialEffectMarkRelations,
    }
    // Publish a static bridge for npm consumers of the reserved official IDs.
    // Dependency preparation reads JSON and closed effect text, never imports
    // this package's executable metadata or effect entry points.
    const require = createRequire(resolve(root, 'packs/base/package.json'))
    const { compileEffectModule } = await import(
      pathToFileURL(require.resolve('@arcadia-eternity/pack-loader/node')).href
    )
    const { PackMetadataLoader } = await import(
      pathToFileURL(require.resolve('@arcadia-eternity/pack-loader/native')).href
    )
    const loaded = await new PackMetadataLoader().loadMetadata(resolve(root, 'packs/base/pack.json'))
    const contentNamespaces = new Set(['species', 'skill', 'mark', 'mark_ability', 'mark_emblem', 'mark_global'])
    const locales = Object.fromEntries(
      Object.entries(loaded.locales).map(([language, namespaces]) => [
        language,
        Object.fromEntries(Object.entries(namespaces).filter(([name]) => contentNamespaces.has(name))),
      ]),
    )
    const localeFiles = Object.entries(loaded.locales).map(([language, namespaces]) => ({
      locale: language,
      files: Object.keys(namespaces).map(namespace => `${language}/${namespace}.json`),
    }))
    await Promise.all(
      Object.entries(loaded.locales).flatMap(([language, namespaces]) =>
        Object.entries(namespaces).map(async ([namespace, value]) => {
          const file = resolve(dir, 'locales', language, `${namespace}.json`)
          await mkdir(dirname(file), { recursive: true })
          await writeFile(file, JSON.stringify(value) + '\n')
        }),
      ),
    )
    const manifest = {
      id: loaded.pack.id,
      version: loaded.pack.version,
      engine: loaded.pack.engine,
      layoutVersion: loaded.pack.layoutVersion ?? 1,
      content: 'content.json',
      presentation: 'presentation.json',
      paths: { dataDir: '.', localesDir: 'locales' },
      data: { effects: [], marks: [], skills: [], species: [] },
      locales: localeFiles,
    }
    const manifestText = JSON.stringify(manifest, null, 2) + '\n'
    const integrity = `sha512-${createHash('sha512').update(manifestText).digest('base64')}`
    await Promise.all([
      writeFile(resolve(dir, 'content.json'), JSON.stringify({ data }) + '\n'),
      writeFile(resolve(dir, 'presentation.json'), JSON.stringify({ ...presentation, locales }) + '\n'),
      writeFile(resolve(dir, 'pack.json'), manifestText),
      writeFile(
        resolve(dir, 'pack-lock.yaml'),
        YAML.stringify({
          lockfileVersion: 1,
          generatedAt: new Date().toISOString(),
          importers: {
            '.': {
              specifiers: {
                [manifest.id]: `workspace:@arcadia-eternity/data-pack-base#dist/pack.json`,
              },
              dependencies: {
                [manifest.id]: {
                  specifier: `workspace:@arcadia-eternity/data-pack-base#dist/pack.json`,
                  version: manifest.version,
                  packageKey: `/${manifest.id}@${manifest.version}`,
                },
              },
            },
          },
          packages: {
            [`/${manifest.id}@${manifest.version}`]: {
              name: manifest.id,
              version: manifest.version,
              kind: 'data',
              engine: manifest.engine,
              source: 'workspace:@arcadia-eternity/data-pack-base#dist/pack.json',
              entry: 'pack.json',
              provenance: 'workspace',
              resolution: { integrity },
              dependencies: {},
            },
          },
        }),
      ),
      writeFile(
        resolve(dir, 'catalog.json'),
        JSON.stringify({
          formatVersion: 1,
          build: identity,
          templates: [],
          effectIds: metadata.officialEffectIds,
          effectMarkRelations: metadata.officialEffectMarkRelations,
        }) + '\n',
      ),
      writeFile(
        resolve(dir, 'arcadia-effects.json'),
        JSON.stringify(
          await compileEffectModule(resolve(dir, 'effects.js'), root, '@arcadia-eternity/data-pack-base'),
        ) + '\n',
      ),
    ])
    await writeFile(
      resolve(dir, 'metadata.mjs'),
      [
        "import { createContentIndex } from '@arcadia-eternity/battle/engine';",
        ...Object.entries(metadata).map(
          ([name, value]) => `export const ${name} = Object.freeze(${JSON.stringify(value)});`,
        ),
        'export const createOfficialContentIndex = (data, revision) => createContentIndex(data, revision, { templates: [], effectIds: officialEffectIds });',
        '',
      ].join('\n'),
    )
    await writeFile(
      resolve(dir, 'metadata.d.ts'),
      [
        "import type { ContentPrototypeData, ContentIndex } from '@arcadia-eternity/battle/engine';",
        'export declare const officialEffectIds: readonly string[];',
        ...['officialEffectMarkRelations'].map(
          name => `export declare const ${name}: typeof import('./types/effects').${name};`,
        ),
        'export declare const createOfficialContentIndex: (data: ContentPrototypeData, revision: string) => ContentIndex;',
        '',
      ].join('\n'),
    )
    await writeFile(resolve(dir, 'environment-build.json'), JSON.stringify(identity, null, 2) + '\n')
    await writeFile(
      resolve(dir, 'native-build.mjs'),
      `export const nativeBuildIdentity = Object.freeze(${JSON.stringify(identity)});\n`,
    )
    await writeFile(
      resolve(dir, 'native-build.d.ts'),
      'export declare const nativeBuildIdentity: Readonly<{ formatVersion: 1; coreBuildId: string; registryBuildId: string }>;\n',
    )
    return identity
  } finally {
    await bundle.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await buildBaseEnvironmentArtifact()))
