import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { publishedTags } from './resolve-release-tags.mjs'

const manifestPath = '.release-please-manifest.json'
const basePath = 'packs/base/package.json'
const versions = { '.': '4.17.0', packs: '4.14.0' }

test('retries recover the missing paired output and the client stages the tagged content', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'paired-release-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' })
  git('init', '--quiet')
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release@example.test')
  const client = 'arcadia-eternity-v' + versions['.']
  const content = 'data-pack-base-v' + versions.packs
  writeFileSync(join(cwd, manifestPath), JSON.stringify(versions))
  for (const dir of ['base', 'environment-default', 'environment-training-120']) {
    mkdirSync(join(cwd, 'packs', dir), { recursive: true })
    writeFileSync(
      join(cwd, 'packs', dir, 'package.json'),
      JSON.stringify({
        name: '@arcadia-eternity/' + (dir === 'base' ? 'data-pack-base' : dir),
        version: versions.packs,
      }),
    )
  }
  git('add', '.')
  git('commit', '-qm', 'paired release')
  git('tag', '-am', 'client', client)
  assert.deepEqual(publishedTags(client, '', cwd), { client, content: '' })
  git('tag', content)
  assert.deepEqual(publishedTags('', content, cwd), { client, content })
  assert.deepEqual(publishedTags(client, '', cwd), { client, content })
  writeFileSync(join(cwd, basePath), '{}')
  execFileSync(process.execPath, [fileURLToPath(new URL('./stage-released-base.mjs', import.meta.url))], { cwd })
  assert.equal(JSON.parse(readFileSync(join(cwd, basePath))).version, versions.packs)
  const later = 'arcadia-eternity-v4.17.1'
  git('commit', '--allow-empty', '-qm', 'later client')
  git('tag', later)
  assert.deepEqual(publishedTags(later, '', cwd), { client: later, content: '' })
})
