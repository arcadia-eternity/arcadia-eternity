import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { prepareContentPack } from '../src/testing.mjs'
const exec = promisify(execFile)

test('the shared harness accepts data-only packs with cached npm runtime dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-content-harness-'))
  const cache = join(root, 'npm-cache')
  const originalRegistry = process.env.npm_config_registry
  let prepared, server
  try {
    const dependency = join(root, 'dependency')
    await mkdir(dependency)
    await writeFile(
      join(dependency, 'package.json'),
      JSON.stringify({ name: 'arcadia-test-runtime', version: '1.0.0' }),
    )
    await writeFile(join(dependency, 'index.js'), 'module.exports = 42\n')
    const packed = JSON.parse(
      (await exec('npm', ['pack', '--json', '--ignore-scripts', '--cache', cache], { cwd: dependency })).stdout,
    )[0]
    const bytes = await readFile(join(dependency, packed.filename))
    let registry
    server = createServer((request, response) => {
      if (request.url === '/-/runtime.tgz') {
        response.end(bytes)
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          name: 'arcadia-test-runtime',
          versions: {
            '1.0.0': {
              name: 'arcadia-test-runtime',
              version: '1.0.0',
              dist: { tarball: registry + '-/runtime.tgz', shasum: createHash('sha1').update(bytes).digest('hex') },
            },
          },
        }),
      )
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    registry = `http://127.0.0.1:${server.address().port}/`
    await exec('npm', [
      'cache',
      'add',
      'arcadia-test-runtime@1.0.0',
      '--cache',
      cache,
      '--registry',
      registry,
      '--ignore-scripts',
    ])
    await new Promise(resolve => server.close(resolve))
    const project = join(root, 'pack')
    await mkdir(join(project, 'dist'), { recursive: true })
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({
        name: '@test/data-only',
        version: '1.0.0',
        files: ['dist'],
        dependencies: { 'arcadia-test-runtime': '1.0.0' },
        arcadia: { formatVersion: 1, projectId: 'data-only', namespace: 'data-only', content: 'dist/content.json' },
      }),
    )
    await writeFile(
      join(project, 'dist/content.json'),
      JSON.stringify({ data: { species: [], skills: [], marks: [], behaviors: [] } }),
    )
    await writeFile(join(project, 'arcadia.config.mjs'), 'export default { players: () => [] }\n')
    process.env.npm_config_registry = registry
    prepared = await prepareContentPack(project, { cache })
    assert.equal(prepared.manifest.name, '@test/data-only')
    assert.deepEqual(prepared.files, ['dist/content.json', 'package.json'])
    assert.ok(prepared.environment.revision)
  } finally {
    if (originalRegistry === undefined) delete process.env.npm_config_registry
    else process.env.npm_config_registry = originalRegistry
    server?.close()
    await prepared?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
