import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express, { type Request, type Response, type NextFunction, type Express } from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import { SessionRegistry, SessionError, type AccountProvider } from './session'
import { RoomRegistry, RoomError, object, type RoomOptions } from './rooms'
import { getStandaloneRuntimeIdentity } from './native'

export interface SingleProcessAppOptions extends RoomOptions {
  port?: number
  host?: string
  serverId?: string
  corsOrigins?: string[]
  sessionTtlMs?: number
  maxSessions?: number
  accountProvider?: AccountProvider
}

export interface SingleProcessApp {
  app: Express
  httpServer: HttpServer
  io: Server
  sessions: SessionRegistry
  rooms: RoomRegistry
  readonly address: AddressInfo | null
  start(): Promise<void>
  stop(): Promise<void>
}

/** A deliberately ephemeral Node host: restarts invalidate every room and session. */
export function createSingleProcessApp(options: SingleProcessAppOptions = {}): SingleProcessApp {
  const port = options.port ?? 8102
  const host = options.host ?? '0.0.0.0'
  const sessions = new SessionRegistry({
    serverId: options.serverId ?? `node:${host}:${port}`,
    ttlMs: options.sessionTtlMs,
    maxSessions: options.maxSessions,
    accountProvider: options.accountProvider,
  })
  const app = express()
  app.disable('x-powered-by')
  const allowed = options.corsOrigins ?? []
  const origin = (value: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => {
    callback(null, !value || allowed.includes('*') || allowed.includes(value))
  }
  app.use(
    cors({ origin, allowedHeaders: ['Authorization', 'Content-Type'], methods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }),
  )
  app.use(express.json({ limit: '32kb', strict: true }))
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  const httpServer = createServer(app)
  const io = new Server(httpServer, {
    cors: { origin },
    maxHttpBufferSize: 128 * 1024,
    pingInterval: 10_000,
    pingTimeout: 20_000,
    allowRequest: (req, callback) =>
      origin(req.headers.origin, (error, accepted) => callback(error?.message ?? null, accepted ?? false)),
  })
  const rooms = new RoomRegistry(io, sessions, options)
  let stopped = false,
    started = false
  let stopping: Promise<void> | undefined
  const token = (req: Request) => {
    const header = req.headers.authorization
    return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined
  }
  app.get('/health', (_req, res) => {
    res.status(stopped ? 503 : 200).json({ status: stopped ? 'stopped' : 'ok' })
  })
  app.get('/api/v1/server-info', async (_req, res) => {
    res.json({ ...sessions.getServerInfo(), runtime: await getStandaloneRuntimeIdentity() })
  })
  const admissions = new Map<string, { count: number; until: number }>()
  let pendingAdmissions = 0
  app.post('/api/v1/sessions', async (req, res) => {
    const address = req.socket.remoteAddress ?? 'unknown'
    const now = Date.now()
    let admission = admissions.get(address)
    if (!admission || admission.until <= now) {
      admission = { count: 0, until: now + 60_000 }
      if (admissions.size >= 1024) admissions.delete(admissions.keys().next().value!)
      admissions.set(address, admission)
    }
    if (++admission.count > 60 || pendingAdmissions >= 32) {
      res.status(429).json({ code: 'RATE_LIMITED' })
      return
    }
    if (stopped) {
      res.status(503).json({ code: 'SERVER_STOPPED' })
      return
    }
    const input = object(req.body)
    pendingAdmissions++
    try {
      const session = await sessions.create(input.profile, input.accountProof)
      res.status(201).json(session)
    } finally {
      pendingAdmissions--
    }
  })
  app.get('/api/v1/session', (req, res) => {
    const session = sessions.authenticate(token(req))
    if (!session) {
      res.status(401).json({ code: 'INVALID_SESSION' })
      return
    }
    res.json(session)
  })
  app.delete('/api/v1/session', async (req, res) => {
    const credential = token(req),
      session = sessions.authenticate(credential)
    if (!session) {
      res.status(401).json({ code: 'INVALID_SESSION' })
      return
    }
    sessions.revoke(credential)
    await rooms.revoke(session)
    res.sendStatus(204)
  })
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SessionError) {
      res.status(error.statusCode).json({ code: error.code })
      return
    }
    if (error instanceof RoomError || error instanceof SyntaxError) {
      res.status(400).json({ code: 'INVALID_REQUEST' })
      return
    }
    if (error && typeof error === 'object' && 'status' in error && error.status === 413) {
      res.status(413).json({ code: 'PAYLOAD_TOO_LARGE' })
      return
    }
    res.status(500).json({ code: 'INTERNAL_ERROR' })
  })
  io.use((socket, next) => {
    const session = !stopped && sessions.authenticate(socket.handshake.auth.token)
    if (!session) {
      const error = new Error('INVALID_SESSION') as Error & { data: { code: string } }
      error.data = { code: 'INVALID_SESSION' }
      next(error)
      return
    }
    socket.data.session = session
    next()
  })
  io.on('connection', socket => {
    void rooms.connect(socket, socket.data.session).catch(() => socket.disconnect(true))
  })
  return {
    app,
    httpServer,
    io,
    sessions,
    rooms,
    get address(): AddressInfo | null {
      return httpServer.address() as AddressInfo | null
    },
    async start(): Promise<void> {
      if (stopped) throw new Error('Stopped apps cannot restart; create a new instance')
      if (started) return
      await getStandaloneRuntimeIdentity()
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          httpServer.off('listening', onListen)
          reject(error)
        }
        const onListen = () => {
          httpServer.off('error', onError)
          started = true
          resolve()
        }
        httpServer.once('error', onError)
        httpServer.once('listening', onListen)
        httpServer.listen(port, host)
      })
    },
    stop(): Promise<void> {
      if (stopping) return stopping
      stopped = true
      sessions.clear()
      stopping = (async () => {
        await rooms.stop()
        await new Promise<void>(resolve => io.close(() => resolve()))
        if (httpServer.listening)
          await new Promise<void>((resolve, reject) => httpServer.close(error => (error ? reject(error) : resolve())))
        started = false
      })()
      return stopping
    },
  }
}
