import { Command, CommanderError } from 'commander'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import { ManagementAuth, MANAGEMENT_ACTIONS } from '@arcadia-eternity/server'
import { openServerStorage, readServerStorageStatus } from './server-persistence'

/** Explicit host-side maintenance commands; never exposed as public server routes. */
export async function runServerAdminCli(args: string[]): Promise<number> {
  const group = args[0]
  const program = new Command('arcadia server ' + group)
    .exitOverride()
    .argument('<action>', group === 'db' ? 'status or migrate' : 'login-code')
    .option('--data-dir <directory>', 'Persistent server data directory', process.env.ARCADIA_DATA_DIR)
    .option('--workspace-root <directory>', 'Content workspace root', process.env.ARCADIA_WORKSPACE_ROOT)
    .option('--server-id <id>', 'Expected persistent server identity', process.env.SERVER_ID)
  let opened: Awaited<ReturnType<typeof openServerStorage>> | undefined
  try {
    await program.parseAsync(args.slice(1), { from: 'user' })
    const action = program.args[0]
    if (
      (group === 'db' && !['status', 'migrate'].includes(action)) ||
      (group === 'admin' && action !== 'login-code') ||
      !['db', 'admin'].includes(group)
    )
      throw new Error('Unknown server maintenance command')
    if (group === 'db' && action === 'status') {
      console.log(JSON.stringify(await readServerStorageStatus(program.opts())))
      return 0
    }
    opened = await openServerStorage(
      program.opts(),
      action === 'migrate' ? 'migrate' : group === 'db' ? 'inspect' : 'admin',
    )
    if (group === 'db') {
      console.log(JSON.stringify({ driver: opened.storage.driver, status: await opened.storage.schemaStatus() }))
      return 0
    }
    let workspaceId: string
    try {
      const metadata = JSON.parse(await readFile(join(opened.config.workspaceRoot, 'workspace.json'), 'utf8'))
      if (metadata.format !== 'arcadia.content-workspace/1' || typeof metadata.workspaceId !== 'string')
        throw new Error('Invalid content workspace metadata')
      workspaceId = metadata.workspaceId
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const workspace = await ContentWorkspace.open(opened.config.workspaceRoot)
      workspaceId = workspace.workspaceId
      await workspace.close()
    }
    const credentials = await new ManagementAuth(opened.storage).issueBootstrapCode([
      { scope: { kind: 'server', id: opened.serverId! }, actions: [...MANAGEMENT_ACTIONS.server] },
      { scope: { kind: 'workspace', id: workspaceId }, actions: [...MANAGEMENT_ACTIONS.workspace] },
    ])
    // This is the explicit host-side credential delivery action, not a server startup log.
    console.log(JSON.stringify({ ...credentials, serverId: opened.serverId, workspaceId }))
    return 0
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0
    console.error(error instanceof Error ? error.message : error)
    return 1
  } finally {
    await opened?.storage.close()
  }
}
