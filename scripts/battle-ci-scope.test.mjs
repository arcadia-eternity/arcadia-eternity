import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { affectedBattleJobs, changedBattlePaths, selectBattleJobs, workspacePackages } from './battle-ci-scope.mjs'

const packages = workspacePackages()
const none = { headless: false, server: false, browser: false, cli: false }
const all = { headless: true, server: true, browser: true, cli: true }

for (const path of [
  'README.md',
  'docs/v4/effect-value-semantics.md',
  '.github/workflows/release.yaml',
  'monitoring/load-balancing-dashboard.json',
]) {
  test(`unrelated change skips all battle checks: ${path}`, () => {
    assert.deepEqual(affectedBattleJobs([path], packages), none)
  })
}

for (const path of [
  'packages/battle/src/v4/battle.ts',
  'packs/base/data/species.yaml',
  'packages/const/src/index.ts',
  'packages/engine-plugins/damage/src/index.ts',
  'packages/pack-loader/src/native-loader.ts',
  'pnpm-lock.yaml',
  'scripts/build-base-environment.mjs',
  '.github/workflows/battle-baseline.yml',
]) {
  test(`shared runtime or configuration runs all battle checks: ${path}`, () => {
    assert.deepEqual(affectedBattleJobs([path], packages), all)
  })
}

for (const path of ['packages/server/src/app.ts']) {
  test(`server dependency change runs server checks without offline CLI: ${path}`, () => {
    assert.deepEqual(affectedBattleJobs([path], packages), { ...none, server: true })
  })
}

test('standalone server lint configuration runs server checks', () => {
  assert.deepEqual(affectedBattleJobs(['eslint.config.server-standalone.js'], packages), { ...none, server: true })
})

for (const path of [
  'packages/console/src/index.ts',
  'packages/cli/src/main.ts',
  'packages/cli/test/commands.test.ts',
  'bin/cli.ts',
  'bin/legacy-cli.ts',
  'bin/native-local-battle.ts',
]) {
  test(`CLI source or shared console changes cover both CLI checks: ${path}`, () => {
    assert.deepEqual(affectedBattleJobs([path], packages), { ...none, server: true, cli: true })
  })
}

test('root offline bundle configuration runs offline CLI checks', () => {
  assert.deepEqual(affectedBattleJobs(['rolldown.config.js'], packages), { ...none, cli: true })
})

for (const path of [
  'packages/web-ui/src/pages/localBattlePage.vue',
  'resource/background.yaml',
  'scripts/prepare-static-assets.mjs',
  'scripts/prepare-static-assets.test.mjs',
]) {
  test(`browser change runs only its job: ${path}`, () => {
    assert.deepEqual(affectedBattleJobs([path], packages), { ...none, browser: true })
  })
}

test('client, database and P2P changes cover server and browser without offline CLI', () => {
  for (const path of [
    'packages/client/src/index.ts',
    'packages/database/src/index.ts',
    'packages/p2p-transport/src/index.ts',
  ])
    assert.deepEqual(affectedBattleJobs([path], packages), { ...none, server: true, browser: true })
})

for (const path of [
  'docs/v4/validation/official-shield-candidate.json',
  'docs/v4/examples/ugc-healing.json',
  'docs/v4/v1-port-provenance.json',
  'scripts/verify-v1-hosts.mjs',
  'scripts/verify-waiting-snapshots.mjs',
  'scripts/verify-behavior-uses.mjs',
]) {
  test(`headless test input runs headless checks: ${path}`, () => {
    assert.deepEqual(affectedBattleJobs([path], packages), { ...none, headless: true })
  })
}

test('mixed changed paths combine job scopes', () => {
  assert.deepEqual(affectedBattleJobs(['bin/cli.ts', 'resource/background.yaml'], packages), {
    headless: false,
    server: true,
    browser: true,
    cli: true,
  })
})

test('new workspace dependencies are followed automatically', () => {
  const updated = new Map(packages)
  const battle = packages.get('@arcadia-eternity/battle')
  updated.set('@arcadia-eternity/battle', {
    ...battle,
    dependencies: [...battle.dependencies, '@arcadia-eternity/new-runtime'],
  })
  updated.set('@arcadia-eternity/new-runtime', { directory: 'packages/new-runtime', dependencies: [] })
  assert.deepEqual(affectedBattleJobs(['packages/new-runtime/src/index.ts'], updated), all)
})

