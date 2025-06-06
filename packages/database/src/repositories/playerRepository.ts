import { getSupabaseClient } from '../client'
import {
  type Player,
  type PlayerStats,
  type CreatePlayerInput,
  type UpdatePlayerInput,
  type PlayerSearchResult,
  type LeaderboardEntry,
  type PaginationParams,
  type PaginatedResponse,
  DatabaseError,
} from '../types'

export class PlayerRepository {
  /**
   * 创建新玩家
   */
  async createPlayer(input: CreatePlayerInput): Promise<Player> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase
      .from('players')
      .insert({
        id: input.id,
        name: input.name,
        metadata: input.metadata || {},
      })
      .select()
      .single()

    if (error) {
      throw new DatabaseError(`Failed to create player: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 根据 ID 获取玩家
   */
  async getPlayerById(id: string): Promise<Player | null> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase.from('players').select('*').eq('id', id).single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw new DatabaseError(`Failed to get player: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 根据名称获取玩家
   */
  async getPlayerByName(name: string): Promise<Player | null> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase.from('players').select('*').eq('name', name).single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw new DatabaseError(`Failed to get player by name: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 更新玩家信息
   */
  async updatePlayer(id: string, input: UpdatePlayerInput): Promise<Player> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase.from('players').update(input).eq('id', id).select().single()

    if (error) {
      throw new DatabaseError(`Failed to update player: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 获取玩家统计信息
   */
  async getPlayerStats(playerId: string): Promise<PlayerStats | null> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase.from('player_stats').select('*').eq('player_id', playerId).single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw new DatabaseError(`Failed to get player stats: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 搜索玩家
   */
  async searchPlayers(searchTerm: string, limit: number = 20): Promise<PlayerSearchResult[]> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase.rpc('search_players', {
      p_search_term: searchTerm,
      p_limit: limit,
    })

    if (error) {
      throw new DatabaseError(`Failed to search players: ${error.message}`, error.code, error)
    }

    return data || []
  }

  /**
   * 获取排行榜
   */
  async getLeaderboard(params: PaginationParams = {}): Promise<PaginatedResponse<LeaderboardEntry>> {
    const supabase = getSupabaseClient()
    const { limit = 50, offset = 0 } = params

    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_limit: limit,
      p_offset: offset,
    })

    if (error) {
      throw new DatabaseError(`Failed to get leaderboard: ${error.message}`, error.code, error)
    }

    // 获取总数（用于分页）
    const { count, error: countError } = await supabase
      .from('player_stats')
      .select('*', { count: 'exact', head: true })
      .gt('total_battles', 0)

    if (countError) {
      throw new DatabaseError(`Failed to get leaderboard count: ${countError.message}`, countError.code, countError)
    }

    const total = count || 0

    return {
      data: data || [],
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    }
  }

  /**
   * 确保玩家存在（如果不存在则创建）
   */
  async ensurePlayer(id: string, name: string): Promise<Player> {
    const supabase = getSupabaseClient()

    // 使用 upsert 操作避免竞态条件
    const { data, error } = await supabase
      .from('players')
      .upsert(
        {
          id,
          name,
          last_login_at: new Date().toISOString(),
        },
        {
          onConflict: 'id',
          ignoreDuplicates: false, // 总是更新
        },
      )
      .select()
      .single()

    if (error) {
      throw new DatabaseError(`Failed to ensure player: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 批量获取玩家信息
   */
  async getPlayersByIds(ids: string[]): Promise<Player[]> {
    if (ids.length === 0) return []

    const supabase = getSupabaseClient()

    const { data, error } = await supabase.from('players').select('*').in('id', ids)

    if (error) {
      throw new DatabaseError(`Failed to get players by IDs: ${error.message}`, error.code, error)
    }

    return data || []
  }
}
