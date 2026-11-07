import { afterEach, expect, it, vi } from 'vitest'
import nodemailer from 'nodemailer'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { EmailCodeVerifier, ProviderError } from '../src/standalone/providers/index.js'

// Capture the storage passed to the real adapter; Better Auth and every OTP
// operation still execute normally. This detects accidental account/session
// creation, plaintext OTP storage and orphan verification records.
vi.mock('better-auth/adapters/memory', async importOriginal => {
  const actual = await importOriginal<typeof import('better-auth/adapters/memory')>()
  return { ...actual, memoryAdapter: vi.fn(actual.memoryAdapter) }
})

afterEach(() => vi.clearAllMocks())

function verificationDatabase() {
  return vi.mocked(memoryAdapter).mock.calls.at(-1)![0]
}

type SentMail = { email: string; code: string; wire: string }

function harness(now = Date.now()) {
  const sent: SentMail[] = []
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
  let clock = now
  const verifier = new EmailCodeVerifier({
    now: () => clock,
    sendCode: async (email, code) => {
      const result = await transport.sendMail({
        from: 'Arcadia <auth@example.test>',
        to: email,
        subject: 'Your sign-in code',
        text: `Code: ${code}`,
      })
      if (!Buffer.isBuffer(result.message)) throw new Error('Expected a captured RFC 5322 message')
      sent.push({ email, code, wire: result.message.toString('utf8') })
    },
  })
  return {
    verifier,
    sent,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

it('emails a random code and consumes a purpose-bound proof exactly once', async () => {
  const { verifier, sent } = harness()
  const intent = { kind: 'login' } as const
  const { challengeId } = await verifier.begin({ email: 'Player@Example.TEST', source: '127.0.0.1', intent })
  expect(challengeId).toMatch(/^[A-Za-z0-9_-]{32}$/)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.wire).toContain('To: Player@example.test')
  expect(sent[0]?.wire).toContain(`Code: ${sent[0]?.code}`)
  expect(sent[0]?.code).toMatch(/^\d{8}$/)
  expect(JSON.stringify({ challengeId })).not.toContain(sent[0]?.code)
  const database = verificationDatabase()
  expect(database.user).toHaveLength(1)
  expect(database.verification).toHaveLength(1)
  expect(database.verification![0].value).not.toContain(sent[0]!.code)
  expect(database.account).toHaveLength(0)
  expect(database.session).toHaveLength(0)

  await expect(
    verifier.verify({ challengeId, code: sent[0]!.code, source: '127.0.0.1' }, intent),
  ).resolves.toMatchObject({ issuer: 'mailto', subject: 'Player@example.test' })
  expect(database.user).toHaveLength(0)
  expect(database.verification).toHaveLength(0)
  expect(database.session).toHaveLength(0)
  await expect(
    verifier.verify({ challengeId, code: sent[0]!.code, source: '127.0.0.1' }, intent),
  ).rejects.toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })
})

it('binds a link challenge to its account and session while allowing a changed network address', async () => {
  const { verifier, sent } = harness()
  const intent = { kind: 'link', accountId: 'acct-1', sessionId: 'session-1' } as const
  const { challengeId } = await verifier.begin({ email: 'player@example.test', source: 'source-1', intent })
  const proof = { challengeId, code: sent[0]!.code, source: 'source-1' }
  await expect(verifier.verify(proof, { kind: 'login' })).rejects.toMatchObject({ code: 'AUTH_PROOF_MISMATCH' })
  await expect(
    verifier.verify(proof, { kind: 'link', accountId: 'acct-2', sessionId: 'session-1' }),
  ).rejects.toMatchObject({ code: 'AUTH_PROOF_MISMATCH' })
  await expect(verifier.verify({ ...proof, source: 'source-2' }, intent)).resolves.toMatchObject({
    subject: 'player@example.test',
  })
})

it('expires codes and locks a challenge after five incorrect attempts', async () => {
  const { verifier, sent, advance } = harness()
  const intent = { kind: 'login' } as const
  const first = await verifier.begin({ email: 'first@example.test', source: 'source-1', intent })
  advance(10 * 60 * 1000)
  await expect(
    verifier.verify({ challengeId: first.challengeId, code: sent[0]!.code, source: 'source-1' }, intent),
  ).rejects.toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })
  expect(verificationDatabase().user).toHaveLength(0)
  expect(verificationDatabase().verification).toHaveLength(0)

  const second = await verifier.begin({ email: 'second@example.test', source: 'source-1', intent })
  const wrong = sent[1]!.code === '00000000' ? '11111111' : '00000000'
  for (let i = 0; i < 5; i++) {
    await expect(
      verifier.verify({ challengeId: second.challengeId, code: wrong, source: 'source-1' }, intent),
    ).rejects.toMatchObject({ code: 'AUTH_PROOF_INVALID' })
  }
  await expect(
    verifier.verify({ challengeId: second.challengeId, code: sent[1]!.code, source: 'source-1' }, intent),
  ).rejects.toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })
  expect(verificationDatabase().user).toHaveLength(0)
  expect(verificationDatabase().verification).toHaveLength(0)
})

it('limits repeated sends to the same mailbox and rejects invalid addresses', async () => {
  const { verifier, sent } = harness()
  const intent = { kind: 'login' } as const
  for (let i = 0; i < 3; i++) {
    await verifier.begin({ email: 'user@example.test', source: `source-${i}`, intent })
  }
  await expect(verifier.begin({ email: 'user@EXAMPLE.TEST', source: 'source-4', intent })).rejects.toMatchObject({
    code: 'AUTH_RATE_LIMITED',
    statusCode: 429,
  })
  expect(sent).toHaveLength(3)
  for (const email of ['not-an-email', 'user@@example.test', ' user@example.test', 'user@example.test\n']) {
    await expect(verifier.begin({ email, source: 'source-5', intent })).rejects.toBeInstanceOf(ProviderError)
  }
})

