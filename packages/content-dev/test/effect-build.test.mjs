import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEffects } from '../src/effect-build.ts'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-effect-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src/effects'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      arcadia: { effectSources: 'src/effects', effectArtifact: 'dist/arcadia-effects.json' },
    }),
  )
  return root
}
test('builds a closed artifact using the SDK without a handwritten entry', async t => {
  const root = await fixture(t)
  await writeFile(
    join(root, 'src/effects/example.effect.ts'),
    `
import {effect,on,EffectTrigger} from '@arcadia-eternity/content-sdk';
@effect({id:'example',sourceKind:'skill'}) export class Example {
 @on(EffectTrigger.OnHit) static apply(context) {}
}`,
  )
  await buildEffects(root)
  const artifact = JSON.parse(await readFile(join(root, 'dist/arcadia-effects.json'), 'utf8'))
  assert.equal(artifact.packageId, 'fixture')
  assert.doesNotMatch(artifact.source, /@effect\(/)
})
test('refuses output and input directories redirected outside the project', async t => {
  const root = await fixture(t),
    outside = await fixture(t)
  await symlink(outside, join(root, 'dist'), 'dir')
  await assert.rejects(buildEffects(root), /regular project directories/)
  await assert.rejects(readFile(join(outside, 'arcadia-effects.json')))
  await rm(join(root, 'dist'))
  await rm(join(root, 'src/effects'), { recursive: true })
  await symlink(outside, join(root, 'src/effects'), 'dir')
  await assert.rejects(buildEffects(root), /source escapes project/)
})
