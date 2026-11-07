import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { rolldown, watch, type RolldownWatcherEvent } from 'rolldown'
import { effectModulePlugin } from '../../../scripts/effect-module-plugin'

it.each(['resolve', 'load'] as const)(
  'returns the default effect artifact through the %s hook for Vite-normalized Windows IDs',
  async route => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-windows-effects-'))
    const entry = join(root, 'effects.ts')
    const request = '@fixture/content/effects?effect-module'
    const windowsEntry = 'D:\\a\\arcadia-eternity\\packs\\base\\dist\\effects.js?effect-module'
    const normalizedEntry = 'D:/a/arcadia-eternity/packs/base/dist/effects.js?effect-module'
    const source = "export function createEffects(){return ['windows-artifact']}"
    let fileFallbackResolved = false
    await writeFile(entry, source)
    try {
      const bundle = await rolldown({
        input: '\0host',
        plugins: [
          {
            name: 'fixture-vite-resolver',
            resolveId(id) {
              if (id === '\0host') return id
              // Vite resolves package imports before normal user plugins and
              // hands load hooks a slash-normalized absolute Windows path.
              if (route === 'load' && id === request) return normalizedEntry
            },
            load(id) {
              if (id === '\0host')
                return `export { default } from ${JSON.stringify(route === 'load' ? request : normalizedEntry)}`
            },
          },
          effectModulePlugin({ [windowsEntry]: { entry, packageId: '@fixture/content' } }, root),
          {
            name: 'fixture-file-fallback',
            resolveId(id) {
              if (id === normalizedEntry) {
                fileFallbackResolved = true
                return id
              }
            },
            load(id) {
              // Like Vite's file fallback: ordinary effects have no default
              // artifact export, so missing the adapter must fail the build.
              if (id === normalizedEntry) return source
            },
          },
        ],
      })
      try {
        const { output } = await bundle.generate({ format: 'esm' })
        expect(fileFallbackResolved).toBe(false)
        expect(output).toHaveLength(1)
        expect(output[0].type).toBe('chunk')
        if (output[0].type !== 'chunk') throw Error('Expected host JavaScript')
        const { default: artifact } = await import(
          /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
        )
        expect(artifact).toMatchObject({
          format: 'arcadia.effect-module',
          version: 1,
          sdkApi: 2,
          packageId: '@fixture/content',
        })
        expect(artifact.source).toContain('windows-artifact')
        expect(artifact.source).toContain('createEffects')
      } finally {
        await bundle.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

it('rebuilds host-owned effect text after dependency edits and syntax-error recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-host-effects-'))
  const entry = join(root, 'effects.ts'),
    helper = join(root, 'helper.ts'),
    output = join(root, 'host.js')
  await writeFile(entry, "export {createEffects} from './helper.ts'")
  await writeFile(helper, "export function createEffects(){return ['before']}")
  await writeFile(join(root, 'host.ts'), "export {default} from 'fixture?effect-module'")
  const watcher = watch({
    input: join(root, 'host.ts'),
    output: { file: output, format: 'esm' },
    plugins: [effectModulePlugin({ 'fixture?effect-module': { entry, packageId: 'fixture' } }, root)],
  })
  const pending: RolldownWatcherEvent[] = []
  let notify: (() => void) | undefined
  watcher.on('event', event => {
    if (event.code === 'BUNDLE_END' || event.code === 'ERROR') {
      pending.push(event)
      notify?.()
    }
  })
  async function next() {
    if (!pending.length)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Host effect watcher did not rebuild')), 10_000)
        notify = () => {
          clearTimeout(timeout)
          notify = undefined
          resolve()
        }
      })
    return pending.shift()!
  }
  try {
    expect((await next()).code).toBe('BUNDLE_END')
    expect(await readFile(output, 'utf8')).toContain('before')
    await writeFile(helper, "export function createEffects(){return ['after']}")
    expect((await next()).code).toBe('BUNDLE_END')
    expect(await readFile(output, 'utf8')).toContain('after')
    await writeFile(helper, 'export function createEffects( {')
    expect((await next()).code).toBe('ERROR')
    await writeFile(helper, "export function createEffects(){return ['repaired']}")
    expect((await next()).code).toBe('BUNDLE_END')
    expect(await readFile(output, 'utf8')).toContain('repaired')
    expect(await readFile(entry, 'utf8')).not.toContain('arcadia.effect-module')
  } finally {
    await watcher.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
