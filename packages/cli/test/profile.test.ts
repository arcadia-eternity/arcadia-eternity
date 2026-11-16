import { it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const exec = promisify(execFile)
it('built CLI preserves an offline identity across processes and round-trips a clean directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-cli-'))
  const cli = resolve(import.meta.dirname, '../../../dist/cli.js')
  const guard = join(root, 'offline.mjs')
  const command = async (...args: string[]) =>
    JSON.parse((await exec(process.execPath, ['--import', guard, cli, 'profile', ...args, '--json'])).stdout)
  try {
    await writeFile(
      guard,
      `import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
const fail = () => { throw new Error('NETWORK_FORBIDDEN') };
net.Socket.prototype.connect = fail; http.request = fail; https.request = fail; globalThis.fetch = fail;`,
    )
    const a = join(root, 'a'),
      b = join(root, 'b'),
      backup = join(root, 'backup.json')
    const first = await command('init', '--name', '离线玩家', '--profile-dir', a)
    expect((await command('show', '--profile-dir', a)).profile.id).toBe(first.profile.id)
    await command('export', '--profile-dir', a, '--out', backup)
    const before = await readFile(backup, 'utf8')
    const imported = await command('import', backup, '--expect-empty', '--profile-dir', b)
    expect(imported.profile).toEqual(first.profile)
    expect((await command('import', backup, '--replace', '--expect-revision', '1', '--profile-dir', b)).changed).toBe(
      false,
    )
    await expect(command('import', backup, '--expect-empty', '--profile-dir', b)).rejects.toMatchObject({ code: 3 })
    expect(await readFile(backup, 'utf8')).toBe(before)
    expect(before).not.toContain('token')
    await command('set-name', 'Changed', '--profile-dir', b)
    expect((await command('inspect', backup, '--profile-dir', b)).unchanged).toBe(false)
    await command('import', backup, '--replace', '--expect-revision', '2', '--profile-dir', b)
    expect((await command('recover', '--expect-revision', '3', '--profile-dir', b)).profile.name).toBe('Changed')
    await writeFile(join(b, 'profile.json'), '{corrupt')
    const raw = join(root, 'corrupt-original.json')
    expect((await command('repair', backup, '--raw-out', raw, '--profile-dir', b)).profile).toEqual(first.profile)
    expect(await readFile(raw, 'utf8')).toBe('{corrupt')
    await expect(command('export', '--profile-dir', b, '--out', backup)).rejects.toMatchObject({ code: 2 })
    expect(await readFile(backup, 'utf8')).toBe(before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
