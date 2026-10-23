import { readFile, lstat, realpath, link, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import YAML from 'yaml'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { CliError, message } from '../reporting/errors'

export async function readDocument(path: string): Promise<unknown> {
  try {
    return YAML.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new CliError('INPUT_INVALID', message(error), 2, path)
  }
}
export async function readTeam(path: string) {
  try {
    return parseWithErrors(PlayerSchema, await readDocument(path))
  } catch (error) {
    throw new CliError('TEAM_INVALID', message(error), 2, path)
  }
}
/** New output files only: hard-link publication is atomic and cannot overwrite inputs or symlinks. */
export async function reserveOutputs(paths: string[]): Promise<void> {
  const seen = new Set<string>()
  for (const path of paths) {
    let directory: string
    try {
      directory = await realpath(dirname(path))
    } catch (error) {
      throw new CliError('OUTPUT_PATH', message(error), 2, path)
    }
    const canonical = resolve(directory, basename(path))
    if (seen.has(canonical)) throw new CliError('OUTPUT_CONFLICT', `Duplicate output: ${path}`)
    seen.add(canonical)
    try {
      await lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    throw new CliError('OUTPUT_EXISTS', `Output already exists: ${path}`)
  }
}
export async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = resolve(dirname(path), `.arcadia-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
    await link(temporary, path)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}
