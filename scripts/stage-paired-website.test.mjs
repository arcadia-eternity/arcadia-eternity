import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stagePairedWebsite } from './stage-paired-website.mjs'

test('staging rejects a JSON-only pack before replacing a complete distribution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-paired-website-'))
  const source = pathToFileURL(`${directory}/source/`)
  const target = pathToFileURL(`${directory}/target/`)
  try {
    for (const child of ['source/data', 'source/locales/zh-CN', 'source/dist', 'target'])
      await mkdir(join(directory, child), { recursive: true })
    const pack = {
      paths: { dataDir: 'data', localesDir: 'locales' },
      data: { species: ['species.yaml'] },
      locales: { 'zh-CN': ['webui'] },
      presentation: 'dist/presentation.json',
    }
    await writeFile(new URL('pack.json', source), JSON.stringify(pack))
    const contents = {
      'index.html': '<html><body>Arcadia</body></html>',
      'pack-lock.yaml': 'schemaVersion: 1',
      'dist/presentation.json': '{}',
      'data/species.json': '[{"id":"test.species"}]',
      'locales/zh-CN/webui.yaml': 'title: 星域永恒',
      'locales/zh-CN/webui.json': '{"title":"星域永恒"}',
    }
    for (const [path, content] of Object.entries(contents)) await writeFile(new URL(path, source), content)
    await writeFile(new URL('previous.txt', target), 'previous build')
    await assert.rejects(stagePairedWebsite(source, target, '1.0.0'), /missing.*data\/species.yaml/)
    assert.equal(await readFile(new URL('previous.txt', target), 'utf8'), 'previous build')

    await writeFile(new URL('data/species.yaml', source), '- id: test.species')
    await mkdir(new URL('arcadia-server/', source))
    await writeFile(new URL('arcadia-server/private.txt', source), 'backend-only')
    await mkdir(new URL('.arcadia-desktop-stage-test/', source))
    await writeFile(new URL('.arcadia-desktop-stage-test/private.txt', source), 'staging-only')
    await stagePairedWebsite(source, target, '1.0.0')
    await assert.rejects(readFile(new URL('arcadia-server/private.txt', target)), { code: 'ENOENT' })
    await assert.rejects(readFile(new URL('.arcadia-desktop-stage-test/private.txt', target)), { code: 'ENOENT' })
    assert.equal(await readFile(new URL('data/species.yaml', target), 'utf8'), '- id: test.species')
    assert.equal(
      await readFile(new URL('locales/zh-CN/webui.json', target), 'utf8'),
      contents['locales/zh-CN/webui.json'],
    )
    assert.deepEqual(JSON.parse(await readFile(new URL('arcadia-client.json', target), 'utf8')), {
      schemaVersion: 1,
      backendOrigin: '/',
    })
    assert.deepEqual(JSON.parse(await readFile(new URL('arcadia-web-manifest.json', target), 'utf8')), {
      schemaVersion: 1,
      protocolVersion: 1,
      version: '1.0.0',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('stages the website inside the renderer output without copying private runtime directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-nested-website-'))
  const source = pathToFileURL(`${directory}/`)
  const target = new URL('.arcadia-desktop-stage-test/runtime/web/', source)
  try {
    await writeFile(
      new URL('pack.json', source),
      JSON.stringify({
        data: {},
        locales: {},
        presentation: 'presentation.json',
      }),
    )
    await writeFile(new URL('index.html', source), '<html>Arcadia</html>')
    await writeFile(new URL('pack-lock.yaml', source), 'schemaVersion: 1')
    await writeFile(new URL('presentation.json', source), '{}')
    await mkdir(new URL('arcadia-server/', source))
    await writeFile(new URL('arcadia-server/private.txt', source), 'backend-only')
    await stagePairedWebsite(source, target, '1.0.0')
    assert.equal(await readFile(new URL('index.html', target), 'utf8'), '<html>Arcadia</html>')
    await assert.rejects(readFile(new URL('arcadia-server/private.txt', target)), { code: 'ENOENT' })
    await assert.rejects(readFile(new URL('.arcadia-desktop-stage-test/runtime/web/index.html', target)), {
      code: 'ENOENT',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
