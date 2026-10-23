import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'
import { parse } from 'yaml'

const root = resolve('packs/base/src')
const directory = await mkdtemp(join(tmpdir(), 'arcadia-native-content-'))
const modules = []
try {
  const entry = join(directory, 'entry.ts')
  await writeFile(entry, `export { createOfficialContent } from ${JSON.stringify(join(root, 'content.ts'))};`)
  const build = await rolldown({
    input: entry,
    platform: 'browser',
    plugins: [
      {
        name: 'native-content-boundary',
        moduleParsed(info) {
          modules.push(info.id)
          if (
            /\/legacy\/(?:effectBuilder\/|schema\/effect(?:Dsl|Schema)\.|parser\/(?:parseEffect|effect)\.)/.test(
              info.id,
            )
          )
            throw new Error(`Legacy effect DSL dependency: ${info.id}`)
          if (/(?:^|\/)(?:rxjs|prando)(?:@|\/)/.test(info.id)) throw new Error(`Removed runtime dependency: ${info.id}`)
          if (
            /packages\/(?:engine|engine-plugins|server|database|rules|web-ui|interface|p2p-transport)\//.test(info.id)
          )
            throw new Error(`Foreign runtime dependency: ${info.id}`)
        },
      },
    ],
  })
  const output = join(directory, 'browser.mjs')
  try {
    await build.write({ file: output, format: 'esm', codeSplitting: false, minify: true })
  } finally {
    await build.close()
  }
  const { createOfficialContent } = await import(pathToFileURL(output).href)
  const manifest = JSON.parse(await readFile('packs/base/pack.json', 'utf8'))
  const data = {}
  for (const kind of ['marks', 'skills', 'species']) {
    data[kind] = []
    for (const file of manifest.data[kind])
      data[kind].push(...parse(await readFile(resolve('packs/base/data', file), 'utf8'), { merge: true }))
  }
  const content = createOfficialContent(data, 'native-browser-verifier/current-build')
  const counts = Object.fromEntries(['effects', 'marks', 'skills', 'species'].map(kind => [kind, content[kind].length]))
  assert.deepEqual(counts, { effects: 1065, marks: 416, skills: 966, species: 145 })
  console.log(
    JSON.stringify({ minifiedBrowserModule: true, modules: modules.length, legacyEffectDsl: false, ...counts }),
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
