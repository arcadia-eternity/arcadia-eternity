import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rolldown } from 'rolldown'
import { isExternalDependency } from './rollup-external.mjs'

test('resolved Windows drive and UNC paths stay internal, package imports stay external', () => {
  for (const id of [
    'D:/a/arcadia-eternity/packages/const/src/index.ts',
    String.raw`D:\a\arcadia-eternity\packages\const\src\index.ts`,
    String.raw`\\build-server\workspace\packages\const\src\index.ts`,
    '//build-server/workspace/packages/const/src/index.ts',
    '/workspace/packages/const/src/index.ts',
    './src/index.ts',
    '../src/index.ts',
    String.fromCharCode(0) + 'effect-module:official',
  ])
    assert.equal(isExternalDependency(id), false, id)
  for (const id of ['node:fs', 'rolldown', '@arcadia-eternity/battle/engine', 'pg'])
    assert.equal(isExternalDependency(id), true, id)
})

test('Rolldown includes a Windows-resolved source instead of emitting a broken dist re-export', async () => {
  const sourceId = 'D:/a/arcadia-eternity/packages/const/src/index.ts'
  const build = await rolldown({
    input: 'entry.ts',
    external: isExternalDependency,
    plugins: [
      {
        name: 'windows-resolved-source-fixture',
        resolveId(id) {
          if (id === 'entry.ts') return String.fromCharCode(0) + 'entry'
          if (id === './src/index.ts') return sourceId
        },
        load(id) {
          if (id === String.fromCharCode(0) + 'entry') return 'export * from "./src/index.ts"'
          if (id === sourceId) return 'export const windowsBundled = 42'
        },
      },
    ],
  })
  try {
    const result = await build.generate({ format: 'esm' })
    assert.equal(result.output.length, 1)
    const chunk = result.output[0]
    assert.equal(chunk.type, 'chunk')
    assert.deepEqual(chunk.imports, [])
    assert.doesNotMatch(chunk.code, /export\s*\*\s*from\s*['"]/)
    const module = await import('data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64'))
    assert.equal(module.windowsBundled, 42)
  } finally {
    await build.close()
  }
})

test('every workspace package config bundles Windows sources while preserving external packages', async () => {
  for (const directory of [
    'packages/const',
    'packages/schema',
    'packages/protocol',
    'packages/interface',
    'packages/battle',
    'packages/pack-loader',
    'packages/database',
    'packages/server',
    'packages/client',
    'packages/console',
    'packages/p2p-transport',
    'packs/base',
  ]) {
    const { default: config } = await import(new URL('../' + directory + '/rolldown.config.js', import.meta.url))
    assert.equal(config.external('D:/checkout/' + directory + '/src/index.ts'), false, directory)
    assert.equal(config.external(String.raw`\\build-server\workspace\src\index.ts`), false, directory)
    assert.equal(config.external('./src/index.ts'), false, directory)
    assert.equal(config.external(String.fromCharCode(0) + 'virtual'), false, directory)
    assert.equal(config.external('node:fs'), true, directory)
    assert.equal(config.external('@arcadia-eternity/schema'), true, directory)
  }
})
