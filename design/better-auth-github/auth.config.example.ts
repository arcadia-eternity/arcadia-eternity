/**
 * Isolated Better Auth configuration probe. This file is deliberately not wired
 * into the Arcadia server and must not be treated as a production config.
 *
 * It demonstrates the documented GitHub App + email OTP settings only. The
 * accompanying README explains why this cannot replace G3 auth as-is.
 */
import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'

export interface BetterAuthProbeOptions {
  databaseUrl: string
  publicBaseUrl: string
  frontendOrigin: string
  secret: string
  githubAppClientId: string
  githubAppClientSecret: string
  sendCode: (email: string, code: string) => Promise<void>
}

export function createBetterAuthProbe(options: BetterAuthProbeOptions) {
  const pool = new Pool({ connectionString: options.databaseUrl })
  const auth = betterAuth({
    appName: 'Arcadia Eternity',
    baseURL: options.publicBaseUrl,
    trustedOrigins: [options.frontendOrigin],
    secret: options.secret,
    database: {
      dialect: new PostgresDialect({ pool }),
      type: 'postgres',
      // Separate from the existing private arcadia_auth schema and Supabase auth.
      schemaName: 'arcadia_better_auth',
    },
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: options.githubAppClientId,
        clientSecret: options.githubAppClientSecret,
        // GitHub Apps use registered account permissions, not OAuth App scopes.
        // Grant "Email addresses: Read-only" in the GitHub App registration.
        disableDefaultScope: true,
      },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        disableImplicitLinking: true,
        allowDifferentEmails: true,
      },
    },
    plugins: [
      emailOTP({
        otpLength: 8,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'sign-in') throw new Error(`Unexpected OTP purpose: ${type}`)
          await options.sendCode(email, otp)
        },
      }),
    ],
  })
  return { auth, pool }
}
