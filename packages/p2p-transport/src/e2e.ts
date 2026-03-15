import {
  type PrivateRoomBattleStartInfo,
  type PrivateRoomInfo,
  type PrivateRoomPeerSignalPayload,
} from './types'
import { InMemoryPeerTransport } from './inMemoryPeerTransport'
import { createPrivateRoomSignalBridge } from './privateRoomSignalBridge'
import {
  closePrivateRoomPeerSession,
  markPrivateRoomPeerConnected,
  markPrivateRoomPeerFailed,
  preparePrivateRoomPeerSession,
  type PrivateRoomPeerSessionState,
} from './privateRoomPeerSession'

export interface InMemoryP2PE2ERoundtripMessage {
  type: string
  payload: unknown
}

export interface InMemoryP2PE2EResult {
  hostPhase: string
  peerPhase: string
  hostSignals: PrivateRoomPeerSignalPayload[]
  peerSignals: PrivateRoomPeerSignalPayload[]
  hostReceived: InMemoryP2PE2ERoundtripMessage[]
  peerReceived: InMemoryP2PE2ERoundtripMessage[]
}

function createFixtureRoom(): PrivateRoomInfo {
  return {
    id: 'cli-room',
    config: {
      roomCode: 'CLI001',
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
        playerId: 'peer',
        playerName: 'Peer',
        sessionId: 'peer-session',
        isReady: true,
        joinedAt: 2,
      },
    ],
    spectators: [],
    status: 'started',
    createdAt: Date.now(),
    lastActivity: Date.now(),
  }
}

function createFixtureStartInfo(): PrivateRoomBattleStartInfo {
  return {
    battleMode: 'p2p',
    battleHost: {
      playerId: 'host',
      sessionId: 'host-session',
    },
  }
}

export async function runInMemoryP2PE2E(rounds = 3): Promise<InMemoryP2PE2EResult> {
  if (!Number.isFinite(rounds) || rounds <= 0) {
    throw new Error(`Invalid rounds: ${rounds}`)
  }

  const room = createFixtureRoom()
  const startInfo = createFixtureStartInfo()

  let hostSession: PrivateRoomPeerSessionState = preparePrivateRoomPeerSession(room, 'host', startInfo)
  let peerSession: PrivateRoomPeerSessionState = preparePrivateRoomPeerSession(room, 'peer', startInfo)

  const hostTransport = new InMemoryPeerTransport()
  const peerTransport = new InMemoryPeerTransport()
  hostTransport.pairWith(peerTransport)
  peerTransport.pairWith(hostTransport)

  const hostSignals: PrivateRoomPeerSignalPayload[] = []
  const peerSignals: PrivateRoomPeerSignalPayload[] = []
  const hostReceived: InMemoryP2PE2ERoundtripMessage[] = []
  const peerReceived: InMemoryP2PE2ERoundtripMessage[] = []

  hostTransport.onMessage(message => hostReceived.push(message))
  peerTransport.onMessage(message => peerReceived.push(message))
  hostTransport.onStateChange(state => {
    if (state === 'connected') hostSession = markPrivateRoomPeerConnected(hostSession)
    if (state === 'failed') hostSession = markPrivateRoomPeerFailed(hostSession, 'host transport failed')
    if (state === 'closed') hostSession = closePrivateRoomPeerSession()
  })
  peerTransport.onStateChange(state => {
    if (state === 'connected') peerSession = markPrivateRoomPeerConnected(peerSession)
    if (state === 'failed') peerSession = markPrivateRoomPeerFailed(peerSession, 'peer transport failed')
    if (state === 'closed') peerSession = closePrivateRoomPeerSession()
  })

  const hostBridge = createPrivateRoomSignalBridge({
    transport: hostTransport,
    signalTransport: 'webrtc',
    onOutgoingSignal: async signal => {
      hostSignals.push(signal)
    },
  })

  const peerBridge = createPrivateRoomSignalBridge({
    transport: peerTransport,
    signalTransport: 'webrtc',
    onOutgoingSignal: async signal => {
      peerSignals.push(signal)
    },
  })

  await hostBridge.connect('host', hostSession.remotePeer?.playerId ?? 'peer')
  await peerBridge.connect('peer', peerSession.remotePeer?.playerId ?? 'host')

  for (let i = 1; i <= rounds; i++) {
    await hostBridge.sendMessage('battle-action', { round: i, actor: 'host' })
    await peerBridge.sendMessage('battle-ack', { round: i, actor: 'peer' })
  }

  const hostPhase = hostSession.phase
  const peerPhase = peerSession.phase

  await hostBridge.close()
  await peerBridge.close()

  return {
    hostPhase,
    peerPhase,
    hostSignals,
    peerSignals,
    hostReceived,
    peerReceived,
  }
}
