import type { BattleMessage, BattleState } from '@arcadia-eternity/const'

// 数据库表类型定义
export interface Player {
  id: string
  name: string
  created_at: string
  last_login_at: string
  metadata: Record<string, any>
  email: string | null
  email_verified: boolean
  email_bound_at: string | null
  is_registered: boolean
}

export interface PlayerStats {
  player_id: string
  total_battles: number
  wins: number
  losses: number
  draws: number
  updated_at: string
}

export interface PlayerEloRating {
  player_id: string
  rule_set_id: string
  elo_rating: number
  games_played: number
  wins: number
  losses: number
  draws: number
  highest_elo: number
  created_at: string
  updated_at: string
}

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
  battle_result: BattleResult
  end_reason: EndReason
  battle_messages: BattleMessage[]
  final_state: BattleState | Record<string, any>
  metadata: Record<string, any>
  created_at: string
}

export interface EmailVerificationCode {
  id: string
  email: string
  code: string
  player_id: string
  purpose: 'bind' | 'recover'
  created_at: string
  expires_at: string
  used_at: string | null
}

// 枚举类型
export type BattleResult = 'player_a_wins' | 'player_b_wins' | 'draw' | 'abandoned'
export type EndReason = 'all_pet_fainted' | 'surrender' | 'timeout' | 'disconnect'
export type VerificationPurpose = 'bind' | 'recover'

// 创建和更新类型
export interface CreatePlayerInput {
  id: string
  name: string
  metadata?: Record<string, any>
}

export interface UpdatePlayerInput {
  name?: string
  last_login_at?: string
  metadata?: Record<string, any>
  email?: string | null
  email_verified?: boolean
  email_bound_at?: string | null
  is_registered?: boolean
}

export interface CreateBattleRecordInput {
  id?: string
  player_a_id: string
  player_a_name: string
  player_b_id: string
  player_b_name: string
  started_at?: string
  metadata?: Record<string, any>
}

export interface UpdateBattleRecordInput {
  ended_at?: string
  duration_seconds?: number
  winner_id?: string | null
  battle_result?: BattleResult
  end_reason?: EndReason
  battle_messages?: BattleMessage[]
  final_state?: BattleState | Record<string, any>
  metadata?: Record<string, any>
}

export interface CreateEmailVerificationCodeInput {
  email: string
  code: string
  player_id: string
  purpose: VerificationPurpose
  expires_at?: string
}

export interface UpdateEmailVerificationCodeInput {
  used_at?: string | null
}

// 查询结果类型
export interface PlayerBattleRecord {
  id: string
  opponent_id: string
  opponent_name: string
  is_winner: boolean
  battle_result: BattleResult
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
}

export interface LeaderboardEntry {
  player_id: string
  player_name: string
  total_battles: number
  wins: number
  losses: number
  draws: number
  win_rate: number
}

export interface EloLeaderboardEntry {
  player_id: string
  player_name: string
  elo_rating: number
  games_played: number
  wins: number
  losses: number
  draws: number
  win_rate: number
  highest_elo: number
}

export interface CreateEloRatingInput {
  player_id: string
  rule_set_id: string
  initial_elo?: number
}

export interface UpdateEloRatingInput {
  player_id: string
  rule_set_id: string
  new_elo: number
  result: 'win' | 'loss' | 'draw'
}

export interface EloUpdateResult {
  player_id: string
  rule_set_id: string
  old_elo: number
  new_elo: number
  elo_change: number
  result: 'win' | 'loss' | 'draw'
}

// 规则集相关类型
export interface RuleSetInfo {
  id: string
  name: string
  description?: string
  version: string
  author?: string
  tags: string[]
  enabled: boolean
  ruleCount: number
  matchingConfig?: {
    strategy: 'fifo' | 'elo'
    eloConfig?: {
      initialRange: number
      rangeExpansionPerSecond: number
      maxEloDifference: number
      maxWaitTime: number
    }
  }
  eloConfig?: {
    initialRange: number
    rangeExpansionPerSecond: number
    maxEloDifference: number
    maxWaitTime: number
  } | null
}

export interface RuleSetDetails extends RuleSetInfo {
  isEloEnabled: boolean
  rules: {
    id: string
    name: string
    description?: string
    enabled: boolean
    priority: number
    tags: string[]
  }[]
}

export interface BattleStatistics {
  total_battles: number
  total_players: number
  battles_today: number
  battles_this_week: number
  avg_battle_duration: number
}

export interface PlayerSearchResult {
  id: string
  name: string
  total_battles: number
  wins: number
  win_rate: number
}

// 分页参数
export interface PaginationParams {
  limit?: number
  offset?: number
}

// API 响应类型
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
  has_more: boolean
}

// 错误类型
export class DatabaseError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: any,
  ) {
    super(message)
    this.name = 'DatabaseError'
  }
}

// 配置类型
export interface DatabaseConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceKey?: string
}
