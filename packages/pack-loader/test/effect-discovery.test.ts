import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { compileEffectModule } from '../src/npm/effect-artifact'
import { ArenaEffectModule } from '@arcadia-eternity/battle/sandbox/effects'
import * as sdk from '@arcadia-eternity/battle/authoring'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(resolve('.effect-discovery-'))
  roots.push(root)
  return root
}
const source = (id: string) => `
import {effect,on} from '@arcadia-eternity/battle/effect-loading';
import {EffectTrigger} from '@arcadia-eternity/battle/authoring';
@effect({id:${JSON.stringify(id)},sourceKind:'skill'})
export class Example {
  @on(EffectTrigger.OnHit)
  static apply(context) {}
}`
async function ids(root: string) {
  const artifact = await compileEffectModule(root, resolve('../..'), 'fixture')
  expect(artifact.source).not.toContain('@effect(')
  const module = await ArenaEffectModule.prepare(artifact)
  try {
    return module.createEffects({ sdk, marks: new Map(), id: local => `fixture:${local}` }).map(effect => effect.id)
  } finally {
    module.dispose()
  }
}
it('discovers decorated effects, lowers standard decorators and runs them through the real Arena SDK', async () => {
  const root = await fixture()
  await writeFile(join(root, 'first.effect.ts'), source('first'))
  await writeFile(join(root, 'helper.ts'), "throw Error('helpers are not discovered')")
  expect(await ids(root)).toEqual(['fixture:first'])
  await writeFile(join(root, 'second.effect.ts'), source('second'))
  expect(await ids(root)).toEqual(['fixture:first', 'fixture:second'])
  await rm(join(root, 'first.effect.ts'))
  expect(await ids(root)).toEqual(['fixture:second'])
}, 30_000)
it('does not execute author module initialization during preparation', async () => {
  const root = await fixture()
  await writeFile(join(root, 'side-effect.effect.ts'), `throw Error('author initialization');\n${source('one')}`)
  const artifact = await compileEffectModule(root, resolve('../..'), 'fixture')
  await expect(ArenaEffectModule.prepare(artifact)).rejects.toThrow('author initialization')
})
it('rejects duplicate decorated identities and source symlinks', async () => {
  const root = await fixture()
  await writeFile(join(root, 'a.effect.ts'), source('same'))
  await writeFile(join(root, 'b.effect.ts'), source('same'))
  await expect(ids(root)).rejects.toThrow('Duplicate effect')
  await symlink(join(root, 'a.effect.ts'), join(root, 'escape.effect.ts'))
  await expect(compileEffectModule(root, resolve('../..'), 'fixture')).rejects.toThrow('symlink')
})
it('rejects malformed decorated TypeScript rather than emitting recovered JavaScript', async () => {
  const root = await fixture()
  await writeFile(join(root, 'broken.effect.ts'), `${source('broken')}\nconst broken: = 1;`)
  await expect(compileEffectModule(root, resolve('../..'), 'fixture')).rejects.toThrow('Type expected')
})
it('rejects fixed catalog groups in ordinary behavior packages instead of silently dropping them', async () => {
  const root = await fixture()
  await writeFile(
    join(root, 'group.effect.ts'),
    `
import {effectGroup} from '@arcadia-eternity/battle/effect-loading';
@effectGroup({id:'group'}) export class Group { static build(){ return {} } }`,
  )
  await expect(ids(root)).rejects.toThrow('Fixed effect groups require a catalog host')
})
it('rebuilds the generated entry when an effect file is added or removed in watch mode', async () => {
  const { watch } = await import('rolldown')
  const { effectDiscoveryPlugin } = await import('../src/npm/effect-discovery')
  const { mkdir, readFile } = await import('node:fs/promises')
  const root = await fixture(),
    directory = join(root, 'src/effects'),
    output = join(root, 'bundle.js')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'first.effect.ts'), source('watch-first'))
  const watcher = watch({
    input: 'virtual:arcadia-effects',
    output: { file: output, format: 'esm' },
    plugins: [effectDiscoveryPlugin(root)],
    external: id => id.startsWith('@arcadia-eternity/'),
  })
  const pending: import('rolldown').RolldownWatcherEvent[] = []
  let notify: (() => void) | undefined
  watcher.on('event', event => {
    if (event.code === 'END' || event.code === 'ERROR') {
      pending.push(event)
      notify?.()
    }
  })
  async function next() {
    if (!pending.length)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          notify = undefined
          reject(new Error('Discovery watcher did not rebuild'))
        }, 10_000)
        notify = () => {
          clearTimeout(timeout)
          notify = undefined
          resolve()
        }
      })
    const event = pending.shift()!
    if (event.code === 'ERROR') throw event.error
    return event
  }
  try {
    await next()
    await writeFile(join(directory, 'second.effect.ts'), source('watch-second'))
    await next()
    expect(await readFile(output, 'utf8')).toContain('watch-second')
    await rm(join(directory, 'first.effect.ts'))
    await next()
    expect(await readFile(output, 'utf8')).not.toContain('watch-first')
  } finally {
    await watcher.close()
  }
}, 30_000)
