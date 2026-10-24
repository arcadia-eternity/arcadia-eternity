/** Client-owned, unverified profile data. Its ID never grants server permissions. */
export interface LocalProfile {
  id: string
  name: string
}

export type ServerPrincipal = { kind: 'guest'; guestId: string } | { kind: 'account'; accountId: string }

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
