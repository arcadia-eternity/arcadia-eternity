import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildOffline } from './build-offline.mjs'

test('offline builds exclude host configuration and stale worker output, retaining real assets', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'arcadia-offline-'))
  try {
    await mkdir(join(dist, 'assets'))
    for (const [path, body] of Object.entries({
      'index.html': '<html>game</html>',
      _headers: '/*\n  X-Frame-Options: DENY',
      _redirects: '/* /index.html 200',
      'offline-worker-old.js': 'stale',
      'offline-manifest.json': '{}',
      'assets/battle.js': 'console.log("game")',
      'assets/battle.js.map': '{}',
    }))
      await writeFile(join(dist, path), body)
    const first = await buildOffline(dist)
    assert.deepEqual(
      first.files.map(file => file.path),
      ['assets/battle.js', 'index.html'],
    )
    assert.equal(
      first.bytes,
      first.files.reduce((sum, file) => sum + file.size, 0),
    )
    assert.equal((await buildOffline(dist)).version, first.version)
    await writeFile(join(dist, 'assets/battle.js'), 'console.log("updated")')
    const updated = await buildOffline(dist)
    assert.notEqual(updated.version, first.version)
    const worker = await readFile(join(dist, updated.worker), 'utf8')
    assert.ok(worker.includes(updated.version))
    assert.ok(!worker.includes('_headers'))
  } finally {
    await rm(dist, { recursive: true, force: true })
  }
})
