// Copied into the isolated release test project; all imports resolve installed packages.
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NativePackLoader } from '@arcadia-eternity/pack-loader/native'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/native'
import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { nativeBuildIdentity as core } from '@arcadia-eternity/battle/v4/build'

const root = dirname(fileURLToPath(import.meta.resolve('@arcadia-eternity/data-pack-base/package.json')))
assert.equal(nativeBuildIdentity.coreBuildId, core.coreBuildId)
const loaded = await new NativePackLoader(nativeBuildIdentity, createOfficialContent).load(join(root, 'pack.json'))
assert.deepEqual(
  Object.fromEntries(['effects', 'marks', 'skills', 'species'].map(kind => [kind, loaded.content[kind].length])),
  {
    effects: 1065,
    marks: 416,
    skills: 966,
    species: 145,
  },
)
assert.equal(loaded.errors.length, 0)
assert.ok(Object.keys(loaded.locales).length > 0)
console.log('Installed base package: official effects, species, skills, marks and locales loaded')
