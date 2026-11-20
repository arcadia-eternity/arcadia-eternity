// Run from the checked-out project after npm ci. The locked SDK builds the content
// and executes its battle scenarios in a consumer workspace containing the release files.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, glob, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { ManagedProjects } from '@arcadia-eternity/content-sdk/managed-projects'
import { releasePayload, normalizeReleaseArchive } from './release-payload.mjs'

const root = process.cwd()
const require = createRequire(import.meta.url)
const sdk = createRequire(require.resolve('@arcadia-eternity/content-sdk'))
const { emptyNpmContentHost, prepareNpmProject, resolveNpmInvocation } = await import(
  pathToFileURL(sdk.resolve('@arcadia-eternity/pack-loader/node')).href
)
const run = promisify(execFile)
const json = async file => JSON.parse(await readFile(file, 'utf8'))
const npm = async (args, cwd) => {
  const command = await resolveNpmInvocation(args)
  return run(command.file, command.args, { cwd, maxBuffer: 32 * 1024 * 1024 })
}
const temporary = await mkdtemp(join(tmpdir(), 'arcadia-release-'))
const staged = join(temporary, 'runtime')
const installer = new ManagedProjects(join(temporary, 'installer'), { allowThirdPartyContent: true })
try {
  await mkdir(staged)
  const { stdout } = await npm(['exec', '--offline', '--', 'arcadia-content', 'pack'], root)
  const receipt = JSON.parse(
    stdout
      .split(/\r?\n/)
      .find(line => line.startsWith('ARCADIA_RESULT='))
      .slice('ARCADIA_RESULT='.length),
  )
  assert.match(receipt.filename, /^[a-z0-9][a-z0-9._-]*\.tgz$/)
  const archive = join(root, receipt.filename)
  const built = join(temporary, 'built')
  await mkdir(built)
  await sdk('tar').x({ file: archive, cwd: built, strip: 1, strict: true })
  const source = await json(join(built, 'package.json'))
  const presentation = source.arcadia.presentation ? await json(join(built, source.arcadia.presentation)) : undefined
  const manifest = releasePayload(source, receipt.files, presentation)
  for (const file of manifest.files) {
    if (file === 'package.json') continue
    await mkdir(dirname(join(staged, file)), { recursive: true })
    await cp(join(built, file), join(staged, file))
  }
  await writeFile(join(staged, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const { stdout: packed } = await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], staged)
  const [result] = JSON.parse(packed)
  assert.equal(result.filename, receipt.filename)
  assert.deepEqual(result.files.map(entry => entry.path).sort(), manifest.files)
  const file = join(temporary, result.filename)
  const normalized = await normalizeReleaseArchive(file)
  const digest = createHash('sha512')
    .update(await readFile(file))
    .digest()
  const integrity = 'sha512-' + digest.toString('base64')
  assert.equal(normalized.integrity, integrity)
  if (process.env.EXPECTED_INTEGRITY)
    assert.equal(integrity, process.env.EXPECTED_INTEGRITY, 'Archive differs from the verified desktop release')

  const consumer = join(temporary, 'consumer')
  await mkdir(join(consumer, 'candidates'), { recursive: true })
  await cp(file, join(consumer, 'candidates/release.tgz'))
  await installer.prepareProject(
    {
      schemaVersion: 1,
      id: 'release',
      name: 'Release',
      packages: { [manifest.name]: 'file:candidates/release.tgz' },
      sources: [],
    },
    { projectDirectory: consumer },
    async directory => {
      const environment = await prepareNpmProject(
        directory,
        emptyNpmContentHost,
        { policy: { profile: 'local-development' } },
        { effectPreparation: 'prebuilt-only' },
      )
      await environment.dispose()
    },
  )
  for (const name of ['test', 'tests', 'debug', 'arcadia.config.mjs']) {
    await cp(join(root, name), join(staged, name), { recursive: true }).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
  }
  await cp(file, join(staged, result.filename))
  await symlink(
    join(root, 'node_modules'),
    join(staged, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const scenarios = await Array.fromAsync(
    glob(['test/**/*.test.{mjs,js,cjs}', 'tests/**/*.test.{mjs,js,cjs}'], { cwd: staged }),
  )
  assert.ok(scenarios.length, 'No battle scenarios found')
  const results = await run(process.execPath, ['--test', '--test-reporter=tap', ...scenarios], {
    cwd: staged,
    env: {
      ...process.env,
      ARCADIA_AUTHOR_RESULT: '1',
      ARCADIA_TEST_RELEASE_ROOT: staged,
      ARCADIA_TEST_RELEASE_ARCHIVE: result.filename,
      ARCADIA_TEST_RELEASE_INTEGRITY: integrity,
      ARCADIA_TEST_BASE_NPM: process.env.ARCADIA_NPM_CLI ?? '',
      ARCADIA_NPM_CLI: join(root, '.github/scripts/release-test-npm.mjs'),
    },
    maxBuffer: 32 * 1024 * 1024,
  }).catch(error => {
    process.stderr.write(error.stdout || '')
    throw error
  })
  process.stdout.write(results.stdout)
  const candidates = results.stdout
    .split(/\r?\n/)
    .map(line => line.replace(/^# /, ''))
    .filter(line => line.startsWith('ARCADIA_RESULT='))
    .map(line => JSON.parse(line.slice('ARCADIA_RESULT='.length)).candidate)
    .filter(Boolean)
  assert.ok(
    candidates.length && candidates.every(candidate => candidate.integrity === integrity),
    'Battle scenarios did not exercise the release archive',
  )
  const output = join(root, 'release-output')
  await mkdir(output)
  await cp(file, join(output, basename(file)))
  await writeFile(join(output, 'SHA512SUMS'), digest.toString('hex') + '  ' + basename(file) + '\n')
} finally {
  await installer.close()
  await rm(temporary, { recursive: true, force: true })
}
