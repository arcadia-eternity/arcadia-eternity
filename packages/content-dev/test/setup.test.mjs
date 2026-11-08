import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setup } from '../src/setup.mjs'

test('setup rejects incomplete manifests and unsafe archive paths before installation', async () => {
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
    await assert.rejects(setup(args, root), /Missing SDK packages: @arcadia-eternity\/content-sdk/)
    index.packages[0].filename = '../battle.tgz'
    await writeFile(manifest, JSON.stringify(index))
    await assert.rejects(setup(args, root), /Unexpected or duplicated SDK archive/)
    assert.equal(await readFile(join(root, '.arcadia/sdk-installed.json'), 'utf8'), 'previous installation')
    await assert.rejects(setup(['--offline'], root), /Prepare an SDK first/)
    await assert.rejects(setup(['--sdk-dir'], root), /incomplete option/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
