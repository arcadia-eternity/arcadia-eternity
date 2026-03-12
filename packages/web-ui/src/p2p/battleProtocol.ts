import type {
  BattleMessage,
  BattleState,
  Events,
  PlayerSelection,
  PlayerTimerState,
  TimerConfig,
  playerId,
} from '@arcadia-eternity/const'

export interface P2PTimerSyncPayload {
  config: TimerConfig
  states: PlayerTimerState[]
}

export type P2PBattleMessage =
  | {
      type: 'p2p-battle-sync-request'
      payload: {
        requesterId: string
        lastSeenSequenceId?: number
      }
    }
  | {
      type: 'p2p-battle-init'
      payload: {
        viewerId: playerId
        battleState: BattleState
        availableSelections: PlayerSelection[]
        timer: P2PTimerSyncPayload
      }
    }
  | {
      type: 'p2p-battle-ack'
      payload: {
        viewerId: playerId
        sequenceId: number
      }
    }
  | {
      type: 'p2p-battle-event'
      payload: {
        viewerId: playerId
        message: BattleMessage
      }
    }
  | {
      type: 'p2p-battle-selection-update'
      payload: {
        viewerId: playerId
        availableSelections: PlayerSelection[]
      }
    }
  | {
      type: 'p2p-battle-submit-action'
      payload: {
        selection: PlayerSelection
      }
    }
  | {
      type: 'p2p-battle-start-animation'
      payload: {
        requestId: string
        source: string
        expectedDuration: number
        ownerId: playerId
      }
    }
  | {
      type: 'p2p-battle-start-animation-result'
      payload: {
        viewerId: playerId
        requestId: string
        animationId: string
      }
    }
  | {
      type: 'p2p-battle-end-animation'
      payload: {
        animationId: string
        actualDuration?: number
      }
    }
  | {
      type: 'p2p-battle-timer-event'
      payload: {
        viewerId: playerId
        eventType: keyof Events
        data: Events[keyof Events]
      }
    }

export function isP2PBattleMessage(value: unknown): value is P2PBattleMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; payload?: unknown }
  return typeof candidate.type === 'string' && 'payload' in candidate
}
