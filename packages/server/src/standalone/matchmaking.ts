import type { ServerEnvironmentDescriptor, ServerSession } from '@arcadia-eternity/protocol'

/** Stable rating partition, independent of a deployment's immutable environment ID. */
export interface RatingScope {
  namespace: string
  ruleId?: string
}

export interface MatchmakingCandidate {
  seatId: string
  principal: ServerSession['principal']
  joinedAt: number
}

/** Host-only integration seam. Ratings must come from trusted storage, never client payloads. */
export interface MatchmakingPolicy {
  ratingScope?(environment: ServerEnvironmentDescriptor): RatingScope
  findMatch(
    candidates: readonly MatchmakingCandidate[],
    context: { environment: ServerEnvironmentDescriptor; ratingScope?: RatingScope; now: number; signal: AbortSignal },
  ): readonly [string, string] | null | Promise<readonly [string, string] | null>
}

export const fifoMatchmaking: MatchmakingPolicy = {
  findMatch: candidates => (candidates.length >= 2 ? [candidates[0].seatId, candidates[1].seatId] : null),
}
