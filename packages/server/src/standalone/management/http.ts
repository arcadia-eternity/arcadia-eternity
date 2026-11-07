import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import { isIP } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { ManagementAuthError, type ManagementSession } from './auth'
import { type ManagementService, type ManagementResponse } from './service'
import type { SessionRegistry } from '../session'

const PREFIX = '/api/management/v1'
const COOKIE = 'arcadia_management'
const cookieToken = (request: Request) => {
  const value = request.headers.cookie
    ?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  return value && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : undefined
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
  options: {
    secureCookies: boolean
    acceptsOrigin(request: Request): boolean
    sessions: SessionRegistry
    trustedProxyAddresses?: string[]
    publicOrigin?: string
  },
) {
  const trustedProxyAddresses = new Set(
    (options.trustedProxyAddresses ?? []).map(address => {
      if (!isIP(address)) throw new Error('MANAGEMENT_PROXY_IP_INVALID')
      return address.replace(/^::ffff:/, '')
    }),
  )
  const bodyParser = (req: Request, res: Response, large = false) =>
    new Promise<void>((resolve, reject) => {
      express.json({ limit: large ? '130mb' : '2mb', strict: true })(req, res, ((error?: unknown) =>
        error ? reject(error) : resolve()) as NextFunction)
    })
  const attempts = new Map<string, { count: number; until: number }>()
  const cookie = (value: string, maxAge: number) =>
    `${COOKIE}=${value}; Path=${PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secureCookies ? '; Secure' : ''}`
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
        !isManagementTransportTrusted({
          remoteAddress: req.socket.remoteAddress,
          encrypted: (req.socket as TLSSocket).encrypted,
          forwardedProto: req.headers['x-forwarded-proto'],
          publicOrigin: options.publicOrigin,
          trustedProxyAddresses: [...trustedProxyAddresses],
        })
      )
        throw new ManagementAuthError('MANAGEMENT_TLS_REQUIRED', 403)
      const path = req.path
      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      if (req.method === 'POST' && ['/session/bootstrap', '/session/account'].includes(path)) {
        await bodyParser(req, res)
        const key = req.socket.remoteAddress ?? 'unknown',
          now = Date.now()
        for (const [address, entry] of attempts) if (entry.until <= now) attempts.delete(address)
        const attempt = attempts.get(key) ?? { count: 0, until: now + 60_000 }
        if (attempt.count >= 10 || attempts.size > 4096) throw new ManagementAuthError('LOGIN_RATE_LIMITED', 429)
        attempt.count++
        attempts.set(key, attempt)
        let session: ManagementSession
        if (path === '/session/bootstrap') session = await service.auth.exchangeBootstrap(req.body?.code)
        else {
          const player = options.sessions.authenticate(bearerToken(req))
          if (player?.principal.kind !== 'account') throw new ManagementAuthError('VERIFIED_ACCOUNT_REQUIRED', 401)
          session = await service.auth.exchangeAccount(service.options.serverId, player.principal.accountId)
        }
        res.setHeader('Set-Cookie', cookie(session.token, Math.max(0, Math.floor((session.expiresAt - now) / 1000))))
        res.json(sessionBody(session))
        return
      }
      const bearer = bearerToken(req),
        rawToken = bearer ?? cookieToken(req)
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
        await service.auth.revokeCredential(actor, actor.credentialId)
        res.setHeader('Set-Cookie', cookie('', 0))
        res.json({ loggedOut: true })
        return
      }
      if (unsafe && bearer && actor.kind !== 'service') throw new ManagementAuthError('SERVICE_CREDENTIAL_REQUIRED')
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
