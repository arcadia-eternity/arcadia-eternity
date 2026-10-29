import type { Command } from 'commander'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { inspectNpmProject, resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'
import type { CommandContext } from '../context'
import { CliError } from '../reporting/errors'
import { writeJson } from '../io/files'

const exec = promisify(execFile)

export function registerNpmCommands(content: Command, context: CommandContext) {
  const npm = content.command('npm').description('Install, inspect and explicitly admit fixed npm content environments')
  async function report(value: unknown, json: boolean, text: string) {
    await context.stdout(json ? JSON.stringify(value) + '\n' : text + '\n')
  }
  npm
    .command('stage')
    .description('Install a package source into a fresh host-owned project without running lifecycle scripts')
    .argument('<directory>')
    .option('--package <source...>', 'Exact npm package versions or host-selected local tarballs')
    .option('--offline', 'Use only already cached npm artifacts')
    .option('--json', 'JSON output')
    .action(async (directory: string, options: { package?: string[]; offline?: boolean; json?: boolean }) => {
      const cwd = resolve(context.cwd, directory)
      try {
        await lstat(resolve(cwd, 'node_modules'))
        throw new CliError('NPM_INSTALL_EXISTS', 'Staging requires a fresh project directory')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const invocation = await resolveNpmInvocation([
        'install',
        '--save-exact',
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        ...(options.offline ? ['--offline'] : []),
        '--',
        ...(options.package ?? []),
      ])
      await exec(invocation.file, invocation.args, {
        cwd,
        signal: context.signal,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, npm_config_engine_strict: 'true' },
        windowsHide: true,
      })
      await mkdir(resolve(cwd, 'node_modules'), { recursive: true })
      const result = await inspectNpmProject(cwd)
      await report(result, !!options.json, `Prepared ${result.packages.length} packages; code has not been admitted.`)
    })
  npm
    .command('install')
    .argument('<directory>', 'Server project containing a standard npm lockfile')
    .option('--offline', 'Use only already cached npm artifacts')
    .option('--json', 'JSON output')
    .action(async (directory: string, options: { offline?: boolean; json?: boolean }) => {
      const cwd = resolve(context.cwd, directory)
      try {
        await lstat(resolve(cwd, 'node_modules'))
        throw new CliError('NPM_INSTALL_EXISTS', 'Create a new environment directory to install or upgrade packages')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      // npm ci performs standard dependency/peer resolution and integrity verification. No root or dependency scripts run.
      const invocation = await resolveNpmInvocation([
        'ci',
        '--ignore-scripts',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        ...(options.offline ? ['--offline'] : []),
      ])
      await exec(invocation.file, invocation.args, {
        cwd,
        signal: context.signal,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, npm_config_engine_strict: 'true' },
        windowsHide: true,
      })
      const result = await inspectNpmProject(cwd)
      await report(
        result,
        !!options.json,
        `Installed ${result.packages.length} packages. Review and approve the project before execution.`,
      )
    })
  npm
    .command('inspect')
    .argument('<directory>')
    .option('--json', 'JSON output')
    .action(async (directory: string, options: { json?: boolean }) => {
      const result = await inspectNpmProject(resolve(context.cwd, directory))
      await report(
        result,
        !!options.json,
        result.packages.map(pkg => `${pkg.name}@${pkg.version}${pkg.manifest ? ' [content]' : ''}`).join('\n') +
          `\nInstallation: ${result.digest}`,
      )
    })
  npm
    .command('approve')
    .argument('<directory>')
    .requiredOption('--profile <profile>', 'local-development, self-hosted or official (administrator decision)')
    .option('--out <path>', 'New approval file; defaults to arcadia-admission.json in the environment')
    .option('--json', 'JSON output')
    .action(async (directory: string, options: { profile: string; out?: string; json?: boolean }) => {
      if (!['local-development', 'self-hosted', 'official'].includes(options.profile))
        throw new CliError('NPM_PROFILE', 'Expected local-development, self-hosted or official')
      const cwd = resolve(context.cwd, directory)
      await inspectNpmProject(cwd)
      const approval = {
        format: 'arcadia.npm-admission',
        version: 2,
        profile: options.profile,
      }
      const file = options.out ? resolve(context.cwd, options.out) : resolve(cwd, 'arcadia-admission.json')
      await writeJson(file, approval)
      await report(
        approval,
        !!options.json,
        `Approved npm project (${options.profile}). Local edits do not require renewed approval.\n${file}`,
      )
    })
}
