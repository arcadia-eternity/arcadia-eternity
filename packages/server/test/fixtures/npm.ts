import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const exec = promisify(execFile)
export async function createNpmFixture(options: { presentation?: boolean; remoteUrl?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-server-npm-'))
  try {
    const repository = fileURLToPath(new URL('../../../../', import.meta.url))
    await exec('pnpm', ['exec', 'tsc', '-p', 'examples/ugc/slow/tsconfig.json'], { cwd: repository })
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
      await mkdir(join(source, 'assets'), { recursive: true })
      await writeFile(join(source, 'assets/icon.png'), asset)
      manifest.files.push('assets')
      manifest.arcadia.presentation = 'dist/presentation.json'
      await writeFile(
        join(source, 'dist/presentation.json'),
        JSON.stringify({
          version: 1,
          defaultLocale: 'zh-CN',
          resources: [
            {
              kind: 'file',
              id: 'assets/icon.png',
              source: 'assets/icon.png',
              sha256,
              bytes: asset.length,
              mime: 'image/png',
            },
            {
              kind: 'http',
              id: options.remoteUrl ?? 'http://127.0.0.1:1/not-fetched.swf',
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
    await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
    const content = JSON.parse(await readFile(join(source, 'content.json'), 'utf8'))
    for (const kind of ['species', 'skills', 'marks']) {
      for (const item of content.data[kind]) {
        item.name = `${kind} name`
        item.description = `${kind} description`
      }
    }
    if (options.presentation) {
      content.data.species[0].presentation = {
        icon: 'assets/icon.png',
        portrait: 'assets/icon.png',
        battle: {
          renderer: 'seer2-swf',
          source: options.remoteUrl ?? 'http://127.0.0.1:1/not-fetched.swf',
          fallback: 'assets/icon.png',
        },
      }
      content.data.marks[0].presentation = { icon: 'assets/icon.png' }
    }
    content.assets = [{ id: 'icon', variant: 'default', mime: 'image/png', bytes: asset.length, sha256 }]
    await writeFile(join(source, 'content.json'), JSON.stringify(content))
    const packed = await exec('npm', ['pack', '--ignore-scripts', '--json'], { cwd: source })
    await mkdir(directory)
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'server-fixture',
        version: '1.0.0',
        private: true,
        dependencies: { [manifest.name]: `file:${join(source, JSON.parse(packed.stdout)[0].filename)}` },
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