test('new CLI workspace dependencies cover offline CLI and root CLI typecheck', () => {
  const updated = new Map(packages)
  const cli = packages.get('@arcadia-eternity/cli')
  updated.set('@arcadia-eternity/cli', {
    ...cli,
    dependencies: [...cli.dependencies, '@arcadia-eternity/new-cli-runtime'],
  })
  updated.set('@arcadia-eternity/new-cli-runtime', { directory: 'packages/new-cli-runtime', dependencies: [] })
  assert.deepEqual(affectedBattleJobs(['packages/new-cli-runtime/src/index.ts'], updated), {
    ...none,
    server: true,
    cli: true,
  })
})

test('manual runs, unsupported events and a new branch run all checks', () => {
  assert.deepEqual(selectBattleJobs('workflow_dispatch', {}).jobs, all)
  assert.deepEqual(selectBattleJobs('unknown', {}).jobs, all)
  assert.deepEqual(selectBattleJobs('push', { before: '0'.repeat(40), after: '1'.repeat(40) }).jobs, all)
})

const repository = mkdtempSync(join(tmpdir(), 'battle-ci-scope-'))
after(() => rmSync(repository, { recursive: true, force: true }))
function git(...args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
}
git('init', '-q')
git('config', 'user.email', 'battle-ci-scope@example.invalid')
git('config', 'user.name', 'Battle CI scope test')
mkdirSync(join(repository, 'packages/battle'), { recursive: true })
writeFileSync(join(repository, 'packages/battle/old.ts'), 'export const marker = 1\n')
git('add', '.')
git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD')
git('checkout', '-qb', 'feature')
git('mv', 'packages/battle/old.ts', 'unrelated.ts')
git('commit', '-qm', 'move dependency')
const head = git('rev-parse', 'HEAD')

test('push diffs and renames include both removed and added paths', () => {
  const paths = changedBattlePaths('push', { before: base, after: head }, repository)
  assert.deepEqual(paths.sort(), ['packages/battle/old.ts', 'unrelated.ts'])
  assert.deepEqual(affectedBattleJobs(paths, packages), all)
})

test('PR diff uses its merge base and does not pick up base-only changes', () => {
  git('checkout', '-q', '--detach', base)
  writeFileSync(join(repository, 'base-only.md'), 'base-only change\n')
  git('add', '.')
  git('commit', '-qm', 'advance base')
  const advancedBase = git('rev-parse', 'HEAD')
  const paths = changedBattlePaths(
    'pull_request',
    { pull_request: { base: { sha: advancedBase }, head: { sha: head } } },
    repository,
  )
  assert.deepEqual(paths.sort(), ['packages/battle/old.ts', 'unrelated.ts'])
})

test('missing history conservatively runs every check', t => {
  const warning = t.mock.method(console, 'warn', () => {})
  assert.deepEqual(selectBattleJobs('push', { before: '1'.repeat(40), after: head }, repository).jobs, all)
  assert.match(warning.mock.calls[0].arguments[0], /running all checks/)
})

test('workflow command writes explicit GitHub outputs for manual runs and an empty diff', () => {
  const eventPath = join(repository, 'event.json')
  const outputPath = join(repository, 'output.txt')
  const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  for (const [eventName, event, jobs] of [
    ['workflow_dispatch', {}, all],
    ['push', { before: currentHead, after: currentHead }, none],
  ]) {
    writeFileSync(eventPath, JSON.stringify(event))
    writeFileSync(outputPath, '')
    const stdout = execFileSync(process.execPath, [resolve('scripts/battle-ci-scope.mjs')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
      },
    })
    assert.deepEqual(JSON.parse(stdout).jobs, jobs)
    assert.equal(
      readFileSync(outputPath, 'utf8'),
      Object.entries(jobs)
        .map(([job, run]) => `${job}=${run}\n`)
        .join(''),
    )
  }
})
