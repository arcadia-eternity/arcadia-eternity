import { Command, CommanderError } from 'commander'
import { format } from 'node:util'
import { CliError, diagnostic } from './reporting/errors'
import { registerCommands } from './commands/register'
import type { CommandContext } from './context'
import { setGlobalLogger } from '@arcadia-eternity/battle/v4'

function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => stream.write(text, error => (error ? reject(error) : resolve())))
}
export async function runCli(args: string[], legacy?: () => Promise<void>): Promise<number> {
  if (['online', 'p2p-e2e', 'p2p-ws-e2e'].includes(args[0])) {
    if (!legacy) throw new CliError('COMMAND_UNAVAILABLE', 'Legacy command entry unavailable')
    await legacy()
    return 0
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  const context: CommandContext = {
    cwd: process.cwd(),
    signal: controller.signal,
    stdout: text => write(process.stdout, text),
    stderr: text => write(process.stderr, text),
  }
  const log = (value: unknown, msg?: string) => {
    void context.stderr((msg ?? (typeof value === 'string' ? value : JSON.stringify(value))) + '\n')
  }
  setGlobalLogger({ debug() {}, info() {}, warn: log, error: log })
  const program = new Command().name('arcadia').description('Arcadia Eternity native CLI').exitOverride()
  program.configureOutput({
    writeOut: text => {
      void context.stdout(text)
    },
    writeErr: text => {
      void context.stderr(text)
    },
  })
  for (const [name, description] of [
    ['online', 'Online battle'],
    ['server', 'Single-process in-memory battle server'],
    ['p2p-e2e', 'P2P smoke test'],
    ['p2p-ws-e2e', 'WebSocket P2P smoke test'],
  ])
    program.command(name).description(description)
  const exitCode = registerCommands(program, context)
  const local = args[0] === 'local' || (args[0] === 'battle' && args[1] === 'local')
  const originalConsole = { log: console.log, info: console.info, debug: console.debug }
  if (!local) {
    // Native content can log directly; reserve headless stdout for the command result.
    const diagnosticLog = (...values: unknown[]) => {
      void context.stderr(format(...values) + '\n')
    }
    console.log = console.info = console.debug = diagnosticLog
  }
  try {
    await program.parseAsync(args, { from: 'user' })
    return exitCode()
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0
    const code = error instanceof CliError ? error.exitCode : error instanceof CommanderError ? 2 : 1
    const cause = error instanceof CommanderError ? new CliError('ARGUMENT_INVALID', error.message) : error
    const report = { format: 'arcadia.cli.error', version: 1, diagnostics: [diagnostic(cause)] }
    await context.stdout(
      args.includes('--json') ||
        args.some((arg, i) => arg === '--format=json' || (arg === '--format' && args[i + 1] === 'json'))
        ? JSON.stringify(report) + '\n'
        : '',
    )
    await context.stderr(report.diagnostics[0].message + '\n')
    return controller.signal.aborted ? 130 : code
  } finally {
    if (!local) Object.assign(console, originalConsole)
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
  }
}
