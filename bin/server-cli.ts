import 'dotenv/config'
import { Command, CommanderError, InvalidArgumentError } from 'commander'
import pg from 'pg'
import nodemailer from 'nodemailer'
import {
  createSingleProcessApp,
  EmailCodeVerifier,
  OidcVerifier,
  PgAccountDirectory,
  ensureAccountSchema,
  type G3AccountServices,
} from '@arcadia-eternity/server'

function portNumber(value: string): number {
  const port = Number(value)
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new InvalidArgumentError('Port must be an integer between 0 and 65535')
  return port
}

export async function runServerCli(args: string[]): Promise<number> {
  let accountPool: pg.Pool | undefined
  let mailer: ReturnType<typeof nodemailer.createTransport> | undefined
  const program = new Command('arcadia server')
    .description('Single-process battle server. Rooms and sessions expire when this process stops.')
    .exitOverride()
    .option('-p, --port <number>', 'HTTP and Socket.IO port', portNumber, portNumber(process.env.PORT || '8102'))
    .option('--host <address>', 'Listen address', process.env.HOST || '0.0.0.0')
    .option('--server-id <id>', 'Stable identity of this server', process.env.SERVER_ID || 'arcadia-local')
    .option(
      '--cors-origin <origins>',
      'Allowed browser origins, separated by commas',
      process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173',
    )
  try {
    await program.parseAsync(args, { from: 'user' })
    const options = program.opts<{ port: number; host: string; serverId: string; corsOrigin: string }>()
    const corsOrigins = options.corsOrigin
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
    const accountMode = process.env.ACCOUNT_MODE
    if (accountMode && accountMode !== 'guest' && accountMode !== 'g3')
      throw new Error('ACCOUNT_MODE must be guest or g3')
    const accountKeys = [
      'DATABASE_URL',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_FROM',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'OIDC_ISSUER',
      'OIDC_CLIENT_ID',
      'OIDC_CLIENT_SECRET',
      'OIDC_CLIENT_AUTH_METHOD',
      'OIDC_REDIRECT_URI',
    ]
    const hasAccountConfig = accountKeys.some(key => !!process.env[key])
    if (accountMode === 'guest' && hasAccountConfig)
      throw new Error('ACCOUNT_MODE=guest cannot be combined with account provider configuration')
    if (accountMode !== 'g3' && hasAccountConfig)
      throw new Error('Set ACCOUNT_MODE=g3 when configuring durable accounts')
    let accounts: G3AccountServices | undefined
    if (accountMode === 'g3') {
      const configuredId =
        !!process.env.SERVER_ID || args.some(arg => arg === '--server-id' || arg.startsWith('--server-id='))
      if (!configuredId) throw new Error('G3 accounts require an explicit stable SERVER_ID or --server-id')
      if (corsOrigins.includes('*')) throw new Error('G3 accounts require explicit CORS origins')
      const required = (key: string) => {
        const value = process.env[key]?.trim()
        if (!value) throw new Error(`${key} is required for G3 accounts`)
        return value
      }
      const databaseUrl = required('DATABASE_URL')
      const smtpHost = required('SMTP_HOST')
      const smtpFrom = required('SMTP_FROM')
      const issuer = required('OIDC_ISSUER')
      const clientId = required('OIDC_CLIENT_ID')
      const redirectUri = required('OIDC_REDIRECT_URI')
      const redirectOrigin = new URL(redirectUri).origin
      if (!corsOrigins.includes(redirectOrigin)) throw new Error('OIDC_REDIRECT_URI origin must appear in CORS_ORIGIN')
      const smtpPort = portNumber(process.env.SMTP_PORT ?? '587')
      if (smtpPort === 0) throw new Error('SMTP_PORT must be between 1 and 65535')
      const smtpUser = process.env.SMTP_USER
      const smtpPassword = process.env.SMTP_PASSWORD
      if (!!smtpUser !== !!smtpPassword) throw new Error('SMTP_USER and SMTP_PASSWORD must both be set or both absent')
      const clientAuthMethod = process.env.OIDC_CLIENT_AUTH_METHOD
      if (
        clientAuthMethod &&
        clientAuthMethod !== 'client_secret_post' &&
        clientAuthMethod !== 'client_secret_basic' &&
        clientAuthMethod !== 'none'
      )
        throw new Error('OIDC_CLIENT_AUTH_METHOD must be client_secret_post, client_secret_basic, or none')
      const verifiedClientAuthMethod = clientAuthMethod as
        | 'client_secret_post'
        | 'client_secret_basic'
        | 'none'
        | undefined
      accountPool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 })
      mailer = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        requireTLS: smtpPort !== 465,
        ...(smtpUser && smtpPassword ? { auth: { user: smtpUser, pass: smtpPassword } } : {}),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      })
      const smtp = mailer
      const pool = accountPool
      const email = new EmailCodeVerifier({
        sendCode: async (address, code) => {
          await smtp.sendMail({
            from: smtpFrom,
            to: address,
            subject: 'Arcadia Eternity sign-in code',
            text: `Your Arcadia Eternity sign-in code is ${code}. It expires in 10 minutes.`,
          })
        },
      })
      const oidc = await OidcVerifier.create({
        issuer,
        clientId,
        clientSecret: process.env.OIDC_CLIENT_SECRET,
        clientAuthMethod: verifiedClientAuthMethod,
        redirectUri,
      })
      accounts = {
        directory: new PgAccountDirectory(pool, options.serverId),
        email,
        oidc,
        ready: async () => {
          await ensureAccountSchema(pool)
          await smtp.verify()
        },
      }
    }
    const server = createSingleProcessApp({
      port: options.port,
      host: options.host,
      serverId: options.serverId,
      corsOrigins,
      accounts,
    })
    await server.start()
    let closing = false
    const stop = () => {
      if (closing) return
      closing = true
      console.log('Stopping server; all rooms and sessions are being discarded.')
      void server
        .stop()
        .catch(error => {
          console.error(error instanceof Error ? error.message : error)
          process.exitCode = 1
        })
        .finally(async () => {
          mailer?.close()
          await accountPool?.end()
          process.removeListener('SIGINT', stop)
          process.removeListener('SIGTERM', stop)
        })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    const address = server.httpServer.address()
    console.log(
      `Battle server ${options.serverId} listening on port ${typeof address === 'object' ? address?.port : options.port}`,
    )
    console.log('Rooms and sessions are held in memory. Restarting abandons all rooms.')
    return 0
  } catch (error) {
    mailer?.close()
    await accountPool?.end()
    if (error instanceof CommanderError && error.exitCode === 0) return 0
    console.error(error instanceof Error ? error.message : error)
    return 1
  }
}
