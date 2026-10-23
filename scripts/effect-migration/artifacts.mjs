import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'

/** Migration can create a TS file once; checked-in TS owns all later behavior changes. */
export async function writeMigrationArtifact(path, output, { check = false } = {}) {
  const nativeSource = extname(path) === '.ts'
  if (check || nativeSource) {
    let current
    try {
      current = await readFile(path, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT' || check) throw error
    }
    if (current === output) return
    if (check) throw new Error(`Generated drift: ${path}`)
    if (current !== undefined)
      throw new Error(
        `TypeScript owns behavior; migration refuses to overwrite ${path}. Review and edit the source explicitly.`,
      )
    await writeFile(path, output, { flag: 'wx' })
    return
  }
  await writeFile(path, output)
}
