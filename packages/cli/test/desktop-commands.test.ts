import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerDesktopCommands } from '../src/commands/desktop-commands'

const clients = vi.hoisted(() => ({ list: vi.fn(), connect: vi.fn(), request: vi.fn() }))
vi.mock('@arcadia-eternity/content-sdk/desktop', () => ({
  listDesktopInstances: clients.list,
  connectDesktopInstance: clients.connect,
}))

describe('arcadia desktop', () => {
  const id = '2'.repeat(32)
  const snapshot = { host: { status: 'running' }, phase: 'idle', configured: true }
  beforeEach(() => {
    vi.resetAllMocks()
    clients.list.mockResolvedValue([{ id, label: 'Player' }])
    clients.connect.mockResolvedValue({ id, label: 'Player', request: clients.request })
    clients.request.mockResolvedValue(snapshot)
  })
  async function run(args: string[]) {
    const program = new Command().exitOverride()
    let stdout = ''
    const signal = new AbortController().signal
    registerDesktopCommands(program, {
      cwd: process.cwd(),
      signal,
      stdout: async text => {
        stdout += text
      },
      stderr: async () => {},
    })
    await program.parseAsync(['desktop', ...args], { from: 'user' })
    return JSON.parse(stdout) as unknown
  }
  it('discovers players without starting a server', async () => {
    expect(await run(['instances', '--json'])).toEqual({ instances: [{ id, label: 'Player' }] })
    expect(clients.connect).not.toHaveBeenCalled()
    expect(clients.request).not.toHaveBeenCalled()
  })
  it.each([
    [['server', 'status', '--instance', id], { action: 'status' }],
    [['--instance', id, 'server', 'start'], { action: 'start' }],
    [
      ['server', 'start', '--scope', 'public', '--port', '0', '--public-origin', 'https://game.test', '--instance', id],
      {
        action: 'start',
        configuration: { scope: 'public', port: 0, name: '我的服务器', publicOrigin: 'https://game.test' },
      },
    ],
    [
      ['server', 'start', '--name', 'Practice', '--instance', id],
      { action: 'start', configuration: { scope: 'local', port: 8102, name: 'Practice' } },
    ],
    [['server', 'stop', '--instance', id], { action: 'stop' }],
    [['server', 'stop', '--force', '--instance', id], { action: 'stop', force: true }],
    [['server', 'restart', '--instance', id], { action: 'restart' }],
  ] as const)('routes %j through the selected player', async (args, intent) => {
    expect(await run([...args])).toEqual(snapshot)
    expect(clients.connect).toHaveBeenCalledWith(id, { signal: expect.any(AbortSignal) })
    expect(clients.request).toHaveBeenCalledWith({ operation: 'server', ...intent })
  })
  it('preserves owner error codes for the CLI diagnostic', async () => {
    clients.request.mockRejectedValue(
      Object.assign(new Error('Configure your server before starting'), { code: 'LAUNCH_REQUIRED' }),
    )
    await expect(run(['server', 'start', '--json'])).rejects.toMatchObject({ code: 'LAUNCH_REQUIRED' })
    await expect(run(['server', 'start', '--scope', 'public'])).rejects.toMatchObject({ code: 'INVALID_LAUNCH' })
    expect(clients.request).toHaveBeenCalledTimes(1)
  })
})
