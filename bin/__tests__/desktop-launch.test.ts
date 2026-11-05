import { describe, expect, it, vi } from 'vitest'
import { parseDesktopLaunch, saveDesktopLaunch } from '../desktop-launch'
import type { ManagementService } from '@arcadia-eternity/server'

const launch = { name: '好友服务器', host: '0.0.0.0', port: 8102, publicOrigin: null }
describe('desktop launch intent', () => {
  it('validates the private channel before opening storage', () => {
    expect(parseDesktopLaunch(JSON.stringify(launch))).toEqual(launch)
    for (const change of [
      { port: -1 },
      { port: 65536 },
      { host: 'example.com' },
      { name: '' },
      { executable: '/tmp/anything' },
    ])
      expect(() => parseDesktopLaunch(JSON.stringify({ ...launch, ...change }))).toThrow()
  })
  it('writes basic launch settings through the owning revision-checked management API', async () => {
    const localRequest = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: { servers: [{ id: 'desktop', revision: 7 }] } })
      .mockResolvedValueOnce({ status: 200 })
    await saveDesktopLaunch({ localRequest } as unknown as ManagementService, launch)
    expect(localRequest.mock.calls[1]![0]).toEqual({
      method: 'PATCH',
      path: '/servers/desktop',
      headers: { 'if-match': '7' },
      body: { name: launch.name, settings: { host: launch.host, port: launch.port, publicOrigin: null } },
    })
  })
  it('does not launch after a configuration conflict', async () => {
    const localRequest = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: { servers: [{ id: 'desktop', revision: 7 }] } })
      .mockResolvedValueOnce({ status: 409 })
    await expect(saveDesktopLaunch({ localRequest } as unknown as ManagementService, launch)).rejects.toThrow('persist')
  })
})
