import { Command, CommanderError } from 'commander'
import { open, readFile, stat } from 'node:fs/promises'
import { ContentWorkspace } from '@arcadia-eternity/content-dev/management-workspace'
import { validateWorkspaceProject } from '@arcadia-eternity/server'
import { persistentServerConfig } from './server-config'
import { openServerStorage, workspaceRetentions } from './server-persistence'
import { createServerBackup, inspectServerBackup, restoreServerBackup } from './server-backup'

export async function runServerBackupCli(args: string[]): Promise<number> {
  const program = new Command('arcadia server backup')
    .exitOverride()
    .argument('<action>', 'create, inspect, restore, or clone')
    .requiredOption('--file <path>', 'Backup file (new file for create)')
    .option('--target <directory>', 'New empty destination for restore/clone')
    .option('--data-dir <directory>', 'Source server data directory', process.env.ARCADIA_DATA_DIR)
    .option('--workspace-root <directory>', 'Source content workspace', process.env.ARCADIA_WORKSPACE_ROOT)
    .option('--server-id <id>', 'Expected source identity', process.env.SERVER_ID)
    .option(
      '--allow-third-party-execution',
      'Community host: permit static compilation of restored author Effects',
      process.env.ARCADIA_ALLOW_THIRD_PARTY_EXECUTION === '1',
    )
  let opened: Awaited<ReturnType<typeof openServerStorage>> | undefined
  let workspace: ContentWorkspace | undefined
  try {
    await program.parseAsync(args, { from: 'user' })
    const action = program.args[0],
      options = program.opts()
    if (!['create', 'inspect', 'restore', 'clone'].includes(action)) throw new Error('Unknown backup command')
    if (action === 'create') {
      opened = await openServerStorage(options, 'backup')
      workspace = await ContentWorkspace.open(opened.config.workspaceRoot, {
        retentions: workspaceRetentions(opened.storage, () => workspace!.workspaceId),
      })
      // The exclusive workspace owner lock rejects backups while this server is running.
      const backup = await createServerBackup({
        storage: opened.storage,
        workspace,
        serverId: opened.serverId!,
        maintenance: async work => work(),
      })
      const output = await open(options.file, 'wx', 0o600)
      try {
        await output.writeFile(JSON.stringify(backup) + '\n')
        await output.sync()
      } finally {
        await output.close()
      }
      console.log(JSON.stringify(inspectServerBackup(backup)))
      return 0
    }
    const info = await stat(options.file)
    if (!info.isFile() || info.size > 512 * 1024 * 1024) throw new Error('Backup must be a file no larger than 512 MiB')
    const backup: unknown = JSON.parse(await readFile(options.file, 'utf8'))
    const summary = inspectServerBackup(backup)
    if (action === 'inspect') {
      console.log(JSON.stringify(summary))
      return 0
    }
    if (action !== 'restore' && action !== 'clone') throw new Error('Unknown restore mode')
    if (!options.target) throw new Error('--target is required for restore or clone')
    const config = persistentServerConfig({ dataDir: options.target })
    const restored = await restoreServerBackup({
      backup,
      targetDirectory: options.target,
      mode: action,
      ...(config.storage.driver === 'postgres'
        ? { postgres: { connectionString: config.storage.connectionString } }
        : {}),
      preparer: input =>
        validateWorkspaceProject(input, {
          effectPreparation: options.allowThirdPartyExecution ? 'compile' : 'prebuilt-only',
        }),
    })
    console.log(JSON.stringify(restored))
    return 0
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0
    console.error(error instanceof Error ? error.message : error)
    return 1
  } finally {
    await workspace?.close()
    await opened?.storage.close()
  }
}
