import { getSupabaseClient, getSupabaseServiceClient } from '../client'
import {
  type PlayerEloRating,
  type EloLeaderboardEntry,
  type CreateEloRatingInput,
  type UpdateEloRatingInput,
  type EloUpdateResult,
  type PaginationParams,
  type PaginatedResponse,
  DatabaseError,
} from '../types'

export class EloRepository {
  /**
   * 获取或创建玩家ELO评级记录
   */
  async getOrCreatePlayerElo(
    playerId: string,
    ruleSetId: string,
    initialElo: number = 1200
  ): Promise<PlayerEloRating> {
    const supabase = getSupabaseServiceClient()

    const { data, error } = await supabase.rpc('get_or_create_player_elo', {
      p_player_id: playerId,
      p_rule_set_id: ruleSetId,
      p_initial_elo: initialElo,
    })

    if (error) {
      throw new DatabaseError(`Failed to get or create player ELO: ${error.message}`, error.code, error)
    }

    if (!data || data.length === 0) {
      throw new DatabaseError('No ELO rating data returned', 'NO_DATA')
    }

    return data[0]
  }

  /**
   * 获取玩家在特定规则集下的ELO评级
   */
  async getPlayerElo(playerId: string, ruleSetId: string): Promise<PlayerEloRating | null> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase
      .from('player_elo_ratings')
      .select('*')
      .eq('player_id', playerId)
      .eq('rule_set_id', ruleSetId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw new DatabaseError(`Failed to get player ELO: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 获取玩家的所有规则集ELO评级
   */
  async getPlayerAllElos(playerId: string): Promise<PlayerEloRating[]> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase
      .from('player_elo_ratings')
      .select('*')
      .eq('player_id', playerId)
      .order('elo_rating', { ascending: false })

    if (error) {
      throw new DatabaseError(`Failed to get player all ELOs: ${error.message}`, error.code, error)
    }

    return data || []
  }

  /**
   * 更新玩家ELO评级
   */
  async updatePlayerElo(input: UpdateEloRatingInput): Promise<void> {
    const supabase = getSupabaseServiceClient()

    const { error } = await supabase.rpc('update_player_elo', {
      p_player_id: input.player_id,
      p_rule_set_id: input.rule_set_id,
      p_new_elo: input.new_elo,
      p_result: input.result,
    })

    if (error) {
      throw new DatabaseError(`Failed to update player ELO: ${error.message}`, error.code, error)
    }
  }

  /**
   * 批量更新多个玩家的ELO评级（用于战斗结束后的原子更新）
   */
  async batchUpdatePlayerElos(updates: UpdateEloRatingInput[]): Promise<void> {
    const supabase = getSupabaseServiceClient()

    // 使用事务确保原子性
    const { error } = await supabase.rpc('batch_update_player_elos', {
      updates: updates.map(update => ({
        player_id: update.player_id,
        rule_set_id: update.rule_set_id,
        new_elo: update.new_elo,
        result: update.result,
      })),
    })

    if (error) {
      throw new DatabaseError(`Failed to batch update player ELOs: ${error.message}`, error.code, error)
    }
  }

  /**
   * 获取规则集ELO排行榜
   */
  async getEloLeaderboard(
    ruleSetId: string,
    params: PaginationParams = {}
  ): Promise<PaginatedResponse<EloLeaderboardEntry>> {
    const supabase = getSupabaseClient()
    const { limit = 50, offset = 0 } = params

    const { data, error } = await supabase.rpc('get_elo_leaderboard', {
      p_rule_set_id: ruleSetId,
      p_limit: limit,
      p_offset: offset,
    })

    if (error) {
      throw new DatabaseError(`Failed to get ELO leaderboard: ${error.message}`, error.code, error)
    }

    // 获取总数（用于分页）
    const { count, error: countError } = await supabase
      .from('player_elo_ratings')
      .select('*', { count: 'exact', head: true })
      .eq('rule_set_id', ruleSetId)

    if (countError) {
      throw new DatabaseError(`Failed to get ELO leaderboard count: ${countError.message}`, countError.code, countError)
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
   * 获取玩家在特定规则集中的排名
   */
  async getPlayerRank(playerId: string, ruleSetId: string): Promise<number | null> {
    const supabase = getSupabaseClient()

    // 获取玩家的ELO评级
    const playerElo = await this.getPlayerElo(playerId, ruleSetId)
    if (!playerElo) {
      return null
    }

    // 计算排名（比该玩家ELO高的玩家数量 + 1）
    const { count, error } = await supabase
      .from('player_elo_ratings')
      .select('*', { count: 'exact', head: true })
      .eq('rule_set_id', ruleSetId)
      .gt('elo_rating', playerElo.elo_rating)

    if (error) {
      throw new DatabaseError(`Failed to get player rank: ${error.message}`, error.code, error)
    }

    return (count || 0) + 1
  }

  /**
   * 获取规则集的ELO统计信息
   */
  async getEloStatistics(ruleSetId: string): Promise<{
    total_players: number
    average_elo: number
    highest_elo: number
    lowest_elo: number
    total_games: number
  }> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase
      .from('player_elo_ratings')
      .select('elo_rating, games_played')
      .eq('rule_set_id', ruleSetId)

    if (error) {
      throw new DatabaseError(`Failed to get ELO statistics: ${error.message}`, error.code, error)
    }

    if (!data || data.length === 0) {
      return {
        total_players: 0,
        average_elo: 1200,
        highest_elo: 1200,
        lowest_elo: 1200,
        total_games: 0,
      }
    }

    const eloRatings = data.map(d => d.elo_rating)
    const totalGames = data.reduce((sum, d) => sum + d.games_played, 0)

    return {
      total_players: data.length,
      average_elo: Math.round(eloRatings.reduce((sum, elo) => sum + elo, 0) / data.length),
      highest_elo: Math.max(...eloRatings),
      lowest_elo: Math.min(...eloRatings),
      total_games: totalGames,
    }
  }
}
