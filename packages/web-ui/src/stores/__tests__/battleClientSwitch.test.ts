vi.mock('@/bootstrap/deployment', () => ({
  getBackendOrigin: () => 'http://localhost:8102',
  canSelectBackend: () => true,
  checkBackendSelection: () => {},
}))
import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'

interface FakeOptions {
  serverUrl: string
  auth: { getToken(): string | null }
}
interface FakeClient {
  options: FakeOptions
  currentState: { status: string }
  emit(event: string, ...args: unknown[]): void
  handlers: Map<string, ((...args: unknown[]) => void)[]>
}

const mocks = vi.hoisted(() => ({
  auth: {
    hasSelectedServer: true,
    serverUrl: 'https://a.test',
    serverGeneration: 0,
    session: { seatId: 'seat-a', sessionId: 'session-a' },
    token: 'token-a',
    ensureSession: vi.fn(),
    getAccessToken: vi.fn(),
  },
  instances: [] as FakeClient[],
}))
vi.mock('@arcadia-eternity/client', () => ({
  BattleClient: class {
    serverUrl: string
    options: FakeOptions
    currentState = { status: 'disconnected', matchmaking: 'idle', battle: 'idle' }
    handlers = new Map<string, ((...args: unknown[]) => void)[]>()
    stateHandler: (() => void) | undefined
    constructor(options: FakeOptions) {
      this.options = options
      this.serverUrl = options.serverUrl
      mocks.instances.push(this)
    }
    onStateChange(handler: () => void) {
      this.stateHandler = handler
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
      return () => {}
    }
    off() {}
    disconnect() {
      this.currentState.status = 'disconnected'
      this.stateHandler?.()
      this.handlers.clear()
      this.stateHandler = undefined
    }
    async connect() {
      this.currentState.status = 'connected'
      this.stateHandler?.()
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.forEach(handler => handler(...args))
    }
  },
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => reactive(mocks.auth) }))
vi.mock('@/stores/player', () => ({ usePlayerStore: () => ({ id: 'profile', name: 'Player' }) }))
import { useBattleClientStore } from '../battleClient'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.instances.length = 0
  Object.assign(reactive(mocks.auth), {
    serverGeneration: 0,
    serverUrl: 'https://a.test',
    hasSelectedServer: true,
    token: 'token-a',
  })
  mocks.auth.getAccessToken.mockImplementation(() => mocks.auth.token)
  mocks.auth.ensureSession.mockResolvedValue(undefined)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  )
  setActivePinia(createPinia())
})

it('scopes socket credentials and preserves room subscriptions when replacing a connection', async () => {
  const store = useBattleClientStore()
  const handler = vi.fn()
  store.on('privateRoomEvent', handler)
  store.initialize()
  const first = mocks.instances[0]
  first.emit('privateRoomEvent', 'from-a')
  const oldHandler = first.handlers.get('privateRoomEvent')![0]
  expect(handler).toHaveBeenCalledWith('from-a')
  expect(first.options.auth.getToken()).toBe('token-a')
  reactive(mocks.auth).serverGeneration++
  reactive(mocks.auth).token = 'token-b'
  store.replaceServer('https://b.test')
  expect(first.options.auth.getToken()).toBeNull()
  const second = mocks.instances[1]
  expect(second.options.auth.getToken()).toBe('token-b')
  second.emit('privateRoomEvent', 'from-b')
  oldHandler('late-from-a')
  expect(handler).toHaveBeenCalledWith('from-b')
  expect(handler).toHaveBeenCalledTimes(2)
})

it('restores state and room listeners after disconnecting and reconnecting the same client', async () => {
  const store = useBattleClientStore()
  const handler = vi.fn()
  store.on('privateRoomEvent', handler)
  store.initialize()
  store.disconnect()
  await store.connect()
  mocks.instances[0].emit('privateRoomEvent', 'after-reconnect')
  expect(handler).toHaveBeenCalledWith('after-reconnect')
  expect(store.currentState.status).toBe('connected')
})

it('cannot connect the replacement socket when the former health request resolves late', async () => {
  let finish!: (value: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>(resolve => {
          finish = resolve
        }),
    ),
  )
  const store = useBattleClientStore()
  store.initialize()
  const first = store.connect()
  reactive(mocks.auth).serverGeneration++
  store.replaceServer('https://b.test')
  finish(new Response('{}', { status: 200 }))
  await expect(first).rejects.toThrow('连接已取消')
  expect(mocks.auth.ensureSession).not.toHaveBeenCalled()
  expect(mocks.instances[1].currentState.status).toBe('disconnected')
})

it('does not connect a replacement socket after a former session request resolves late', async () => {
  let finish!: () => void
  mocks.auth.ensureSession.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      }),
  )
  const store = useBattleClientStore()
  store.initialize()
  const first = store.connect()
  await vi.waitFor(() => expect(mocks.auth.ensureSession).toHaveBeenCalledOnce())
  reactive(mocks.auth).serverGeneration++
  store.replaceServer('https://b.test')
  finish()
  await expect(first).rejects.toThrow('连接已取消')
  expect(mocks.instances[1].currentState.status).toBe('disconnected')
})
