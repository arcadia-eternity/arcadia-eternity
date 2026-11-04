import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { watch, type RolldownWatcherEvent } from 'rolldown'
import { effectModulePlugin } from '../../../scripts/effect-module-plugin'

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