it('limits sends from one network source across distinct mailboxes', async () => {
  const verifier = new EmailCodeVerifier({ sendCode: async () => {} })
  const intent = { kind: 'login' } as const
  for (let i = 0; i < 3; i++) {
    await verifier.begin({ email: 'same@example.test', source: 'shared-source', intent })
  }
  await expect(verifier.begin({ email: 'same@example.test', source: 'shared-source', intent })).rejects.toMatchObject({
    code: 'AUTH_RATE_LIMITED',
  })
  // A rejected mailbox request must not spend the source's quota for other users behind a proxy.
  for (let i = 0; i < 117; i++) {
    await verifier.begin({ email: `user${i}@example.test`, source: 'shared-source', intent })
  }
  await expect(verifier.begin({ email: 'last@example.test', source: 'shared-source', intent })).rejects.toMatchObject({
    code: 'AUTH_RATE_LIMITED',
    statusCode: 429,
  })
})

it('fails closed when mail delivery fails', async () => {
  const verifier = new EmailCodeVerifier({
    sendCode: async () => {
      throw new Error('secret SMTP detail')
    },
  })
  await expect(
    verifier.begin({ email: 'user@example.test', source: 'source', intent: { kind: 'login' } }),
  ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED', statusCode: 503 })
  expect(verificationDatabase().user).toHaveLength(0)
  expect(verificationDatabase().verification).toHaveLength(0)
})

it('keeps login and link OTPs independent for the same mailbox', async () => {
  const { verifier, sent } = harness()
  const login = { kind: 'login' } as const
  const link = { kind: 'link', accountId: 'account', sessionId: 'session' } as const
  const first = await verifier.begin({ email: 'Player@example.test', source: 'source', intent: login })
  const second = await verifier.begin({ email: 'Player@example.test', source: 'source', intent: link })
  expect(verificationDatabase().user).toHaveLength(2)
  expect(verificationDatabase().verification).toHaveLength(2)
  await expect(
    verifier.verify({ challengeId: first.challengeId, code: sent[0]!.code, source: 'source' }, login),
  ).resolves.toMatchObject({ subject: 'Player@example.test' })
  await expect(
    verifier.verify({ challengeId: second.challengeId, code: sent[1]!.code, source: 'source' }, link),
  ).resolves.toMatchObject({ subject: 'Player@example.test' })
  expect(verificationDatabase().user).toHaveLength(0)
  expect(verificationDatabase().verification).toHaveLength(0)
})

it('accepts only one of simultaneous valid submissions and does not issue Better Auth sessions', async () => {
  const { verifier, sent } = harness()
  const intent = { kind: 'login' } as const
  const challenge = await verifier.begin({ email: 'user@example.test', source: 'source', intent })
  const proof = { challengeId: challenge.challengeId, code: sent[0]!.code, source: 'source' }
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => verifier.verify(proof, intent)))
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  for (const result of results) {
    if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })
  }
  expect(verificationDatabase().user).toHaveLength(0)
  expect(verificationDatabase().verification).toHaveLength(0)
  expect(verificationDatabase().session).toHaveLength(0)
})

it('serializes wrong-code retries so concurrent requests cannot reset the Better Auth attempt limit', async () => {
  const { verifier, sent } = harness()
  const intent = { kind: 'login' } as const
  const challenge = await verifier.begin({ email: 'user@example.test', source: 'source', intent })
  const wrong = sent[0]!.code === '00000000' ? '11111111' : '00000000'
  const results = await Promise.allSettled([
    ...Array.from({ length: 5 }, () =>
      verifier.verify({ challengeId: challenge.challengeId, code: wrong, source: 'source' }, intent),
    ),
    verifier.verify({ challengeId: challenge.challengeId, code: sent[0]!.code, source: 'source' }, intent),
  ])
  for (const result of results.slice(0, 5)) {
    expect(result.status).toBe('rejected')
    if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'AUTH_PROOF_INVALID' })
  }
  expect(results[5]).toMatchObject({ status: 'rejected', reason: { code: 'AUTH_PROOF_EXPIRED' } })
  expect(verificationDatabase().user).toHaveLength(0)
  expect(verificationDatabase().verification).toHaveLength(0)
})

it('reclaims temporary Better Auth data when a challenge expires during mail delivery', async () => {
  let now = Date.now()
  const verifier = new EmailCodeVerifier({
    now: () => now,
    challengeTtlMs: 100,
    sendCode: async () => {
      now += 100
    },
  })
  await expect(
    verifier.begin({ email: 'user@example.test', source: 'source', intent: { kind: 'login' } }),
  ).rejects.toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })
  expect(verificationDatabase().user).toHaveLength(0)
  expect(verificationDatabase().verification).toHaveLength(0)
})

it('limits proof submissions from a network source even for already consumed challenges', async () => {
  const { verifier, sent } = harness()
  const intent = { kind: 'login' } as const
  const challenge = await verifier.begin({ email: 'user@example.test', source: 'source', intent })
  const proof = { challengeId: challenge.challengeId, code: sent[0]!.code, source: 'source' }
  await verifier.verify(proof, intent)
  for (let index = 1; index < 600; index++) {
    await expect(verifier.verify(proof, intent)).rejects.toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })
  }
  await expect(verifier.verify(proof, intent)).rejects.toMatchObject({ code: 'AUTH_RATE_LIMITED', statusCode: 429 })
})
