import type { Command } from 'commander'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ProfileRepository, ProfileError, MAX_BACKUP_BYTES, rawProfileBytes } from '@arcadia-eternity/local-profile'
import { FileProfileStorage, profileDirectory } from '@arcadia-eternity/local-profile/node'
import type { CommandContext } from '../context'
import { CliError } from '../reporting/errors'
import { writeJson } from '../io/files'

interface Options {
  profileDir?: string
  name?: string
  out?: string
  json?: boolean
  replace?: boolean
  expectEmpty?: boolean
  expectRevision?: string
  rawOut?: string
}
export function registerProfileCommands(program: Command, context: CommandContext) {
  const group = program.command('profile').description('Offline personal profile')
  const options = (c: Command) =>
    c.option('--profile-dir <directory>', 'Personal profile directory').option('--json', 'JSON result')
  async function run(o: Options, action: (repo: ProfileRepository, storage: FileProfileStorage) => Promise<unknown>) {
    try {
      const storage = new FileProfileStorage(
        profileDirectory(o.profileDir ? resolve(context.cwd, o.profileDir) : undefined),
      )
      const result = await action(new ProfileRepository(storage), storage)
      await context.stdout(JSON.stringify(result, null, o.json ? 0 : 2) + '\n')
    } catch (error) {
      if (error instanceof ProfileError)
        throw new CliError(
          error.code,
          error.message,
          ['REVISION_CONFLICT', 'PROFILE_BUSY'].includes(error.code) ? 3 : error.code.startsWith('STORAGE_') ? 4 : 2,
          error.path,
        )
      const io = error as NodeJS.ErrnoException
      if (io.code === 'EEXIST') throw new CliError('OUTPUT_EXISTS', 'Output file already exists')
      if (io.code === 'ENOENT') throw new CliError('INPUT_NOT_FOUND', 'Input file or directory does not exist')
      if (['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(io.code ?? ''))
        throw new CliError(io.code === 'ENOSPC' ? 'STORAGE_FULL' : 'STORAGE_DENIED', io.message, 4)
      throw error
    }
  }
  const summary = (s: Awaited<ReturnType<ProfileRepository['create']>>) => ({
    revision: s.revision,
    digest: s.digest,
    profile: s.data.profile,
    pets: s.data.library.storage.length,
    teams: s.data.library.teams.length,
  })
  const revision = (o: Options) => {
    if (!o.expectRevision || !/^[1-9]\d*$/.test(o.expectRevision) || !Number.isSafeInteger(Number(o.expectRevision)))
      throw new CliError('ARGUMENT_INVALID', '--expect-revision is required')
    return Number(o.expectRevision)
  }
  const read = async (path: string) => {
    const file = resolve(context.cwd, path)
    if ((await stat(file)).size > MAX_BACKUP_BYTES) throw new ProfileError('BACKUP_TOO_LARGE')
    return readFile(file)
  }
  options(group.command('init'))
    .option('--name <name>', 'Nickname')
    .action((o: Options) =>
      run(o, async repo => {
        if (o.name && (!o.name.trim() || o.name.trim().length > 30))
          throw new CliError('INVALID_NAME', 'Name must contain 1–30 characters')
        return summary(await repo.create({ name: o.name }))
      }),
    )
  options(group.command('show')).action((o: Options) =>
    run(o, async repo => {
      const state = await repo.open()
      if (!state) throw new ProfileError('PROFILE_EMPTY')
      return { ...summary(state.current), hasRecovery: !!state.recovery }
    }),
  )
  options(group.command('set-name').argument('<name>')).action((name: string, o: Options) =>
    run(o, async repo => {
      if (!name.trim() || name.trim().length > 30)
        throw new CliError('INVALID_NAME', 'Name must contain 1–30 characters')
      const state = await repo.open()
      if (!state) throw new ProfileError('PROFILE_EMPTY')
      state.current.data.profile.name = name.trim()
      return summary(await repo.update({ expectedRevision: state.current.revision, data: state.current.data }))
    }),
  )
  options(group.command('export'))
    .requiredOption('--out <file>', 'New backup file')
    .action((o: Options) =>
      run(o, async repo => {
        await writeJson(resolve(context.cwd, o.out!), await repo.exportBackup())
        return { exported: true }
      }),
    )
  options(group.command('inspect').argument('<file>')).action((file: string, o: Options) =>
    run(o, async repo => {
      const p = await repo.inspectImport(await read(file))
      return {
        profile: p.data.profile,
        pets: p.data.library.storage.length,
        teams: p.data.library.teams.length,
        expectedRevision: p.expectedRevision,
        unchanged: p.unchanged,
        target: p.current ? summary(p.current) : null,
        changedSettings: Object.keys(p.data.settings).filter(
          key =>
            JSON.stringify(p.data.settings[key as keyof typeof p.data.settings]) !==
            JSON.stringify(p.current?.data.settings[key as keyof typeof p.data.settings]),
        ),
        content: 'unchecked',
      }
    }),
  )
  options(group.command('import').argument('<file>'))
    .option('--expect-empty', 'Require empty destination')
    .option('--replace', 'Replace existing profile')
    .option('--expect-revision <number>', 'Expected destination revision')
    .action((file: string, o: Options) =>
      run(o, async repo => {
        const p = await repo.inspectImport(await read(file))
        if (o.expectEmpty && (o.replace || o.expectRevision))
          throw new CliError('ARGUMENT_INVALID', 'Conflicting import options')
        const expected = o.expectEmpty ? null : o.replace ? revision(o) : undefined
        if (expected === undefined)
          throw new CliError('ARGUMENT_INVALID', 'Use --expect-empty or --replace --expect-revision')
        if (p.expectedRevision !== expected) throw new ProfileError('REVISION_CONFLICT')
        return { ...summary(await repo.commitImport({ ...p, decision: 'restore' })), changed: !p.unchanged }
      }),
    )
  options(group.command('recover'))
    .requiredOption('--expect-revision <number>', 'Expected destination revision')
    .action((o: Options) => run(o, async repo => summary(await repo.recover({ expectedRevision: revision(o) }))))
  options(group.command('repair').argument('<file>'))
    .requiredOption('--raw-out <file>', 'Preserve corrupt bytes in a new file')
    .action((file: string, o: Options) =>
      run(o, async repo => {
        const bytes = await read(file)
        const raw = await repo.rawData()
        if (raw === null) throw new ProfileError('PROFILE_EMPTY')
        await writeFile(resolve(context.cwd, o.rawOut!), rawProfileBytes(raw), { flag: 'wx', mode: 0o600 })
        return summary(await repo.repair(bytes, raw))
      }),
    )
  options(group.command('unlock')).action((o: Options) =>
    run(o, async (_repo, storage) => {
      await storage.unlock()
      return { unlocked: true }
    }),
  )
}
