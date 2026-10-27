import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Command } from 'commander'
import { inspectNpmProject, resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'
import type { CommandContext } from '../context'
import { CliError } from '../reporting/errors'

const exec = promisify(execFile)
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const ignored = new Set(['.git', 'node_modules', 'dist'])
const maxBytes = 128 * 1024 * 1024

// Fingerprint the source tree, including configs and untracked files, but not generated output or dependencies.
async function sourceRevision(root: string): Promise<string> {
  const entries: [string, string][] = []
  let bytes = 0
  async function visit(directory: string, prefix = ''): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      if (ignored.has(name)) continue
      const path = resolve(directory, name),
        key = prefix ? `${prefix}/${name}` : name
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) throw new CliError('DEV_SOURCE', `Source contains a symbolic link: ${key}`)
      if (stat.isDirectory()) await visit(path, key)
      else if (stat.isFile()) {
        bytes += stat.size
        if (++entries.length > 10000 || bytes > maxBytes) throw new CliError('DEV_SOURCE', 'Source tree is too large')
        const contents = await readFile(path)
        if (contents.length !== stat.size) throw new CliError('DEV_SOURCE_CHANGED', 'Source changed while reading')
        entries[entries.length - 1] = [key, hash(contents)]
      } else throw new CliError('DEV_SOURCE', `Unsupported source file: ${key}`)
    }
  }
  await visit(root)
  return `sha256:${hash(JSON.stringify(entries))}`
}

async function runNpm(args: string[], cwd: string, signal?: AbortSignal) {
  const npm = await resolveNpmInvocation(args)
  return exec(npm.file, npm.args, {
    cwd,
    signal,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, npm_config_engine_strict: 'true' },
  })
}

export async function prepareDevPreview(
  source: string,
  destination: string,
  options: { runBuild?: boolean; offline?: boolean; signal?: AbortSignal } = {},
) {
  const root = await realpath(source)
  const parent = await realpath(dirname(resolve(destination)))
  const target = resolve(parent, basename(destination))
  const within = relative(root, target)
  if (!within || (within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within)))
    throw new CliError('DEV_OUTPUT', 'Candidate directory must be outside the source project')
  try {
    await lstat(target)
    throw new CliError('OUTPUT_EXISTS', 'Candidate directory already exists')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>
  if (typeof manifest.name !== 'string' || !manifest.arcadia || typeof manifest.arcadia !== 'object')
    throw new CliError('DEV_SOURCE', 'Expected a named npm content pack with an arcadia manifest')
  const initialRevision = await sourceRevision(root)
  const scratch = await mkdtemp(resolve(parent, '.arcadia-preview-'))
  let targetCreated = false
  try {
    if (options.runBuild) await runNpm(['--ignore-scripts', 'run', 'build'], root, options.signal)
    if ((await sourceRevision(root)) !== initialRevision)
      throw new CliError('DEV_SOURCE_CHANGED', 'Source changed during build; prepare a new candidate')
    const packed = await runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch],
      root,
      options.signal,
    )
    const result: unknown = JSON.parse(packed.stdout)
    if (!Array.isArray(result) || result.length !== 1 || typeof result[0]?.filename !== 'string')
      throw new CliError('DEV_PACK', 'npm did not return one package artifact')
    const filename = result[0].filename as string
    if (basename(filename) !== filename) throw new CliError('DEV_PACK', 'Invalid npm artifact filename')
    const artifact = await readFile(resolve(scratch, filename))
    if (artifact.length > maxBytes) throw new CliError('DEV_PACK', 'Package artifact is too large')
    if ((await sourceRevision(root)) !== initialRevision)
      throw new CliError('DEV_SOURCE_CHANGED', 'Source changed during packaging; prepare a new candidate')
    const packageDigest = `sha256:${hash(artifact)}`
    await mkdir(resolve(scratch, 'artifacts'))
    await rename(resolve(scratch, filename), resolve(scratch, 'artifacts', 'content.tgz'))
    await writeFile(
      resolve(scratch, 'package.json'),
      JSON.stringify(
        {
          name: 'arcadia-development-preview',
          version: '1.0.0',
          private: true,
          dependencies: { [manifest.name]: 'file:artifacts/content.tgz' },
        },
        null,
        2,
      ) + '\n',
    )
    const common = [
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      ...(options.offline ? ['--offline'] : []),
    ]
    await runNpm(['install', '--package-lock-only', ...common], scratch, options.signal)
    await runNpm(['ci', ...common], scratch, options.signal)
    const inspected = await inspectNpmProject(scratch)
    if ((await sourceRevision(root)) !== initialRevision)
      throw new CliError('DEV_SOURCE_CHANGED', 'Source changed during preparation; prepare a new candidate')
    const preview = {
      format: 'arcadia.dev-preview',
      version: 1,
      sourceRevision: initialRevision,
      sourceRevisionScope: 'source tree excluding .git, node_modules and dist',
      packageDigest,
      installationDigest: inspected.digest,
      candidateDirectory: target,
      buildExecuted: !!options.runBuild,
    }
    await writeFile(resolve(scratch, 'arcadia-preview.json'), JSON.stringify(preview, null, 2) + '\n')
    // Reserve a new destination and publish the completion record last.
    await mkdir(target)
    targetCreated = true
    for (const name of (await readdir(scratch)).filter(name => name !== 'arcadia-preview.json'))
      await rename(resolve(scratch, name), resolve(target, name))
    await rename(resolve(scratch, 'arcadia-preview.json'), resolve(target, 'arcadia-preview.json'))
    targetCreated = false
    return preview
  } finally {
    if (targetCreated) await rm(target, { recursive: true, force: true })
    await rm(scratch, { recursive: true, force: true })
  }
}

export function registerDevPreviewCommands(content: Command, context: CommandContext) {
  const dev = content.command('dev').description('Prepare a separate local development preview candidate')
  dev
    .command('prepare')
    .argument('<source>', 'Explicit npm content-pack source directory')
    .argument('<destination>', 'New candidate directory, outside the source')
    .option('--run-build', 'Explicitly authorize npm run build in the source project')
    .option('--offline', 'Use only locally cached npm dependencies')
    .option('--json', 'JSON output')
    .action(
      async (
        source: string,
        destination: string,
        options: { runBuild?: boolean; offline?: boolean; json?: boolean },
      ) => {
        const result = await prepareDevPreview(resolve(context.cwd, source), resolve(context.cwd, destination), {
          ...options,
          signal: context.signal,
        })
        const text = `Candidate prepared: ${result.candidateDirectory}\nSource: ${result.sourceRevision}\nPackage: ${result.packageDigest}\nInstallation: ${result.installationDigest}\n${result.buildExecuted ? 'Build ran.' : 'Build was not run; packaged output may be stale.'}\nInspect, approve, then start a separate server; no code was admitted or activated.\n`
        await context.stdout(options.json ? JSON.stringify(result) + '\n' : text)
      },
    )
}
