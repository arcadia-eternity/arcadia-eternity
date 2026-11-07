import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { compileEffectModule, stageCatalogProject } from '@arcadia-eternity/pack-loader/node'

const exec = promisify(execFile)
const shippedCatalogRoot = fileURLToPath(new URL('../../../../packs/base/', import.meta.url))
const shippedCatalog = JSON.parse(readFileSync(join(shippedCatalogRoot, 'package.json'), 'utf8'))
export const shippedCatalogMembers: Record<string, string> = { [shippedCatalog.name]: shippedCatalog.version }
export const stageShippedCatalog = (root: string) => stageCatalogProject(root, shippedCatalogRoot)

export async function createNpmFixture(
  options: {
    presentation?: boolean
    remoteUrl?: string
    prebuilt?: boolean
    forbidHostExecution?: boolean
    includeCatalog?: boolean
  } = {},
) {
  if (options.forbidHostExecution && !options.prebuilt) throw new Error('forbidHostExecution requires prebuilt')
  const root = await mkdtemp(join(tmpdir(), 'arcadia-server-npm-'))
  try {
    const repository = fileURLToPath(new URL('../../../../', import.meta.url))
    await exec(
      process.execPath,
      [resolve(repository, 'node_modules/typescript/bin/tsc'), '-p', 'examples/ugc/slow/tsconfig.json'],
      { cwd: repository },
    )
    const source = join(root, 'source'),
      directory = join(root, 'server')
    await cp(resolve(repository, 'examples/ugc/slow'), source, { recursive: true })
    const asset = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const sha256 = createHash('sha256').update(asset).digest('hex')
    await writeFile(join(source, 'icon.png'), asset)
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    manifest.files.push('icon.png')
    manifest.arcadia.assets = { [sha256]: 'icon.png' }
    if (options.presentation) {
      // Presentation v2 owns these resources; do not also publish the legacy icon/default entry.
      delete manifest.arcadia.assets
      await mkdir(join(source, 'assets'), { recursive: true })
      await writeFile(join(source, 'assets/icon.png'), asset)
      manifest.files.push('assets')
      manifest.arcadia.presentation = 'dist/presentation.json'
      await writeFile(
        join(source, 'dist/presentation.json'),
        JSON.stringify({
          version: 2,
          bindings: [
            {
              id: 'pet-display',
              target: { kind: 'species', id: 'pet' },
              icon: 'icon',
              portrait: 'icon',
              battle: { renderer: 'seer2-swf', source: 'animation', fallback: 'icon' },
            },
            { id: 'mark-display', target: { kind: 'marks', id: 'slow' }, icon: 'icon' },
          ],
          defaultLocale: 'zh-CN',
          resources: [
            {
              kind: 'file',
              id: 'icon',
              source: 'assets/icon.png',
              sha256,
              bytes: asset.length,
              mime: 'image/png',
            },
            {
              kind: 'http',
              id: 'animation',
              source: options.remoteUrl ?? 'http://127.0.0.1:1/not-fetched.swf',
              mime: 'application/x-shockwave-flash',
            },
          ],
          locales: {
            'zh-CN': {
              species: { pet: { name: '展示精灵' } },
              skill: {
                strike: {
                  description: '造成 <damage>{power}</damage> 点伤害，并施加 <mark>example-slow:slow</mark>。',
                },
              },
              mark: { slow: { name: '减速', description: '剩余 {stack} 层' } },
            },
            en: {
              species: { pet: { name: 'Display pet' } },
              skill: { strike: { description: 'Deal <damage>{power}</damage> damage.' } },
            },
          },
        }),
      )
    }
    const executionMarker = options.forbidHostExecution ? join(root, 'author-evaluated') : undefined
    if (options.prebuilt) {
      // Author-side build completes before publication. Consumers only read the packed artifact.
      const effects = join(source, manifest.arcadia.effects)
      const artifact = await compileEffectModule(effects, source, manifest.name)
      const published = options.forbidHostExecution
        ? { ...artifact, source: `throw new Error('AUTHOR_ARTIFACT_MUST_NOT_EXECUTE_ON_SERVER');\n${artifact.source}` }
        : artifact
      manifest.arcadia.effectArtifact = 'dist/effects.artifact.json'
      if (!manifest.files.includes('dist')) manifest.files.push('dist/effects.artifact.json')
      await writeFile(join(source, manifest.arcadia.effectArtifact), JSON.stringify(published))
      if (executionMarker)
        await writeFile(
          effects,
          `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(executionMarker)}, 'evaluated');\nexport function createEffects() { throw new Error('AUTHOR_SOURCE_EXECUTED'); }`,
        )
    }
    await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
    const content = JSON.parse(await readFile(join(source, 'content.json'), 'utf8'))
    for (const kind of ['species', 'skills', 'marks']) {
      for (const item of content.data[kind]) {
        item.name = `${kind} name`
        item.description = `${kind} description`
      }
    }
    content.assets = options.presentation
      ? []
      : [{ id: 'icon', variant: 'default', mime: 'image/png', bytes: asset.length, sha256 }]
    await writeFile(join(source, 'content.json'), JSON.stringify(content))
    const packed = await exec('npm', ['pack', '--ignore-scripts', '--json'], { cwd: source })
    const dependencies = { [manifest.name]: `file:${join(source, JSON.parse(packed.stdout)[0].filename)}` }
    if (options.includeCatalog) {
      const base = join(root, 'catalog')
      const packageRoot = join(repository, 'packs/base')
      const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
      await mkdir(join(base, 'dist'), { recursive: true })
      for (const field of ['content', 'presentation', 'effectArtifact', 'catalog'])
        await cp(join(packageRoot, metadata.arcadia[field]), join(base, metadata.arcadia[field]))
      await cp(join(packageRoot, 'assets'), join(base, 'assets'), { recursive: true })
      await cp(join(packageRoot, metadata.arcadiaEternityPack), join(base, metadata.arcadiaEternityPack))
      await writeFile(
        join(base, 'package.json'),
        JSON.stringify({
          name: metadata.name,
          version: metadata.version,
          arcadia: metadata.arcadia,
          arcadiaEternityPack: metadata.arcadiaEternityPack,
        }),
      )
      const { stdout } = await exec('npm', ['pack', '--ignore-scripts', '--json'], { cwd: base })
      dependencies[metadata.name] = `file:${join(base, JSON.parse(stdout)[0].filename)}`
    }
    await mkdir(directory)
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'server-fixture',
        version: '1.0.0',
        private: true,
        dependencies,
      }),
    )
    await exec('npm', ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: directory,
    })
    const approve = async () => {
      await writeFile(
        join(directory, 'arcadia-admission.json'),
        JSON.stringify({
          format: 'arcadia.npm-admission',
          version: 2,
          profile: 'local-development',
        }),
      )
    }
    await approve()
    return {
      directory,
      executionMarker,
      installedDirectory: join(directory, 'node_modules', manifest.name),
      asset,
      approve,
      async editEffects(edit: (code: string) => string) {
        const file = join(directory, 'node_modules', manifest.name, 'dist/effects.js')
        await writeFile(file, edit(await readFile(file, 'utf8')))
      },
      async changePower(power: number) {
        const file = join(directory, 'node_modules', manifest.name, 'content.json')
        const content = JSON.parse(await readFile(file, 'utf8'))
        content.data.skills[0].power = power
        await writeFile(file, JSON.stringify(content))
      },
      dispose: () => rm(root, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
