import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setup } from '../src/setup.mjs'

test('setup rejects incomplete or corrupted development archives before installing anything', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-tool-setup-'))
  try {
    await mkdir(join(root, 'sdk'))
    await mkdir(join(root, '.arcadia'))
    await writeFile(join(root, '.arcadia/sdk-installed.json'), 'previous installation')
    const pin = { sdkApi: 2, revision: 'a'.repeat(40), pnpmVersion: '11.21.0' }
    await writeFile(join(root, 'arcadia-sdk.json'), JSON.stringify(pin))
    const bytes = Buffer.from('not an npm archive')
    const records = []
    for (const name of ['battle', 'const', 'interface', 'pack-loader', 'protocol', 'schema']) {
      await writeFile(join(root, 'sdk', `${name}.tgz`), bytes)
      records.push({
        name: `@arcadia-eternity/${name}`,
        filename: `${name}.tgz`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    }
    const index = {
      format: 'arcadia.author-sdk-local',
      version: 1,
      sdkApi: 2,
      build: { formatVersion: 1, coreBuildId: 'a'.repeat(64), registryBuildId: 'b'.repeat(64) },
      packages: records,
    }
    const manifest = join(root, 'sdk/arcadia-author-sdk.json')
    await writeFile(manifest, JSON.stringify(index))
    const args = ['--sdk-dir', join(root, 'sdk'), '--offline']
    await assert.rejects(setup(args, root), /Missing SDK packages: @arcadia-eternity\/content-dev/)
    index.packages[0].sha256 = '0'.repeat(64)
    await writeFile(manifest, JSON.stringify(index))
    await assert.rejects(setup(args, root), /checksum mismatch: battle.tgz/)
    assert.equal(await readFile(join(root, '.arcadia/sdk-installed.json'), 'utf8'), 'previous installation')
    await assert.rejects(setup(['--offline'], root), /Prepare an SDK first/)
    await assert.rejects(setup(['--sdk-dir'], root), /incomplete option/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
