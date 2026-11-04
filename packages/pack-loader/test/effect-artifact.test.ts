import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { compileEffectModule } from '../src/npm/effect-artifact'
import { ArenaEffectModule } from '@arcadia-eternity/battle/v4/sandbox/effects'
import * as sdk from '@arcadia-eternity/battle/v4/authoring'

const temporary: string[] = []
afterEach(async () => {
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true })
})
async function source(code: string) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-artifact-'))
  temporary.push(root)
  const entry = join(root, 'effects.ts')
  await writeFile(entry, code)
  return { root, entry }
}
it('bundles TypeScript and SDK imports without evaluating author top-level statements in Node', async () => {
  const { root, entry } =
    await source(`import {defineCodeEffect,EffectTrigger} from '@arcadia-eternity/battle/v4/authoring';
    (globalThis as unknown as {artifactMarker:number}).artifactMarker=1;
    export function createEffects(){return [defineCodeEffect({id:'probe/tick',sourceKind:'skill',triggers:[EffectTrigger.TurnEnd],apply(){}})]}`)
  const artifact = await compileEffectModule(entry, root, 'probe')
  expect(Reflect.get(globalThis, 'artifactMarker')).toBeUndefined()
  const module = await ArenaEffectModule.prepare(artifact)
  try {
    expect(module.createEffects({ sdk, marks: new Map(), id: id => id })[0].id).toBe('probe/tick')
  } finally {
    module.dispose()
  }
  expect(Reflect.get(globalThis, 'artifactMarker')).toBeUndefined()
})
it.each([
  "import fs from 'node:fs';export function createEffects(){fs.readFileSync('x')}",
  'export function createEffects(){const moduleName=globalThis.name;return import(moduleName)}',
])('rejects privileged and unresolved runtime dependencies', async code => {
  const { root, entry } = await source(code)
  await expect(compileEffectModule(entry, root, 'probe')).rejects.toThrow()
})
it('rejects a dependency symlink outside the captured installation', async () => {
  const { root, entry } = await source("import {value} from './outside.ts';export const createEffects=()=>value")
  const external = await source('export const value=[]')
  await symlink(external.entry, join(root, 'outside.ts'))
  await expect(compileEffectModule(entry, root, 'probe')).rejects.toThrow(/escapes/)
})
