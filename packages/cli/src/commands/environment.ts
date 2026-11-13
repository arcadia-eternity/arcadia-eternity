import type { Command } from 'commander'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import type { ManagementOperation } from '@arcadia-eternity/protocol'
import type { CommandContext } from '../context'
import { CliError } from '../reporting/errors'

/** Uses the workspace owner's API, so CLI writes cannot bypass scope checks or its write lock. */
export function registerEnvironmentCommands(content: Command, context: CommandContext) {
  const command = content
    .command('environment')
    .description('Manage environments and installation tasks on their owning server')
    .requiredOption('--server <url>', 'Management server origin')
    .requiredOption('--token-file <file>', 'File containing a scoped service credential')
    .option('--workspace <id>', 'Workspace identity (required for environment commands)')
    .option('--json', 'JSON output (also the default)')
    .option('--idempotency-key <key>', 'Reuse a key when resubmitting the same operation after a lost response')
  const segment = (value: string) => {
    if (
      !value ||
      /[\s\p{Cc}]/u.test(value) ||
      ['/', '%', '\\'].some(character => value.includes(character)) ||
      value === '.' ||
      value === '..'
    )
      throw new CliError('INVALID_REQUEST', 'Invalid resource identity')
    return encodeURIComponent(value)
  }
  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const options = command.opts<{ server: string; tokenFile: string; idempotencyKey?: string }>()
    const url = new URL(options.server)
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      )
    )
      throw new CliError('MANAGEMENT_URL_INVALID', 'Use an HTTPS server origin, or HTTP on localhost')
    const token = (await readFile(resolve(context.cwd, options.tokenFile), 'utf8')).trim()
    if (!token || /\s/.test(token))
      throw new CliError('MANAGEMENT_TOKEN_INVALID', 'Expected a service token in the credential file')
    const response = await fetch(new URL('/api/management/v1' + path, url), {
      method,
      redirect: 'error',
      signal: context.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': options.idempotencyKey ?? randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const value = (await response.json()) as { error?: { code?: string }; code?: string }
    if (!response.ok) {
      const code = value.error?.code ?? value.code ?? 'MANAGEMENT_FAILED'
      throw new CliError(code, code)
    }
    return value
  }
  const workspace = () => '/workspaces/' + segment(command.opts<{ workspace?: string }>().workspace ?? '')
  const report = (value: unknown) => context.stdout(JSON.stringify(value) + '\n')
  command.command('list').action(async () => report(await request('GET', workspace() + '/environments')))
  command.command('installations').action(async () => {
    const result = (await request('GET', workspace() + '/environments')) as { installations: unknown[] }
    await report(result.installations)
  })
  command
    .command('apply')
    .argument('<file>', 'Environment document JSON')
    .option('--revision <revision>', 'Expected environment revision; omit to create')
    .option('--wait', 'Wait for completion and write stage updates to stderr')
    .action(async (file: string, options: { revision?: string; wait?: boolean }) => {
      const document = JSON.parse(await readFile(resolve(context.cwd, file), 'utf8'))
      let operation = (await request('POST', workspace() + '/environments/apply', {
        document,
        expectedRevision: options.revision ?? null,
      })) as ManagementOperation
      let previous = ''
      while (options.wait && ['queued', 'running'].includes(operation.status)) {
        const update = JSON.stringify({ id: operation.id, status: operation.status, progress: operation.progress })
        if (update !== previous) {
          await context.stderr(update + '\n')
          previous = update
        }
        await setTimeout(500, undefined, { signal: context.signal })
        operation = (await request('GET', '/operations/' + segment(operation.id))) as ManagementOperation
      }
      if (options.wait && operation.status !== 'succeeded')
        throw new CliError('ENVIRONMENT_APPLY_FAILED', `Application ${operation.status}: ${operation.id}`)
      await report(operation)
    })
  for (const enabled of [true, false])
    command
      .command(enabled ? 'enable' : 'disable')
      .argument('<id>')
      .argument('<package>')
      .requiredOption('--revision <revision>', 'Captured draft revision')
      .option('--cascade', 'Also disable packages that require this package')
      .action(async (id: string, name: string, options: { revision: string; cascade?: boolean }) =>
        report(
          await request('POST', workspace() + '/environments/' + segment(id) + '/package-state', {
            expectedRevision: options.revision,
            name,
            enabled,
            cascade: options.cascade ?? false,
          }),
        ),
      )
  command.command('tasks').action(async () => report(await request('GET', '/operations')))
  for (const action of ['cancel', 'retry'])
    command
      .command(action)
      .argument('<operation>')
      .action(async (id: string) => report(await request('POST', '/operations/' + segment(id) + '/' + action, {})))
}
