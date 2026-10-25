import { createHmac, randomBytes } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { emailOTP } from 'better-auth/plugins'

/**
 * Better Auth owns OTP generation, hashed storage, attempt counting and atomic
 * consumption. Its users here are temporary verification records, never Arcadia
 * accounts. No handler or Better Auth session is exposed to a client.
 */
export class BetterAuthEmailProofs {
  private readonly database: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  }
  private readonly auth

  constructor(ttlMs: number) {
    const digestKey = randomBytes(32)
    this.auth = betterAuth({
      baseURL: 'http://localhost',
      secret: randomBytes(32).toString('base64url'),
      database: memoryAdapter(this.database),
      logger: { disabled: true },
      telemetry: { enabled: false },
      emailAndPassword: { enabled: false },
      emailVerification: { autoSignInAfterVerification: false },
      plugins: [
        emailOTP({
          otpLength: 8,
          expiresIn: Math.ceil(ttlMs / 1000),
          allowedAttempts: 5,
          // Better Auth invokes this hook for both storage and comparison. A
          // process-only key protects eight-digit OTPs from offline guessing.
          storeOTP: { hash: async otp => createHmac('sha256', digestKey).update(otp).digest('hex') },
          // Only createVerificationOTP is used; delivery belongs to the host.
          sendVerificationOTP: async () => {
            throw new Error('Use the purpose-bound Arcadia email challenge')
          },
        }),
      ],
    })
    // Initialization starts in the constructor. Startup and create() still
    // await the rejecting promise, but an early failure must not be unhandled.
    void this.auth.$context.catch(() => {})
  }

  async ready(): Promise<void> {
    await this.auth.$context
  }

  async create(challengeId: string): Promise<string> {
    const email = verificationEmail(challengeId)
    const context = await this.auth.$context
    await context.internalAdapter.createUser(
      { email, emailVerified: false, name: 'Email verification' },
      { method: 'email-otp' },
    )
    return this.auth.api.createVerificationOTP({ body: { email, type: 'email-verification' } })
  }

  async verify(challengeId: string, otp: string): Promise<void> {
    const proof = await this.auth.api.verifyEmailOTP({ body: { email: verificationEmail(challengeId), otp } })
    if (!proof.status || proof.token !== null || !proof.user.emailVerified)
      throw new Error('Email verification must not issue a Better Auth session')
  }

  /** Called only after this challenge's in-flight operations have settled. */
  discard(challengeId: string): void {
    const email = verificationEmail(challengeId)
    this.database.user = this.database.user!.filter(row => row.email !== email)
    // The pinned OTP plugin keys verification records by type and email. Match
    // the unique internal address, without sharing state with another intent.
    this.database.verification = this.database.verification!.filter(
      row => typeof row.identifier !== 'string' || !row.identifier.endsWith(`-${email}`),
    )
  }
}

function verificationEmail(challengeId: string): string {
  // Better Auth folds emails to lowercase. This internal address is a challenge
  // namespace, not a mailbox: the real recipient and its case stay in Arcadia.
  return `${Buffer.from(challengeId, 'base64url').toString('hex')}@email-proof.invalid`
}

export function betterAuthEmailError(error: unknown): 'invalid' | 'expired' | 'unavailable' {
  if (typeof error !== 'object' || error === null || !('body' in error)) return 'unavailable'
  const body = error.body
  if (typeof body !== 'object' || body === null || !('code' in body)) return 'unavailable'
  if (body.code === 'INVALID_OTP') return 'invalid'
  if (body.code === 'OTP_EXPIRED' || body.code === 'TOO_MANY_ATTEMPTS') return 'expired'
  return 'unavailable'
}
