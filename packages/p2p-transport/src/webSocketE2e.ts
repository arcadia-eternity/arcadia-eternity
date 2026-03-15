import type { InMemoryP2PE2EResult } from './e2e'
import {
  closePrivateRoomPeerSession,
  markPrivateRoomPeerConnected,
  markPrivateRoomPeerFailed,
  preparePrivateRoomPeerSession,
  type PrivateRoomPeerSessionState,
} from './privateRoomPeerSession'
import { WebSocketPeerTransport } from './webSocketPeerTransport'
import { WebSocketRelayServer } from './webSocketRelayServer'

async function waitForCondition(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 1_000
  const intervalMs = options.intervalMs ?? 10
  const startedAt = Date.now()

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for websocket roundtrip messages')
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

export async function runWebSocketP2PE2E(rounds = 3): Promise<InMemoryP2PE2EResult> {
  if (!Number.isFinite(rounds) || rounds <= 0) {
    throw new Error(`Invalid rounds: ${rounds}`)
  }

  const relayServer = new WebSocketRelayServer()
  const url = await relayServer.start()

  const room = {
    id: 'ws-room',
    config: {
      roomCode: 'WS001',
      hostPlayerId: 'host',
      ruleSetId: 'casual_standard_ruleset',
      maxPlayers: 2,
      isPrivate: false,
      battleMode: 'p2p' as const,
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
        playerId: 'peer',
        playerName: 'Peer',
        sessionId: 'peer-session',
        isReady: true,
        joinedAt: 2,
      },
    ],
    spectators: [],
    status: 'started' as const,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }

  const startInfo = {
    battleMode: 'p2p' as const,
    battleHost: {
      playerId: 'host',
      sessionId: 'host-session',
    },
  }

  let hostSession: PrivateRoomPeerSessionState = preparePrivateRoomPeerSession(room, 'host', startInfo)
  let peerSession: PrivateRoomPeerSessionState = preparePrivateRoomPeerSession(room, 'peer', startInfo)

  const hostTransport = new WebSocketPeerTransport({ url, roomId: room.id, peerId: 'host' })
  const peerTransport = new WebSocketPeerTransport({ url, roomId: room.id, peerId: 'peer' })

  const hostReceived: Array<{ type: string; payload: unknown }> = []
  const peerReceived: Array<{ type: string; payload: unknown }> = []
  hostTransport.onMessage(message => hostReceived.push(message))
  peerTransport.onMessage(message => peerReceived.push(message))
  hostTransport.onStateChange(state => {
    if (state === 'connected') hostSession = markPrivateRoomPeerConnected(hostSession)
    if (state === 'failed') hostSession = markPrivateRoomPeerFailed(hostSession, 'host websocket transport failed')
    if (state === 'closed') hostSession = closePrivateRoomPeerSession()
  })
  peerTransport.onStateChange(state => {
    if (state === 'connected') peerSession = markPrivateRoomPeerConnected(peerSession)
    if (state === 'failed') peerSession = markPrivateRoomPeerFailed(peerSession, 'peer websocket transport failed')
    if (state === 'closed') peerSession = closePrivateRoomPeerSession()
  })

  await hostTransport.connect({ role: 'host', remotePeerId: 'peer' })
  await peerTransport.connect({ role: 'peer', remotePeerId: 'host' })

  for (let i = 1; i <= rounds; i++) {
    await hostTransport.send({ type: 'battle-action', payload: { round: i, actor: 'host' } })
    await peerTransport.send({ type: 'battle-ack', payload: { round: i, actor: 'peer' } })
  }

  await waitForCondition(() => hostReceived.length === rounds && peerReceived.length === rounds)

  const hostPhase = hostSession.phase
  const peerPhase = peerSession.phase

  await hostTransport.close()
  await peerTransport.close()
  await relayServer.stop()

  return {
    hostPhase,
    peerPhase,
    hostSignals: [],
    peerSignals: [],
    hostReceived,
    peerReceived,
  }
}
