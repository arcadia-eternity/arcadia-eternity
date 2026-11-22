import { type Command, InvalidArgumentError, Option } from 'commander'
import type { DesktopOperation, DesktopServerConfiguration } from '@arcadia-eternity/content-sdk/desktop'
import type { CommandContext } from '../context'
import { CliError } from '../reporting/errors'

type StartOptions = Partial<DesktopServerConfiguration>

function port(value: string) {
  if (!/^\d+$/.test(value) || Number(value) > 65535) throw new InvalidArgumentError('Expected a port from 0 to 65535')
  return Number(value)
}

function firstStart(options: StartOptions): DesktopServerConfiguration | undefined {
  if (!Object.keys(options).length) return
  const scope = options.scope ?? 'local'
  if (scope === 'public' && !options.publicOrigin)
    throw new CliError('INVALID_LAUNCH', 'Public access requires --public-origin <url>')
  if (scope !== 'public' && options.publicOrigin !== undefined)
    throw new CliError('INVALID_LAUNCH', '--public-origin requires --scope public')
  return { name: '我的服务器', port: 8102, ...options, scope }
}

export function registerDesktopCommands(program: Command, context: CommandContext) {
  const desktop = program
    .command('desktop')
    .description('Operate a running desktop player')
    .option('--instance <id>', 'Desktop instance from arcadia desktop instances')
    .option('--json', 'JSON output (also the default)')
  const server = desktop.command('server').description('Manage the server hosted by the selected desktop player')
  async function run(operation?: DesktopOperation) {
    try {
      const { listDesktopInstances, connectDesktopInstance } = await import('@arcadia-eternity/content-sdk/desktop')
      const { instance } = desktop.opts<{ instance?: string }>()
      if (!operation && instance !== undefined)
        throw new CliError(
          'ARGUMENT_INVALID',
          'Instance discovery lists all players. Use --instance on a server operation.',
        )
      const options = { signal: context.signal }
      const result = operation
        ? await (await connectDesktopInstance(instance, options)).request(operation)
        : { instances: await listDesktopInstances(options) }
      await context.stdout(JSON.stringify(result) + '\n')
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        typeof error.code !== 'string' ||
        error instanceof CliError
      )
        throw error
      throw new CliError(error.code, error.message)
    }
  }
  desktop
    .command('instances')
    .description('List running desktop players')
    .action(() => run())
  server
    .command('status')
    .description('Read the current server state')
    .action(() => run({ operation: 'server', action: 'status' }))
  server
    .command('start')
    .description('Start the server using saved settings or supply first-start settings')
    .option('--name <name>', 'Server name for first start (default: 我的服务器)')
    .addOption(
      new Option('--scope <scope>', 'Connection scope for first start (default: local)').choices([
        'local',
        'lan',
        'public',
      ]),
    )
    .option('--port <port>', 'Port for first start (default: 8102, 0 selects an available port)', port)
    .option('--public-origin <url>', 'Public HTTP or HTTPS origin for public scope')
    .action((options: StartOptions) => {
      const configuration = firstStart(options)
      return run({ operation: 'server', action: 'start', ...(configuration && { configuration }) })
    })
  server
    .command('stop')
    .description('Drain active sessions and stop the server')
    .option('--force', 'Stop immediately, including active sessions')
    .action(({ force }: { force?: boolean }) => run({ operation: 'server', action: 'stop', ...(force && { force }) }))
  server
    .command('restart')
    .description('Drain active sessions and restart the server')
    .action(() => run({ operation: 'server', action: 'restart' }))
}
