/** Client-owned, unverified profile data. Its ID never grants server permissions. */
export interface LocalProfile {
  id: string
  name: string
}

export type ServerPrincipal = { kind: 'guest'; guestId: string } | { kind: 'account'; accountId: string }

export type AccountProviderId = 'email' | 'oidc'
export type AccountIntent = 'login' | 'link'

/** Verified by this server. A local profile ID is never an account identity. */
export interface AccountIdentity {
  providerId: string
  issuer: string
  subject: string
  verifiedAt?: number
}

export interface AccountChallengeResponse {
  challengeId: string
  expiresAt: number
}

export interface OidcAuthorizationResponse {
  authorizationUrl: string
  state: string
  /** Keep in the initiating tab; send only to the completion endpoint, never in the redirect URL. */
  browserSecret: string
  expiresAt: number
}

export interface AccountIdentityListResponse {
  identities: AccountIdentity[]
}

export interface AccountSessionResponse {
  session: ServerSession
}

/** Identity of the compiled official content and runtime used by the server. */
export interface NativeRuntimeIdentity {
  kind: 'native-v4'
  contentRevision: string
  coreBuildId: string
  registryBuildId: string
}

export interface ServerInfo {
  serverId: string
  /** Identifies the running process; sessions and rooms expire when it changes. */
  bootId: string
  authModes: ('guest' | 'account')[]
  /** Present only when the durable account directory and both verification paths are configured. */
  accountProviders?: AccountProviderId[]
  protocolVersion: 1
  runtime?: NativeRuntimeIdentity
}

export interface CreateServerSessionRequest {
  profile: LocalProfile
  accountProof?: unknown
}

/** Private response to the session owner. Never include this object in room broadcasts. */
export interface ServerSession {
  serverId: string
  bootId: string
  /** Public correlation ID, not a credential. */
  sessionId: string
  /** Server-assigned room participant and Battle player ID; unrelated to profile.id. */
  seatId: string
  token: string
  principal: ServerPrincipal
  profile: LocalProfile
  expiresAt: number
}
