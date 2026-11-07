import { randomBytes } from 'node:crypto'
import { ProviderError, sameIntent, validIntent, type AuthIntent, type VerifiedIdentity } from './types.js'
import { BetterAuthEmailProofs, betterAuthEmailError } from './betterAuthEmail.js'

export interface EmailCodeVerifierOptions {
  /** Only this callback handles delivery. The code is never returned to the caller of begin(). */
  sendCode: (email: string, code: string) => Promise<void>
  providerId?: string
  issuer?: string
  challengeTtlMs?: number
  now?: () => number
}

interface EmailChallenge {
  email: string
  intent: AuthIntent
  expiresAt: number
  /** Serializes verification and disposal with the initial delivery. */
  pending: Promise<void>
}

const EMAIL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const DOMAIN_PART =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const RATE_WINDOW_MS = 60 * 60 * 1000
const MAX_ADDRESS_CHALLENGES = 3
const MAX_SOURCE_CHALLENGES = 120
const MAX_SOURCE_VERIFICATIONS = 600
const MAX_PENDING = 10_000
const MAX_RATE_KEYS = 50_000

/** ASCII dot-atom mailboxes only. The local part retains case; only DNS names are folded. */
export function normalizeEmail(value: string): string {
  if (typeof value !== 'string' || value.length > 254 || value.trim() !== value)
    throw new ProviderError('INVALID_EMAIL', 400)
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) throw new ProviderError('INVALID_EMAIL', 400)
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (local.length > 64 || !EMAIL_PART.test(local) || !DOMAIN_PART.test(domain))
    throw new ProviderError('INVALID_EMAIL', 400)
  return `${local}@${domain.toLowerCase()}`
}

/** In-memory, purpose-bound email proof. A restart invalidates outstanding challenges. */
export class EmailCodeVerifier {
  readonly providerId: string
  readonly issuer: string
  private readonly sendCode: EmailCodeVerifierOptions['sendCode']
  private readonly challengeTtlMs: number
  private readonly now: () => number
  private readonly proofs: BetterAuthEmailProofs
  private readonly challenges = new Map<string, EmailChallenge>()
  private readonly addressBegins = new Map<string, number[]>()
  private readonly sourceBegins = new Map<string, number[]>()
  private readonly sourceVerifications = new Map<string, number[]>()
  private beginCount = 0

  constructor(options: EmailCodeVerifierOptions) {
    if (typeof options.sendCode !== 'function') throw new Error('sendCode must be configured')
    this.sendCode = options.sendCode
    this.providerId = options.providerId ?? 'email'
    this.issuer = options.issuer ?? 'mailto'
    this.challengeTtlMs = options.challengeTtlMs ?? 10 * 60 * 1000
    this.now = options.now ?? Date.now
    if (!this.providerId || !this.issuer || !Number.isSafeInteger(this.challengeTtlMs) || this.challengeTtlMs <= 0)
      throw new Error('Invalid email provider configuration')
    this.proofs = new BetterAuthEmailProofs(this.challengeTtlMs)
  }

  async ready(): Promise<void> {
    await this.proofs.ready()
  }

  async begin({ email: value, source, intent }: { email: string; source: string; intent: AuthIntent }): Promise<{
    challengeId: string
    expiresAt: number
  }> {
    const email = normalizeEmail(value)
    if (!validSource(source) || !validIntent(intent)) throw new ProviderError('INVALID_AUTH_REQUEST', 400)
    const now = this.now()
    if (++this.beginCount % 128 === 0 || this.challenges.size >= MAX_PENDING) this.cleanup(now)
    if (this.challenges.size >= MAX_PENDING) throw new ProviderError('AUTH_CAPACITY', 503)
    const sourceTimes = this.checkRate(this.sourceBegins, source, MAX_SOURCE_CHALLENGES, now)
    const addressTimes = this.checkRate(this.addressBegins, email, MAX_ADDRESS_CHALLENGES, now)
    this.sourceBegins.set(source, [...sourceTimes, now])
    this.addressBegins.set(email, [...addressTimes, now])

    const challengeId = randomBytes(24).toString('base64url')
    const expiresAt = now + this.challengeTtlMs
    let release!: () => void
    const challenge: EmailChallenge = {
      email,
      intent: structuredClone(intent),
      expiresAt,
      pending: new Promise<void>(resolve => {
        release = resolve
      }),
    }
    this.challenges.set(challengeId, challenge)
    try {
      let code: string
      try {
        code = await this.proofs.create(challengeId)
      } catch {
        throw new ProviderError('PROVIDER_UNAVAILABLE', 503)
      }
      this.assertLive(challengeId, challenge)
      try {
        await this.sendCode(email, code)
      } catch {
        throw new ProviderError('EMAIL_DELIVERY_FAILED', 503)
      }
      this.assertLive(challengeId, challenge)
      return { challengeId, expiresAt }
    } catch (error) {
      this.remove(challengeId, challenge)
      throw error
    } finally {
      release()
    }
  }

