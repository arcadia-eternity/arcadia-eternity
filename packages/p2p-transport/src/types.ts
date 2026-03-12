export interface PrivateRoomPeerSignalPayload {
  transport: 'webrtc' | 'webtransport' | 'relay'
  kind: 'offer' | 'answer' | 'ice-candidate' | 'ready' | 'custom'
  payload: unknown
}

export interface PrivateRoomPeerEndpoint {
  playerId: string
  sessionId: string
}

export interface PrivateRoomBattleStartInfo {
  battleMode: 'p2p' | 'server'
  battleRoomId?: string
  battleHost: PrivateRoomPeerEndpoint
}

export interface PrivateRoomPlayerInfo {
  playerId: string
  playerName: string
  sessionId: string
  isReady: boolean
  joinedAt: number
}

export interface PrivateRoomInfo {
  id: string
  config: {
    roomCode: string
    hostPlayerId: string
    ruleSetId: string
    maxPlayers: number
    isPrivate: boolean
    battleMode: 'p2p' | 'server'
  }
  players: PrivateRoomPlayerInfo[]
  spectators: Array<{
    playerId: string
    playerName: string
    sessionId: string
    joinedAt: number
  }>
  status: 'waiting' | 'ready' | 'started' | 'finished' | 'ended'
  createdAt: number
  lastActivity: number
}

export interface PrivateRoomPeerSignalEvent {
  roomCode: string
  from: PrivateRoomPeerEndpoint
  to: PrivateRoomPeerEndpoint
  signal: PrivateRoomPeerSignalPayload
  timestamp: number
}
