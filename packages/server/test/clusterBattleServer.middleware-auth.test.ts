import { describe, it, expect, vi } from 'vitest'
import { ClusterBattleServer } from '../src/domain/battle/services/clusterBattleServer'

type MiddlewareFn = (socket: any, next: (err?: Error) => void) => Promise<void>

function createMiddlewareHarness(overrides?: {
  player?: any
  payload?: any
  isTokenBlacklisted?: boolean
}) {
  const server = Object.create(ClusterBattleServer.prototype) as any
  let middleware: MiddlewareFn | undefined

  server.clientRealtimeGateway = {
    use: vi.fn((fn: MiddlewareFn) => {
      middleware = fn
    }),
  }
  server.playerRepository = {
    getPlayerById: vi.fn(async () => overrides?.player ?? { id: 'player-1', is_registered: true }),
  }
  server.authService = {
    verifyAccessTokenAsync: vi.fn(async () => overrides?.payload ?? { playerId: 'player-1', jti: 'jti-1' }),
    getSession: vi.fn(async () => null),
  }
  server.stateManager = {
    isTokenBlacklisted: vi.fn(async () => overrides?.isTokenBlacklisted ?? false),
  }

  server.initializeMiddleware()
  if (!middleware) {
    throw new Error('Middleware not initialized')
  }

  return { server, middleware }
}

describe('ClusterBattleServer middleware auth/session behavior', () => {
  it('accepts registered socket handshake with battle session id without auth-session lookup', async () => {
    const { server, middleware } = createMiddlewareHarness()
    const socket = {
      handshake: {
        query: { playerId: 'player-1', sessionId: 'battle-session-1' },
        auth: { token: 'token-1' },
      },
      data: {},
    }
    const next = vi.fn()

    await middleware(socket, next)

    expect(next).toHaveBeenCalledWith()
    expect(socket.data.playerId).toBe('player-1')
    expect(socket.data.sessionId).toBe('battle-session-1')
    expect(server.authService.getSession).not.toHaveBeenCalled()
  })

  it('still rejects when token player id mismatches query player id', async () => {
    const { middleware } = createMiddlewareHarness({
      payload: { playerId: 'another-player', jti: 'jti-1' },
    })
    const socket = {
      handshake: {
        query: { playerId: 'player-1', sessionId: 'battle-session-1' },
        auth: { token: 'token-1' },
      },
      data: {},
    }
    const next = vi.fn()

    await middleware(socket, next)

    expect(next).toHaveBeenCalledTimes(1)
    const [error] = next.mock.calls[0] ?? []
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('PLAYER_ID_TOKEN_MISMATCH')
  })
})

