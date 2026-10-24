import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express, { type Request, type Response, type NextFunction, type Express } from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import { SessionRegistry, SessionError, readProfile, type AccountProvider } from './session'
import { RoomRegistry, RoomError, object, type RoomOptions } from './rooms'
import { getStandaloneRuntimeIdentity } from './native'
import { AccountDirectoryError, type AccountDirectory, type VerifiedIdentity } from './accounts/directory'
import { ProviderError, type AuthIntent, type EmailCodeVerifier, type GithubAppVerifier } from './providers'

export interface G3AccountServices {
  directory: AccountDirectory
  email: Pick<EmailCodeVerifier, 'providerId' | 'begin' | 'verify'>
  github: Pick<GithubAppVerifier, 'providerId' | 'begin' | 'verify' | 'callbackOrigins'>
  /** Check database/schema before opening the listener. */
  ready?: () => Promise<void>
}

export interface SingleProcessAppOptions extends RoomOptions {
  port?: number
  host?: string
  serverId?: string
  corsOrigins?: string[]
  sessionTtlMs?: number
  maxSessions?: number
  accountProvider?: AccountProvider
  accounts?: G3AccountServices
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
  if (options.accounts && (!options.serverId || options.accountProvider))
    throw new Error('G3 accounts require an explicit stable serverId and cannot use the legacy accountProvider')
  if (
    options.accounts &&
    (options.accounts.email.providerId !== 'email' || options.accounts.github.providerId !== 'github')
  )
    throw new Error('G3 accounts require email and GitHub App verifiers')
  if (options.accounts && (!options.corsOrigins?.length || options.corsOrigins.includes('*')))
    throw new Error('G3 accounts require explicit non-wildcard CORS origins')
  if (
    options.accounts &&
    options.corsOrigins &&
    (new Set(options.corsOrigins).size !== options.corsOrigins.length ||
      options.accounts.github.callbackOrigins.length !== options.corsOrigins.length ||
      options.corsOrigins.some(origin => !options.accounts!.github.callbackOrigins.includes(origin)))
  )
    throw new Error('G3 GitHub App callbacks must exactly match CORS origins')
  const port = options.port ?? 8102
  const host = options.host ?? '0.0.0.0'
  const sessions = new SessionRegistry({
    serverId: options.serverId ?? `node:${host}:${port}`,
    ttlMs: options.sessionTtlMs,
    maxSessions: options.maxSessions,
    accountProvider: options.accountProvider,
    accountEnabled: !!options.accounts,
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
    res.json({
      ...sessions.getServerInfo(),
      ...(options.accounts ? { accountProviders: ['email', 'github'] as const } : {}),
      runtime: await getStandaloneRuntimeIdentity(),
    })
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
  if (options.accounts) {
    const accounts = options.accounts
    const source = (req: Request) => req.socket.remoteAddress ?? 'unknown'
    const accountSession = (req: Request) => {
      const session = sessions.authenticate(token(req))
      if (!session) throw new SessionError('INVALID_SESSION', 401)
      if (session.principal.kind !== 'account') throw new SessionError('ACCOUNT_REQUIRED', 403)
      return session as typeof session & { principal: { kind: 'account'; accountId: string } }
    }
    const intent = (req: Request, value: unknown): AuthIntent => {
      if (value === 'login') return { kind: 'login' }
      if (value === 'link') {
        const current = accountSession(req)
        return { kind: 'link', accountId: current.principal.accountId, sessionId: current.sessionId }
      }
      throw new SessionError('INVALID_AUTH_INTENT', 400)
    }
    const providerCall = async <T>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action()
      } catch (error) {
        if (error instanceof ProviderError || error instanceof SessionError) throw error
        throw new SessionError('PROVIDER_UNAVAILABLE', 503)
      }
    }
    const accountStore = async <T>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action()
      } catch (error) {
        if (error instanceof AccountDirectoryError || error instanceof SessionError) throw error
        throw new SessionError('ACCOUNT_STORE_UNAVAILABLE', 503)
      }
    }
    const verified = (providerId: string, identity: { issuer: string; subject: string; verifiedAt: number }) =>
      ({ providerId, ...identity }) satisfies VerifiedIdentity
    const complete = async (req: Request, res: Response, identity: VerifiedIdentity, authIntent: AuthIntent) => {
      if (stopped) throw new SessionError('SERVER_STOPPED', 503)
      if (authIntent.kind === 'link') {
        const current = accountSession(req)
        if (current.principal.accountId !== authIntent.accountId || current.sessionId !== authIntent.sessionId)
          throw new SessionError('AUTH_PROOF_MISMATCH', 401)
        await accountStore(() => accounts.directory.link(authIntent.accountId, identity))
        const identities = await accountStore(() => accounts.directory.list(authIntent.accountId))
        res.json({ identities })
        return
      }
      const profile = readProfile(object(req.body).profile)
      const account = await accountStore(() => accounts.directory.resolveOrCreate(identity))
      let issued: ReturnType<SessionRegistry['issueVerifiedAccount']> | undefined
      try {
        await accountStore(() =>
          accounts.directory.withActiveIdentity(account.accountId, identity, () => {
            issued = sessions.issueVerifiedAccount(profile, account.accountId)
          }),
        )
      } catch (error) {
        // COMMIT can fail after the callback issued a token; never retain it.
        if (issued) sessions.revoke(issued.token)
        throw error
      }
      if (!issued) throw new SessionError('ACCOUNT_STORE_UNAVAILABLE', 503)
      res.status(201).json({ session: issued })
    }
    // The proof endpoints share the same bounded in-process admission budget as guest sessions.
    const limited =
      (handler: (req: Request, res: Response) => Promise<void>) =>
      async (req: Request, res: Response, next: NextFunction) => {
        const address = source(req)
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
        pendingAdmissions++
        try {
          await handler(req, res)
        } catch (error) {
          next(error)
        } finally {
          pendingAdmissions--
        }
      }
    app.post(
      '/api/v1/auth/email/challenges',
      limited(async (req, res) => {
        const input = object(req.body)
        const authIntent = intent(req, input.intent)
        if (typeof input.email !== 'string') throw new SessionError('INVALID_EMAIL', 400)
        const challenge = await providerCall(() =>
          accounts.email.begin({ email: input.email as string, source: source(req), intent: authIntent }),
        )
        res.status(201).json(challenge)
      }),
    )
    app.post(
      '/api/v1/auth/email/complete',
      limited(async (req, res) => {
        const input = object(req.body)
        const authIntent = intent(req, input.intent)
        if (authIntent.kind === 'login') readProfile(input.profile)
        if (typeof input.challengeId !== 'string' || typeof input.code !== 'string')
          throw new SessionError('INVALID_REQUEST', 400)
        const identity = await providerCall(() =>
          accounts.email.verify(
            { challengeId: input.challengeId as string, code: input.code as string, source: source(req) },
            authIntent,
          ),
        )
        await complete(req, res, verified(accounts.email.providerId, identity), authIntent)
      }),
    )
    app.post(
      '/api/v1/auth/github/authorizations',
      limited(async (req, res) => {
        const authIntent = intent(req, object(req.body).intent)
        // A browser never supplies a callback URI. Its allowed Origin maps to
        // that web application's fixed /account callback.
        const requestOrigin = req.get('origin')
        if (!requestOrigin || !allowed.includes(requestOrigin)) throw new SessionError('INVALID_AUTH_ORIGIN', 400)
        const redirectUri = new URL('/account', requestOrigin).href
        const authorization = await providerCall(() => accounts.github.begin({ intent: authIntent, redirectUri }))
        res.status(201).json(authorization)
      }),
    )
    app.post(
      '/api/v1/auth/github/complete',
      limited(async (req, res) => {
        const input = object(req.body)
        const authIntent = intent(req, input.intent)
        if (authIntent.kind === 'login') readProfile(input.profile)
        if (
          typeof input.state !== 'string' ||
          typeof input.code !== 'string' ||
          typeof input.browserSecret !== 'string'
        )
          throw new SessionError('INVALID_REQUEST', 400)
        const identity = await providerCall(() =>
          accounts.github.verify(
            {
              state: input.state as string,
              code: input.code as string,
              browserSecret: input.browserSecret as string,
            },
            authIntent,
          ),
        )
        await complete(req, res, verified(accounts.github.providerId, identity), authIntent)
      }),
    )
    app.get('/api/v1/account/identities', async (req, res) => {
      const current = accountSession(req)
      const identities = await accountStore(() => accounts.directory.list(current.principal.accountId))
      res.json({ identities })
    })
    app.delete('/api/v1/account/identities', async (req, res) => {
      const current = accountSession(req)
      const input = object(req.body)
      await accountStore(() =>
        accounts.directory.unlink(current.principal.accountId, {
          providerId: input.providerId as string,
          issuer: input.issuer as string,
          subject: input.subject as string,
        }),
      )
      res.sendStatus(204)
    })
    app.delete('/api/v1/account', async (req, res) => {
      const current = accountSession(req)
      const accountId = current.principal.accountId
      const revokeLiveAccount = async () => {
        const revoked = sessions.blockAccount(accountId)
        const results = await Promise.allSettled(revoked.map(session => rooms.revoke(session)))
        if (results.some(result => result.status === 'rejected'))
          throw new SessionError('ACCOUNT_REVOCATION_FAILED', 503)
      }
      try {
        // The directory serializes this commit with in-flight account issuance.
        await accountStore(() => accounts.directory.deactivate(accountId))
      } catch (error) {
        let status: Awaited<ReturnType<AccountDirectory['getStatus']>> | undefined
        try {
          status = await accounts.directory.getStatus(accountId)
        } catch {
          // An ambiguous database outcome must not leave a possibly deactivated account authorized.
        }
        if (status === 'active') throw error
        if (status !== 'deactivated') {
          await revokeLiveAccount().catch(() => undefined)
          throw error
        }
        // COMMIT may have succeeded even if its acknowledgement was lost.
      }
      await revokeLiveAccount()
      res.sendStatus(204)
    })
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ProviderError) {
      res.status(error.statusCode).json({ code: error.code })
      return
    }
    if (error instanceof AccountDirectoryError) {
      const status = {
        INVALID_IDENTITY: 400,
        ACCOUNT_NOT_FOUND: 404,
        ACCOUNT_DEACTIVATED: 403,
        IDENTITY_CONFLICT: 409,
        IDENTITY_NOT_FOUND: 404,
        LAST_RECOVERY_METHOD: 409,
      }[error.code]
      res.status(status).json({ code: error.code })
      return
    }
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
      if (options.accounts?.ready) await options.accounts.ready()
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
