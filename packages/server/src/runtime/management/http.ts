import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import { isIP } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { ManagementAuthError, type ManagementSession } from './auth'
import { type ManagementService, type ManagementResponse } from './service'
import type { SessionRegistry } from '../session'

const PREFIX = '/api/management/v1'
const COOKIE = 'arcadia_management'
const cookieSameSite = { lax: 'Lax', strict: 'Strict', none: 'None' } as const

export interface ManagementHttpPolicy {
  requireTls?: boolean
  cookieSameSite?: keyof typeof cookieSameSite
  secureCookies?: boolean
  trustedProxyAddresses?: string[]
}

const cookieToken = (request: Request, name: string) => {
  const prefix = `${name}=`
  const value = request.headers.cookie
    ?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(prefix))
    ?.slice(prefix.length)
  return value && /^[A-Za-z0-9_.-]{1,256}$/.test(value) ? value : undefined
}
const bearerToken = (request: Request) => {
  const value = request.headers.authorization
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : undefined
}
export function managementFailure(error: unknown): ManagementResponse {
  const item = error as { code?: string; status?: number; name?: string }
  const code =
    item.status === 413
      ? 'PAYLOAD_TOO_LARGE'
      : error instanceof SyntaxError || error instanceof URIError
        ? 'INVALID_REQUEST'
        : item.code && /^[A-Z][A-Z0-9_]{0,79}$/.test(item.code)
          ? item.code
          : 'INTERNAL_ERROR'
  const status =
    item.status ??
    (code === 'REVISION_CONFLICT'
      ? 412
      : code === 'ALREADY_EXISTS'
        ? 409
        : code === 'NOT_FOUND' || code === 'ENOENT'
          ? 404
          : code === 'ENVIRONMENT_IN_USE'
            ? 409
            : code === 'INTERNAL_ERROR'
              ? 500
              : 422)
  return { status, body: { error: { code, message: code, retryable: status >= 500 } } }
}

export function isManagementTransportTrusted(input: {
  remoteAddress?: string
  encrypted?: boolean
  forwardedProto?: string | string[]
  publicOrigin?: string
  trustedProxyAddresses?: readonly string[]
}): boolean {
  const address = input.remoteAddress?.replace(/^::ffff:/, '')
  const local = address === '::1' || (!!address && isIP(address) === 4 && address.startsWith('127.'))
  if (local || input.encrypted) return true
  return (
    !!address &&
    (input.trustedProxyAddresses ?? []).some(value => value.replace(/^::ffff:/, '') === address) &&
    input.forwardedProto === 'https' &&
    !!input.publicOrigin?.startsWith('https:')
  )
}

