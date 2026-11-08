import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { watchContentDev } from '../watch.mjs'

async function eventually(check) {
  const deadline = Date.now() + 10000
  for (;;) {
    try {
      await check()
      return
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await delay(30)
    }
  }
}

test('watch rebuilds sources, templates and bundled skills, removes stale files and recovers after failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-content-watch-'))
  const directory = join(root, 'packages/content-dev')
  let watcher
  t.after(async () => {
    await watcher?.close()
    await rm(root, { recursive: true, force: true })
  })
  for (const dir of ['src', 'template']) await mkdir(join(directory, dir), { recursive: true })
  for (const skill of ['ugc-authoring-agent', 'seer2-recreate-pet']) {
    await mkdir(join(root, 'docs/guides', skill), { recursive: true })
    await writeFile(join(root, 'docs/guides', skill, 'SKILL.md'), 'original skill')
  }
  await cp(new URL('../build.mjs', import.meta.url), join(directory, 'build.mjs'))
  await symlink(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(directory, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await writeFile(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { declaration: true, types: [], outDir: 'dist', rootDir: 'src' },
      include: ['src/*.mts'],
    }),
  )
  await writeFile(join(directory, 'src/index.mts'), 'export type Example = string')
  const originalBuild = await readFile(join(directory, 'build.mjs'), 'utf8')
  for (const file of ['cli.mjs', 'mcp.mjs', 'removable.mjs'])
    await writeFile(join(directory, 'src', file), '// original')
  await writeFile(join(directory, 'template/example.txt'), 'original template')
  const errors = []
  watcher = await watchContentDev(directory, { onBuild() {}, onError: error => errors.push(error) })
  assert.equal(await readFile(join(directory, 'dist/cli.mjs'), 'utf8'), '// original')
  assert.match(await readFile(join(directory, 'dist/index.d.mts'), 'utf8'), /export type Example = string/)

  await writeFile(join(directory, 'src/cli.mjs'), '// changed')
  await writeFile(join(directory, 'template/example.txt'), 'changed template')
  await writeFile(join(root, 'docs/guides/ugc-authoring-agent/SKILL.md'), 'changed skill')
  await rm(join(directory, 'src/removable.mjs'))
  await eventually(async () => {
    assert.equal(await readFile(join(directory, 'dist/cli.mjs'), 'utf8'), '// changed')
    assert.equal(await readFile(join(directory, 'dist/template/example.txt'), 'utf8'), 'changed template')
    assert.equal(
      await readFile(join(directory, 'dist/template/skills/arcadia-content-authoring/SKILL.md'), 'utf8'),
      'changed skill',
    )
    await assert.rejects(readFile(join(directory, 'dist/removable.mjs')), { code: 'ENOENT' })
  })
  assert.equal(errors.length, 0)

  await writeFile(join(directory, 'build.mjs'), "throw new Error('broken build')")
  await eventually(() => assert.ok(errors.length > 0))
  // Changes arriving during a slow rebuild must be included in a subsequent build.
  await writeFile(
    join(directory, 'build.mjs'),
    `${originalBuild}\nawait new Promise(resolve => setTimeout(resolve, 300));`,
  )
  await delay(200)
  await writeFile(join(directory, 'src/cli.mjs'), '// recovered')
  await writeFile(join(root, 'docs/guides/seer2-recreate-pet/SKILL.md'), 'recovered skill')
  await eventually(async () => {
    assert.equal(await readFile(join(directory, 'dist/cli.mjs'), 'utf8'), '// recovered')
    assert.equal(
      await readFile(join(directory, 'dist/template/skills/seer2-recreate-pet/SKILL.md'), 'utf8'),
      'recovered skill',
    )
  })
})
