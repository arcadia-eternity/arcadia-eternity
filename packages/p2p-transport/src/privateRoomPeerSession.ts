import type {
  PrivateRoomBattleStartInfo,
  PrivateRoomInfo,
  PrivateRoomPeerEndpoint,
  PrivateRoomPeerSignalEvent,
  PrivateRoomPeerSignalPayload,
} from './types'

export type PrivateRoomPeerRole = 'none' | 'host' | 'peer' | 'spectator'
export type PrivateRoomPeerPhase = 'idle' | 'awaiting-start' | 'signaling' | 'connected' | 'closed' | 'failed'

export type { PrivateRoomPeerEndpoint } from './types'

export interface PrivateRoomPeerSessionState {
  role: PrivateRoomPeerRole
  phase: PrivateRoomPeerPhase
  transport?: PrivateRoomPeerSignalPayload['transport']
  roomCode?: string
  battleHost?: PrivateRoomPeerEndpoint
  remotePeer?: PrivateRoomPeerEndpoint
  lastSignalKind?: PrivateRoomPeerSignalPayload['kind']
  pendingRemoteSignals: PrivateRoomPeerSignalEvent[]
  error?: string
}

export const createInitialPrivateRoomPeerSessionState = (): PrivateRoomPeerSessionState => ({
  role: 'none',
  phase: 'idle',
  pendingRemoteSignals: [],
})

const cloneState = (state: PrivateRoomPeerSessionState): PrivateRoomPeerSessionState => ({
  ...state,
  pendingRemoteSignals: [...state.pendingRemoteSignals],
})

const getPrimaryRemotePeer = (
  room: PrivateRoomInfo,
  selfPlayerId: string,
): PrivateRoomPeerEndpoint | undefined => {
  const otherPlayer = room.players.find(player => player.playerId !== selfPlayerId)
  if (otherPlayer) {
    return {
      playerId: otherPlayer.playerId,
      sessionId: otherPlayer.sessionId,
    }
  }

  return undefined
}

export function preparePrivateRoomPeerSession(
  room: PrivateRoomInfo,
  selfPlayerId: string,
  startInfo: PrivateRoomBattleStartInfo,
): PrivateRoomPeerSessionState {
  if (startInfo.battleMode !== 'p2p') {
    return createInitialPrivateRoomPeerSessionState()
  }

  const isPlayer = room.players.some(player => player.playerId === selfPlayerId)
  const role: PrivateRoomPeerRole =
    startInfo.battleHost.playerId === selfPlayerId ? 'host' : isPlayer ? 'peer' : 'spectator'

  return {
    role,
    phase: role === 'spectator' ? 'awaiting-start' : 'signaling',
    roomCode: room.config.roomCode,
    battleHost: {
      playerId: startInfo.battleHost.playerId,
      sessionId: startInfo.battleHost.sessionId,
    },
    remotePeer: role === 'host' ? getPrimaryRemotePeer(room, selfPlayerId) : startInfo.battleHost,
    pendingRemoteSignals: [],
  }
}

export function pushPrivateRoomPeerSignal(
  current: PrivateRoomPeerSessionState,
  event: PrivateRoomPeerSignalEvent,
): PrivateRoomPeerSessionState {
  const next = cloneState(current)
  next.pendingRemoteSignals.push(event)
  next.lastSignalKind = event.signal.kind
  next.transport = event.signal.transport
  if (next.phase === 'idle' || next.phase === 'awaiting-start') {
    next.phase = 'signaling'
  }
  return next
}

export function consumePrivateRoomPeerSignals(current: PrivateRoomPeerSessionState): PrivateRoomPeerSignalEvent[] {
  const signals = [...current.pendingRemoteSignals]
  current.pendingRemoteSignals.length = 0
  return signals
}

export function markPrivateRoomPeerReady(
  current: PrivateRoomPeerSessionState,
  transport: PrivateRoomPeerSignalPayload['transport'],
): PrivateRoomPeerSessionState {
  const next = cloneState(current)
  next.transport = transport
  if (next.phase === 'idle') {
    next.phase = 'signaling'
  }
  next.lastSignalKind = 'ready'
  return next
}

export function markPrivateRoomPeerConnected(current: PrivateRoomPeerSessionState): PrivateRoomPeerSessionState {
  const next = cloneState(current)
  next.phase = 'connected'
  return next
}

export function markPrivateRoomPeerFailed(
  current: PrivateRoomPeerSessionState,
  error: string,
): PrivateRoomPeerSessionState {
  const next = cloneState(current)
  next.phase = 'failed'
  next.error = error
  return next
}

export function closePrivateRoomPeerSession(): PrivateRoomPeerSessionState {
  return {
    ...createInitialPrivateRoomPeerSessionState(),
    phase: 'closed',
  }
}