export function mountManagementApi(
  app: Express,
  service: ManagementService,
  options: ManagementHttpPolicy & {
    acceptsOrigin(request: Request): boolean
    sessions: SessionRegistry
    publicOrigin?: string
  },
) {
  const trustedProxyAddresses = (options.trustedProxyAddresses ?? []).map(address => {
    if (!isIP(address)) throw new Error('MANAGEMENT_PROXY_IP_INVALID')
    return address.replace(/^::ffff:/, '')
  })
  const requireTls = options.requireTls ?? trustedProxyAddresses.length > 0
  const sameSite = cookieSameSite[options.cookieSameSite ?? 'lax']
  const partitioned = sameSite === 'None'
  const cookieName = partitioned ? `${COOKIE}_partitioned` : COOKIE
  const secure = partitioned || options.secureCookies !== false
  const bodyParser = (req: Request, res: Response, large = false) =>
    new Promise<void>((resolve, reject) => {
      express.json({ limit: large ? '130mb' : '2mb', strict: true })(req, res, ((error?: unknown) =>
        error ? reject(error) : resolve()) as NextFunction)
    })
  const attempts = new Map<string, { count: number; until: number }>()
  const cookie = (value: string, maxAge: number) =>
    `${cookieName}=${value}; Path=${PREFIX}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? '; Secure' : ''}${partitioned ? '; Partitioned' : ''}`
  const deviceCookie = (value: string, maxAge: number) =>
    cookie(value, maxAge).replace(`${cookieName}=`, `${cookieName}_device=`)
  const passkeyOrigin = (req: Request) => {
    const origin = req.headers.origin
    if (!origin || !options.acceptsOrigin(req)) throw new ManagementAuthError('ORIGIN_REQUIRED')
    const url = new URL(origin)
    if (
      url.origin !== origin ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    )
      throw new ManagementAuthError('PASSKEY_HTTPS_REQUIRED', 403)
    return origin
  }
  const sessionBody = (session: Omit<ManagementSession, 'token'>) => ({
    principalId: session.actor.principalId,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    serverId: service.options.serverId,
    workspaceId: service.options.workspace.workspaceId,
  })
  app.use(PREFIX, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      if (req.headers.origin && !options.acceptsOrigin(req)) throw new ManagementAuthError('ORIGIN_FORBIDDEN')
      if (
        requireTls &&
        !isManagementTransportTrusted({
          remoteAddress: req.socket.remoteAddress,
          encrypted: (req.socket as TLSSocket).encrypted,
          forwardedProto: req.headers['x-forwarded-proto'],
          publicOrigin: options.publicOrigin,
          trustedProxyAddresses,
        })
      )
        throw new ManagementAuthError('MANAGEMENT_TLS_REQUIRED', 403)
      const path = req.path
      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      if (
        req.method === 'POST' &&
        [
          '/session/bootstrap',
          '/session/account',
          '/session/refresh',
          '/session/passkey/options',
          '/session/passkey',
        ].includes(path)
      ) {
        const refreshing = path === '/session/refresh'
        // Passive discovery without a saved device is not a failed login attempt.
        if (refreshing && !cookieToken(req, `${cookieName}_device`))
          throw new ManagementAuthError('MANAGEMENT_UNAUTHENTICATED', 401)
        await bodyParser(req, res)
        const key = `${req.socket.remoteAddress ?? 'unknown'}:${refreshing ? 'refresh' : 'login'}`,
          now = Date.now()
        for (const [address, entry] of attempts) if (entry.until <= now) attempts.delete(address)
        const attempt = attempts.get(key) ?? { count: 0, until: now + 60_000 }
        if (attempt.count >= (refreshing ? 60 : 10) || attempts.size > 4096)
          throw new ManagementAuthError('LOGIN_RATE_LIMITED', 429)
        attempt.count++
        attempts.set(key, attempt)
        if (path === '/session/passkey/options') {
          res.json(await service.auth.passkeyLoginOptions(passkeyOrigin(req)))
          return
        }
        if (path === '/session/refresh') {
          if (!req.headers.origin) throw new ManagementAuthError('ORIGIN_REQUIRED')
          const refreshed = await service.auth.refreshDevice(cookieToken(req, `${cookieName}_device`) ?? '')
          res.setHeader('Set-Cookie', [
            cookie(refreshed.session.token, Math.floor((refreshed.session.expiresAt - now) / 1000)),
            deviceCookie(refreshed.token, Math.floor((refreshed.expiresAt - now) / 1000)),
          ])
          res.json(sessionBody(refreshed.session))
          return
        }
        let session: ManagementSession
        if (path === '/session/bootstrap') session = await service.auth.exchangeBootstrap(req.body?.code)
        else if (path === '/session/passkey') session = await service.auth.loginPasskey(passkeyOrigin(req), req.body)
        else {
          const player = options.sessions.authenticate(bearerToken(req))
          if (player?.principal.kind !== 'account') throw new ManagementAuthError('VERIFIED_ACCOUNT_REQUIRED', 401)
          session = await service.auth.exchangeAccount(service.options.serverId, player.principal.accountId)
        }
        const cookies = [cookie(session.token, Math.max(0, Math.floor((session.expiresAt - now) / 1000)))]
        if (req.body?.remember === true) {
          const device = await service.auth.rememberDevice(session.actor, '浏览器设备')
          cookies.push(deviceCookie(device.token, Math.floor((device.expiresAt - now) / 1000)))
        } else cookies.push(deviceCookie('', 0))
        res.setHeader('Set-Cookie', cookies)
        res.json(sessionBody(session))
        return
      }
      const bearer = bearerToken(req),
        rawToken = bearer ?? cookieToken(req, cookieName)
      if (req.method === 'GET' && path === '/capabilities' && !rawToken) {
        res.json(await service.capabilities())
        return
      }
      const actor = await service.auth.authenticate(rawToken)
      if (!bearer && unsafe) {
        if (!req.headers.origin) throw new ManagementAuthError('ORIGIN_REQUIRED')
        await service.auth.validateCsrf(actor, req.headers['x-csrf-token'] as string | undefined)
      }
      if (unsafe) {
        const importing = /^\/workspaces\/[^/]+\/import$/.test(path)
        if (importing) {
          if (decodeURIComponent(path.split('/')[2]) !== service.options.workspace.workspaceId)
            throw new ManagementAuthError('WORKSPACE_NOT_FOUND', 404)
          await service.auth.authorize(actor, service.workspaceScope, 'edit')
          await service.auth.authorize(actor, service.workspaceScope, 'prepare')
        }
        await bodyParser(req, res, importing)
      }
      if (req.method === 'GET' && path === '/session') {
        res.json(sessionBody(await service.auth.sessionInfo(rawToken!)))
        return
      }
      if (req.method === 'POST' && path === '/session/logout') {
        await service.auth.logoutSession(actor)
        res.setHeader('Set-Cookie', [cookie('', 0), deviceCookie('', 0)])
        res.json({ loggedOut: true })
        return
      }
      if (unsafe && bearer && actor.kind !== 'service') throw new ManagementAuthError('SERVICE_CREDENTIAL_REQUIRED')
      if (path === '/login-methods' && req.method === 'GET') {
        res.json({ methods: await service.auth.loginMethods(actor) })
        return
      }
      if (path.startsWith('/login-methods/') && req.method === 'DELETE') {
        await service.auth.revokeLoginMethod(actor, decodeURIComponent(path.slice('/login-methods/'.length)))
        res.json({ revoked: true })
        return
      }
      if (path === '/passkeys/options' && req.method === 'POST') {
        res.json(await service.auth.passkeyRegistrationOptions(actor, passkeyOrigin(req)))
        return
      }
      if (path === '/passkeys' && req.method === 'POST') {
        await service.auth.registerPasskey(actor, passkeyOrigin(req), req.body)
        res.json({ registered: true })
        return
      }
      if (service.transfers && req.method === 'GET' && /^\/transfers\/[a-f0-9]{64}$/.test(path)) {
        const artifact = await service.transfers.download(actor, path.split('/')[2])
        res.once('close', () => {
          void artifact.release()
        })
        res.download(artifact.file, artifact.filename, error => {
          void artifact.release()
          if (error && !res.headersSent)
            res.status(500).json({
              error: { code: 'TRANSFER_DOWNLOAD_FAILED', message: 'TRANSFER_DOWNLOAD_FAILED', retryable: true },
            })
        })
        return
      }
      const result = await service.request(actor, {
        method: req.method,
        path: req.url,
        body: req.body,
        headers: {
          'if-match': req.headers['if-match'],
          'idempotency-key': req.headers['idempotency-key'] as string | undefined,
        },
      })
      if (result.headers) for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value)
      res.status(result.status).json(result.body)
    } catch (error) {
      const result = managementFailure(error)
      res.status(result.status).json(result.body)
    }
  })
}
