import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const jobPackages = {
  headless: ['battle', 'data-pack-base', 'pack-loader'],
  // The CLI typecheck also resolves its lazy client/console/server imports.
  server: ['server', 'console', 'client', 'cli-validator', 'p2p-transport'],
  browser: ['web-ui'],
}

const sharedFiles = new Set([
  '.github/workflows/battle-baseline.yml',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'eslint.config.js',
  'scripts/battle-ci-scope.mjs',
  'scripts/battle-ci-scope.test.mjs',
  'scripts/build-battle-environment.mjs',
  'scripts/build-base-environment.mjs',
])

const jobFiles = {
  headless: [
    /^eslint\.config\.(?:baseline|v4)\.js$/,
    /^scripts\/verify-v1-(?:port|hosts)\.mjs$/,
    /^docs\/v4\/v1-(?:port-provenance|import-graph|extra-source-map)\.json$/,
    /^docs\/v4\/(?:examples|validation)\//,
  ],
  server: [/^bin\//, /^eslint\.config\.server-native\.js$/, /^scripts\/verify-native-pack\.mjs$/],
  browser: [/^resource\//],
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
}

/** Follow workspace manifests rather than duplicating their transitive dependency graph. */
export function workspacePackages(cwd = process.cwd()) {
  const manifests = git(['ls-files', '-z', '--', 'packages/**/package.json', 'packs/**/package.json'], cwd)
    .split('\0')
    .filter(Boolean)
  return new Map(
    manifests.map(file => {
      const manifest = JSON.parse(readFileSync(resolve(cwd, file), 'utf8'))
      const dependencies = Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      })
        .filter(([, version]) => version.startsWith('workspace:'))
        .map(([name]) => name)
      return [manifest.name, { directory: dirname(file), dependencies }]
    }),
  )
}

function dependencyDirectories(names, packages) {
  const directories = new Set()
  function visit(name) {
    const pkg = packages.get(name)
    if (!pkg) throw new Error(`Unknown workspace dependency: ${name}`)
    if (directories.has(pkg.directory)) return
    directories.add(pkg.directory)
    pkg.dependencies.forEach(visit)
  }
  names.forEach(name => visit(`@arcadia-eternity/${name}`))
  return directories
}

export function affectedBattleJobs(paths, packages = workspacePackages()) {
  return Object.fromEntries(
    Object.entries(jobPackages).map(([job, names]) => {
      const directories = dependencyDirectories(names, packages)
      const affected = paths.some(
        path =>
          sharedFiles.has(path) ||
          jobFiles[job].some(pattern => pattern.test(path)) ||
          [...directories].some(directory => path.startsWith(`${directory}/`)),
      )
      return [job, affected]
    }),
  )
}

/** A rename must include the old path too, so moving a dependency away cannot skip its tests. */
export function changedBattlePaths(eventName, event, cwd = process.cwd()) {
  let base, head, mergeBase
  if (eventName === 'pull_request') {
    base = event.pull_request?.base?.sha
    head = event.pull_request?.head?.sha
    mergeBase = true
  } else if (eventName === 'push') {
    base = event.before
    head = event.after
  } else return null // Manual runs and unfamiliar events always run every check.

  if (![base, head].every(sha => /^[a-f0-9]{40}$/i.test(sha ?? '') && !/^0+$/.test(sha))) return null
  return git(
    [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      mergeBase ? `${base}...${head}` : base,
      ...(mergeBase ? [] : [head]),
      '--',
    ],
    cwd,
  )
    .split('\0')
    .filter(Boolean)
}

export function selectBattleJobs(eventName, event, cwd = process.cwd()) {
  try {
    const paths = changedBattlePaths(eventName, event, cwd)
    return {
      jobs:
        paths === null
          ? { headless: true, server: true, browser: true }
          : affectedBattleJobs(paths, workspacePackages(cwd)),
      paths,
    }
  } catch (error) {
    // Missing push history (for example after a force push) must never silently remove coverage.
    console.warn(`Cannot determine battle CI scope; running all checks: ${error.message}`)
    return { jobs: { headless: true, server: true, browser: true }, paths: null }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const result = selectBattleJobs(process.env.GITHUB_EVENT_NAME, event)
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(result.jobs)
        .map(([job, run]) => `${job}=${run}\n`)
        .join(''),
    )
  console.log(JSON.stringify(result, null, 2))
}
