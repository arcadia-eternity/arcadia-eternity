import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  client: { serverUrl: 'https://official.test', isConnected: true, connect: vi.fn() },
  rooms: { currentRoom: null as null | { status: string }, switchServer: vi.fn() },
  authorize: vi.fn(),
  confirm: vi.fn(),
}))
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => mocks.client }))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => mocks.rooms }))
vi.mock('@/bootstrap/deployment', () => ({ authorizeLocalBackend: mocks.authorize }))
vi.mock('element-plus', () => ({ ElMessageBox: { confirm: mocks.confirm } }))
import { enterLocalServer, serverOrigin } from '../serverNavigation'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.rooms.currentRoom = null
  mocks.client.serverUrl = 'https://official.test'
  mocks.client.isConnected = true
  vi.stubGlobal('arcadiaDesktop', {
    getLocalBattleStatus: async () => ({ status: 'running', url: 'http://127.0.0.1:8102' }),
  })
})
it('authorizes only the actual main-process host when the user enters its lobby', async () => {
  expect(await enterLocalServer()).toBe(true)
  expect(mocks.authorize).toHaveBeenCalledOnce()
  expect(mocks.rooms.switchServer).toHaveBeenCalledWith('http://127.0.0.1:8102')
})
it('cancelling a switch preserves the current room and play connection', async () => {
  mocks.rooms.currentRoom = { status: 'started' }
  mocks.confirm.mockRejectedValueOnce('cancel')
  expect(await enterLocalServer()).toBe(false)
  expect(mocks.authorize).not.toHaveBeenCalled()
  expect(mocks.rooms.switchServer).not.toHaveBeenCalled()
})
it('reentering the same server does not leave its room', async () => {
  mocks.client.serverUrl = 'http://127.0.0.1:8102'
  mocks.rooms.currentRoom = { status: 'waiting' }
  expect(await enterLocalServer()).toBe(true)
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.rooms.switchServer).not.toHaveBeenCalled()
})
it('accepts only server origins, never credentials or routes', () => {
  expect(serverOrigin(' https://example.com/ ')).toBe('https://example.com')
  for (const value of [
    'file:///tmp',
    'https://u:p@example.com',
    'https://example.com/path',
    'https://example.com?token=x',
  ])
    expect(() => serverOrigin(value)).toThrow()
})
