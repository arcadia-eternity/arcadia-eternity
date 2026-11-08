import type { PrivateRoomInfo, ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'

type RoomInput = Omit<Partial<PrivateRoomInfo>, 'config' | 'players'> & {
  config?: Partial<PrivateRoomInfo['config']>
  players?: Partial<PrivateRoomInfo['players'][number]>[]
}

export function roomFixture(input: RoomInput = {}): PrivateRoomInfo {
  return {
    id: 'room-fixture',
    status: 'waiting',
    createdAt: 0,
    lastActivity: 0,
    spectators: [],
    ...input,
    config: {
      roomCode: 'ABC123',
      hostPlayerId: 'host',
      ruleSetId: 'default',
      maxPlayers: 2,
      isPrivate: false,
      battleMode: 'server',
      ...input.config,
    },
    players: (input.players ?? []).map(player => ({
      playerId: 'host',
      playerName: 'Host',
      sessionId: 'host-session',
      isReady: false,
      joinedAt: 0,
      ...player,
    })),
  }
}

export function environmentFixture(input: Partial<ServerEnvironmentDescriptor> = {}): ServerEnvironmentDescriptor {
  return {
    id: 'environment-fixture',
    protocolVersion: 1,
    packages: [],
    resources: [],
    resourceRevision: 'resources',
    runtime: { kind: 'native-v4', contentRevision: 'content', coreBuildId: 'core', registryBuildId: 'registry' },
    ...input,
  }
}
