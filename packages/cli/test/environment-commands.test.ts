import { afterEach, expect, it, vi } from 'vitest'
import { Command } from 'commander'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerEnvironmentCommands } from '../src/commands/environment'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'environment-cli-'))
  directories.push(cwd)
  await writeFile(join(cwd, 'token'), 'scoped-service-token\n')
  const stdout: string[] = [],
    stderr: string[] = []
  const program = new Command().exitOverride()
  registerEnvironmentCommands(program.command('content'), {
    cwd,
    signal: new AbortController().signal,
    stdout: async text => {
      stdout.push(text)
    },
    stderr: async text => {
      stderr.push(text)
    },
  })
  return {
    stdout,
    stderr,
    run: (args: string[]) =>
      program.parseAsync(
        [
          'content',
          'environment',
          '--server',
          'http://127.0.0.1:8102',
          '--token-file',
          'token',
          '--workspace',
          'shared',
          ...args,
        ],
        { from: 'user' },
      ),
  }
}
it('uses the owning server and captured revision for explicit cascade changes', async () => {
  const f = await fixture()
  const fetcher = vi.fn(async () => Response.json({ revision: 'next' }))
  vi.stubGlobal('fetch', fetcher)
  await f.run(['disable', 'friends', '@author/nature', '--revision', 'old', '--cascade'])
  const [url, request] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
  expect(url.pathname).toBe('/api/management/v1/workspaces/shared/environments/friends/package-state')
  expect(JSON.parse(request.body as string)).toEqual({
    expectedRevision: 'old',
    name: '@author/nature',
    enabled: false,
    cascade: true,
  })
  expect(request.redirect).toBe('error')
  expect(request.headers).toMatchObject({ Authorization: 'Bearer scoped-service-token' })
  expect(f.stdout.join('')).not.toContain('scoped-service-token')
})
it('waits for a real operation and reports stages separately from the final JSON', async () => {
  const f = await fixture()
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ id: 'job', status: 'running', progress: { stage: 'installing' } }))
    .mockResolvedValueOnce(Response.json({ id: 'job', status: 'succeeded', result: { versionId: 'fixed' } }))
  vi.stubGlobal('fetch', fetcher)
  await f.run(['prepare', 'friends', '--revision', 'r1', '--wait'])
  expect(f.stderr.join('')).toContain('installing')
  expect(JSON.parse(f.stdout[0]!)).toMatchObject({ status: 'succeeded', result: { versionId: 'fixed' } })
  expect(String(fetcher.mock.calls[1]![0])).toContain('/operations/job')
})
