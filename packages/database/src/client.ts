import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { DatabaseConfig } from './types'

// 数据库表类型定义（用于 Supabase 类型推断）
export interface Database {
  public: {
    Tables: {
      players: {
        Row: {
          id: string
          name: string
          created_at: string
          last_login_at: string
          metadata: Record<string, any>
        }
        Insert: {
          id: string
          name: string
          created_at?: string
          last_login_at?: string
          metadata?: Record<string, any>
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
          last_login_at?: string
          metadata?: Record<string, any>
        }
      }
      player_stats: {
        Row: {
          player_id: string
          total_battles: number
          wins: number
          losses: number
          draws: number
          updated_at: string
        }
        Insert: {
          player_id: string
          total_battles?: number
          wins?: number
          losses?: number
          draws?: number
          updated_at?: string
        }
        Update: {
          player_id?: string
          total_battles?: number
          wins?: number
          losses?: number
          draws?: number
          updated_at?: string
        }
      }
      battle_records: {
        Row: {
          id: string
          player_a_id: string
          player_a_name: string
          player_b_id: string
          player_b_name: string
          started_at: string
          ended_at: string | null
          duration_seconds: number | null
          winner_id: string | null
          battle_result: string
          end_reason: string
          battle_messages: any[]
          final_state: Record<string, any>
          metadata: Record<string, any>
          created_at: string
        }
        Insert: {
          id?: string
          player_a_id: string
          player_a_name: string
          player_b_id: string
          player_b_name: string
          started_at?: string
          ended_at?: string | null
          duration_seconds?: number | null
          winner_id?: string | null
          battle_result: string
          end_reason: string
          battle_messages?: any[]
          final_state?: Record<string, any>
          metadata?: Record<string, any>
          created_at?: string
        }
        Update: {
          id?: string
          player_a_id?: string
          player_a_name?: string
          player_b_id?: string
          player_b_name?: string
          started_at?: string
          ended_at?: string | null
          duration_seconds?: number | null
          winner_id?: string | null
          battle_result?: string
          end_reason?: string
          battle_messages?: any[]
          final_state?: Record<string, any>
          metadata?: Record<string, any>
          created_at?: string
        }
      }
    }
    Functions: {
      get_player_battle_records: {
        Args: {
          p_player_id: string
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          id: string
          opponent_id: string
          opponent_name: string
          is_winner: boolean
          battle_result: string
          started_at: string
          ended_at: string | null
          duration_seconds: number | null
        }[]
      }
      get_leaderboard: {
        Args: {
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          player_id: string
          player_name: string
          total_battles: number
          wins: number
          losses: number
          draws: number
          win_rate: number
        }[]
      }
      get_battle_statistics: {
        Args: {}
        Returns: {
          total_battles: number
          total_players: number
          battles_today: number
          battles_this_week: number
          avg_battle_duration: number
        }[]
      }
      search_players: {
        Args: {
          p_search_term: string
          p_limit?: number
        }
        Returns: {
          id: string
          name: string
          total_battles: number
          wins: number
          win_rate: number
        }[]
      }
    }
  }
}

export type SupabaseClientType = SupabaseClient<Database>

let supabaseClient: SupabaseClientType | null = null
let supabaseServiceClient: SupabaseClientType | null = null

/**
 * 初始化 Supabase 客户端
 */
export function initializeSupabase(config: DatabaseConfig): void {
  supabaseClient = createClient<Database>(config.supabaseUrl, config.supabaseAnonKey)
  
  if (config.supabaseServiceKey) {
    supabaseServiceClient = createClient<Database>(config.supabaseUrl, config.supabaseServiceKey)
  }
}

/**
 * 获取 Supabase 客户端（用于用户操作）
 */
export function getSupabaseClient(): SupabaseClientType {
  if (!supabaseClient) {
    throw new Error('Supabase client not initialized. Call initializeSupabase() first.')
  }
  return supabaseClient
}

/**
 * 获取 Supabase 服务客户端（用于服务端操作，绕过 RLS）
 */
export function getSupabaseServiceClient(): SupabaseClientType {
  if (!supabaseServiceClient) {
    throw new Error('Supabase service client not initialized. Provide supabaseServiceKey in config.')
  }
  return supabaseServiceClient
}
