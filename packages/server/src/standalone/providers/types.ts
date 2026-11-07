/** The intent is derived from the server's current authenticated session, never from a claimed account ID. */
export type AuthIntent = { kind: 'login' } | { kind: 'link'; accountId: string; sessionId: string }

/** A provider proves control of an external identity; it cannot choose a server account. */
export interface VerifiedIdentity {
  issuer: string
  subject: string
  verifiedAt: number
}

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(code)
    this.name = 'ProviderError'
  }
}

export function sameIntent(left: AuthIntent, right: AuthIntent): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'login' ||
      (right.kind === 'link' && left.accountId === right.accountId && left.sessionId === right.sessionId))
  )
}

export function validIntent(intent: unknown): intent is AuthIntent {
  if (typeof intent !== 'object' || intent === null) return false
  const value = intent as Record<string, unknown>
  return (
    value.kind === 'login' ||
    (value.kind === 'link' &&
      typeof value.accountId === 'string' &&
      value.accountId.length > 0 &&
      typeof value.sessionId === 'string' &&
      value.sessionId.length > 0)
  )
}
