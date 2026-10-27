import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const script = resolve(repository, 'examples/ugc/create-content-pack.mjs')

test(
  'creates a reusable package, tests the real packed code, and refuses to overwrite',
  { timeout: 120000 },
  async () => {
    // Resolve repository SDK dependencies from the parent while exercising a separately generated package.
    const root = await mkdtemp(join(repository, '.ugc-scaffold-test-'))
    try {
      const dir = join(root, 'package')
      const args = [
        script,
        dir,
        '--name',
        '@example/weather',
        '--project-id',
        'weather-work',
        '--namespace',
        'weather',
        '--json',
      ]
      const result = await exec(process.execPath, args, { cwd: repository })
      const created = JSON.parse(result.stdout)
      assert.equal(created.projectId, 'weather-work')
      const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      const content = JSON.parse(await readFile(join(dir, 'content.json'), 'utf8'))
      assert.equal(manifest.name, '@example/weather')
      assert.equal(manifest.arcadia.namespace, 'weather')
      assert.equal(content.data.species[0].learnable_skills[0].skill_id.$ref.projectId, 'weather-work')
      assert.match(
        await readFile(join(dir, '.agents/skills/arcadia-content-authoring/SKILL.md'), 'utf8'),
        /name: arcadia-content-authoring/,
      )
      const environment = { ...process.env, npm_config_cache: join(root, 'npm-cache') }
      delete environment.NODE_TEST_CONTEXT
      const passed = await exec('npm', ['test'], {
        cwd: dir,
        env: environment,
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
      })
      assert.match(passed.stdout, /packed slow effect responds/)
      const effect = join(dir, 'src/effects.ts')
      await writeFile(effect, (await readFile(effect, 'utf8')).replace('default: -25', 'default: -10'))
      const broken = spawnSync('npm', ['test'], { cwd: dir, env: environment, timeout: 60000, encoding: 'utf8' })
      assert.notEqual(broken.status, 0, `${broken.stdout}\n${broken.stderr}`)
      assert.match(`${broken.stdout}\n${broken.stderr}`, /slow contributes -25 speed/)
      await writeFile(join(dir, 'keep.txt'), 'do not overwrite')
      const duplicate = spawnSync(process.execPath, args, { cwd: repository, encoding: 'utf8' })
      assert.notEqual(duplicate.status, 0)
      assert.equal(await readFile(join(dir, 'keep.txt'), 'utf8'), 'do not overwrite')
      const invalid = spawnSync(
        process.execPath,
        [script, join(root, 'invalid'), '--name', 'Bad Name', '--project-id', 'p', '--namespace', 'ns', '--json'],
        { cwd: repository, encoding: 'utf8' },
      )
      assert.notEqual(invalid.status, 0)
      assert.equal(JSON.parse(invalid.stderr).error, 'SCAFFOLD_FAILED')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