  async verify(
    { challengeId, code, source }: { challengeId: string; code: string; source: string },
    intent: AuthIntent,
  ): Promise<VerifiedIdentity> {
    if (
      !validSource(source) ||
      !validIntent(intent) ||
      typeof challengeId !== 'string' ||
      !/^[A-Za-z0-9_-]{32}$/.test(challengeId) ||
      typeof code !== 'string' ||
      !/^\d{8}$/.test(code)
    )
      throw new ProviderError('INVALID_AUTH_PROOF', 400)
    const now = this.now()
    this.recordRate(this.sourceVerifications, source, MAX_SOURCE_VERIFICATIONS, now)
    const challenge = this.challenges.get(challengeId)
    if (!challenge || challenge.expiresAt <= now) {
      if (challenge) this.remove(challengeId, challenge)
      throw new ProviderError('AUTH_PROOF_EXPIRED', 401)
    }
    if (!sameIntent(challenge.intent, intent)) throw new ProviderError('AUTH_PROOF_MISMATCH', 401)
    const previous = challenge.pending
    let release!: () => void
    challenge.pending = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      this.assertLive(challengeId, challenge)
      try {
        await this.proofs.verify(challengeId, code)
      } catch (error) {
        this.assertLive(challengeId, challenge)
        const result = betterAuthEmailError(error)
        if (result === 'invalid') throw new ProviderError('AUTH_PROOF_INVALID', 401)
        this.remove(challengeId, challenge)
        if (result === 'expired') throw new ProviderError('AUTH_PROOF_EXPIRED', 401)
        throw new ProviderError('PROVIDER_UNAVAILABLE', 503)
      }
      this.assertLive(challengeId, challenge)
      this.remove(challengeId, challenge)
      return { issuer: this.issuer, subject: challenge.email, verifiedAt: this.now() }
    } finally {
      release()
    }
  }

  private assertLive(challengeId: string, challenge: EmailChallenge): void {
    if (this.challenges.get(challengeId) === challenge && challenge.expiresAt > this.now()) return
    this.remove(challengeId, challenge)
    throw new ProviderError('AUTH_PROOF_EXPIRED', 401)
  }

  private remove(challengeId: string, challenge: EmailChallenge): void {
    if (this.challenges.get(challengeId) === challenge) this.challenges.delete(challengeId)
    // A wrong-code attempt may recreate the OTP record. Dispose only once all
    // queued attempts/creation finish so no orphan record can be recreated.
    void challenge.pending.then(() => this.proofs.discard(challengeId))
  }

  private recordRate(map: Map<string, number[]>, key: string, limit: number, now: number): void {
    const recent = this.checkRate(map, key, limit, now)
    map.set(key, [...recent, now])
  }

  private checkRate(map: Map<string, number[]>, key: string, limit: number, now: number): number[] {
    const recent = (map.get(key) ?? []).filter(time => time > now - RATE_WINDOW_MS)
    if (recent.length >= limit) throw new ProviderError('AUTH_RATE_LIMITED', 429)
    if (!map.has(key) && map.size >= MAX_RATE_KEYS) this.cleanup(now)
    if (!map.has(key) && map.size >= MAX_RATE_KEYS) throw new ProviderError('AUTH_CAPACITY', 503)
    return recent
  }

  private cleanup(now: number): void {
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.remove(id, challenge)
    }
    for (const map of [this.addressBegins, this.sourceBegins, this.sourceVerifications]) {
      for (const [key, times] of map) {
        const recent = times.filter(time => time > now - RATE_WINDOW_MS)
        if (recent.length) map.set(key, recent)
        else map.delete(key)
      }
    }
  }
}

function validSource(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}
