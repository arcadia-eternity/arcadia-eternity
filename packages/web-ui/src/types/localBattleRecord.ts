import type { BattleMessage, BattleState } from '@arcadia-eternity/const'

/** Existing browser report format; independent of any server database implementation. */
export interface BattleRecord {
  id: string
  player_a_id: string
  player_a_name: string
  player_b_id: string
  player_b_name: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  winner_id: string | null
  battle_result: 'player_a_wins' | 'player_b_wins' | 'draw' | 'abandoned'
  end_reason: 'all_pet_fainted' | 'surrender' | 'timeout' | 'disconnect'
  battle_messages: BattleMessage[]
  final_state: BattleState | Record<string, unknown>
  metadata: Record<string, unknown>
  created_at: string
}
