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
   * 确保玩家存在（如果不存在则创建，如果存在则只更新登录时间）
   */
  async ensurePlayer(id: string, name: string): Promise<Player> {
    const supabase = getSupabaseClient()

    // 先检查玩家是否存在
    const existingPlayer = await this.getPlayerById(id)

    if (existingPlayer) {
      // 如果玩家已存在，只更新登录时间，不更新名字
      const { data, error } = await supabase
        .from('players')
        .update({
          last_login_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single()

      if (error) {
        throw new DatabaseError(`Failed to update player login time: ${error.message}`, error.code, error)
      }

      return data
    } else {
      // 如果玩家不存在，创建新玩家
      const { data, error } = await supabase
        .from('players')
        .insert({
          id,
          name,
          last_login_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) {
        throw new DatabaseError(`Failed to create player: ${error.message}`, error.code, error)
      }

      return data
    }
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

  /**
   * 绑定邮箱到玩家账户（将匿名用户转为注册用户）
   */
  async bindEmail(playerId: string, email: string): Promise<Player> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase
      .from('players')
      .update({
        email,
        email_verified: true,
        email_bound_at: new Date().toISOString(),
        is_registered: true, // 标记为注册用户
      })
      .eq('id', playerId)
      .select()
      .single()

    if (error) {
      throw new DatabaseError(`Failed to bind email: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 解绑邮箱（将注册用户转回匿名用户）
   */
  async unbindEmail(playerId: string): Promise<Player> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase
      .from('players')
      .update({
        email: null,
        email_verified: false,
        email_bound_at: null,
        is_registered: false, // 转回匿名用户
      })
      .eq('id', playerId)
      .select()
      .single()

    if (error) {
      throw new DatabaseError(`Failed to unbind email: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 根据邮箱查找玩家
   */
  async getPlayerByEmail(email: string): Promise<Player | null> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('email', email)
      .eq('email_verified', true)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw new DatabaseError(`Failed to get player by email: ${error.message}`, error.code, error)
    }

    return data
  }
}
