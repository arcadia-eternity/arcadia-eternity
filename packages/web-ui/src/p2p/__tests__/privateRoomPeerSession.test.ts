import { describe, expect, test } from 'vitest'
import {
  closePrivateRoomPeerSession,
  createInitialPrivateRoomPeerSessionState,
  markPrivateRoomPeerConnected,
  markPrivateRoomPeerFailed,
  markPrivateRoomPeerReady,
  preparePrivateRoomPeerSession,
  pushPrivateRoomPeerSignal,
} from '../privateRoomPeerSession'
import type { PrivateRoomBattleStartInfo, PrivateRoomInfo, PrivateRoomPeerSignalEvent } from '@arcadia-eternity/protocol'

const room: PrivateRoomInfo = {
  id: 'room-1',
  config: {
    roomCode: 'ROOM01',
    hostPlayerId: 'host',
    ruleSetId: 'casual_standard_ruleset',
    maxPlayers: 2,
    isPrivate: false,
    battleMode: 'p2p',
  },
  players: [
    {
      playerId: 'host',
      playerName: 'Host',
      sessionId: 'host-session',
      isReady: true,
      joinedAt: 1,
    },
    {
      playerId: 'guest',
      playerName: 'Guest',
      sessionId: 'guest-session',
      isReady: true,
      joinedAt: 2,
    },
  ],
  spectators: [],
  status: 'started',
  createdAt: 1,
  lastActivity: 2,
}

const startInfo: PrivateRoomBattleStartInfo = {
  battleMode: 'p2p',
  battleHost: {
    playerId: 'host',
    sessionId: 'host-session',
  },
}

describe('privateRoomPeerSession', () => {
  test('prepares host session against the other player', () => {
    const state = preparePrivateRoomPeerSession(room, 'host', startInfo)
    expect(state.role).toBe('host')
    expect(state.phase).toBe('signaling')
    expect(state.remotePeer).toEqual({
      playerId: 'guest',
      sessionId: 'guest-session',
    })
  })

  test('queues remote signals and tracks last signal kind', () => {
    const initial = preparePrivateRoomPeerSession(room, 'guest', startInfo)
    const signalEvent: PrivateRoomPeerSignalEvent = {
      roomCode: 'ROOM01',
      from: {
        playerId: 'host',
        sessionId: 'host-session',
      },
      to: {
        playerId: 'guest',
        sessionId: 'guest-session',
      },
      signal: {
        transport: 'webrtc',
        kind: 'offer',
        payload: { sdp: 'offer' },
      },
      timestamp: 1,
    }

    const next = pushPrivateRoomPeerSignal(initial, signalEvent)
    expect(next.pendingRemoteSignals).toHaveLength(1)
    expect(next.lastSignalKind).toBe('offer')
    expect(next.transport).toBe('webrtc')
  })

  test('moves through ready connected failed and closed states', () => {
    const initial = createInitialPrivateRoomPeerSessionState()
    const ready = markPrivateRoomPeerReady(initial, 'webtransport')
    const connected = markPrivateRoomPeerConnected(ready)
    const failed = markPrivateRoomPeerFailed(connected, 'dial timeout')
    const closed = closePrivateRoomPeerSession()

    expect(ready.phase).toBe('signaling')
    expect(ready.lastSignalKind).toBe('ready')
    expect(connected.phase).toBe('connected')
    expect(failed.phase).toBe('failed')
    expect(failed.error).toBe('dial timeout')
    expect(closed.phase).toBe('closed')
  })
})
