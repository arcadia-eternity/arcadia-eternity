import { randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

function validate(value) {
  if (
    value?.schemaVersion !== 1 ||
    typeof value.serverId !== 'string' ||
    !/^arcadia-desktop-[a-f0-9-]{36}$/.test(value.serverId)
  )
    throw new Error('本机服务器身份记录无效，请恢复服务器备份')
  return value
}

/** A profile survives application upgrades; boot IDs and listening ports do not. */
export async function loadLocalServerProfile(directory) {
  if (!isAbsolute(directory)) throw new Error('本机服务器存储位置无效')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, 'server.json')
  try {
    return validate(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const profile = { schemaVersion: 1, serverId: `arcadia-desktop-${randomUUID()}` }
  const staging = join(directory, `server-${randomUUID()}.tmp`)
  try {
    await writeFile(staging, JSON.stringify(profile) + '\n', { flag: 'wx', mode: 0o600 })
    // Publish an already complete file without overwriting a concurrent initializer.
    try {
      await link(staging, file)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    return validate(JSON.parse(await readFile(file, 'utf8')))
  } finally {
    await rm(staging, { force: true })
  }
}

/** Updated only by the trusted host after it verifies the prepared project. */
export async function saveLocalServerProject(directory, projectDirectory, builtinOnly) {
  if (!isAbsolute(projectDirectory)) throw new Error('本机服务器项目位置无效')
  const profile = await loadLocalServerProfile(directory)
  const staging = join(directory, `server-${randomUUID()}.tmp`)
  try {
    await writeFile(
      staging,
      JSON.stringify({ ...profile, projectDirectory, builtinOnly: builtinOnly === true }) + '\n',
      { flag: 'wx', mode: 0o600 },
    )
    await rename(staging, join(directory, 'server.json'))
  } finally {
    await rm(staging, { force: true })
  }
}
