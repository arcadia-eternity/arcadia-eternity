import { getSupabaseClient, getSupabaseServiceClient } from '../client'
import {
  type BattleRecord,
  type CreateBattleRecordInput,
  type UpdateBattleRecordInput,
  type PlayerBattleRecord,
  type BattleStatistics,
  type PaginationParams,
  type PaginatedResponse,
  DatabaseError,
} from '../types'

export class BattleRepository {
  /**
   * 创建新的战报记录
   */
  async createBattleRecord(input: CreateBattleRecordInput): Promise<BattleRecord> {
    const supabase = getSupabaseServiceClient() // 使用服务客户端绕过 RLS

    const insertData = {
      ...(input.id && { id: input.id }), // 只有提供了 ID 才设置，否则让数据库自动生成
      player_a_id: input.player_a_id,
      player_a_name: input.player_a_name,
      player_b_id: input.player_b_id,
      player_b_name: input.player_b_name,
      started_at: input.started_at || new Date().toISOString(),
      battle_result: 'abandoned' as const, // 初始状态
      end_reason: 'disconnect' as const, // 初始状态
      battle_messages: [],
      final_state: {},
      metadata: input.metadata || {},
    }

    console.log('Creating battle record with data:', insertData)

    const { data, error } = await supabase.from('battle_records').insert(insertData).select().single()

    if (error) {
      console.error('Battle record creation error:', error)
      console.error('Insert data was:', insertData)
      throw new DatabaseError(`Failed to create battle record: ${error.message}`, error.code, error)
    }

    if (!data) {
      console.error('Battle record creation returned no data')
      throw new DatabaseError('Failed to create battle record: No data returned', 'NO_DATA', null)
    }

    console.log('Battle record created successfully:', data.id)
    return data
  }

  /**
   * 更新战报记录
   */
  async updateBattleRecord(id: string, input: UpdateBattleRecordInput): Promise<BattleRecord> {
    const supabase = getSupabaseServiceClient() // 使用服务客户端绕过 RLS

    const updateData: any = { ...input }

    // 如果设置了结束时间但没有设置持续时间，自动计算
    if (input.ended_at && !input.duration_seconds) {
      const battleRecord = await this.getBattleRecordById(id)
      if (battleRecord) {
        const startTime = new Date(battleRecord.started_at).getTime()
        const endTime = new Date(input.ended_at).getTime()
        updateData.duration_seconds = Math.round((endTime - startTime) / 1000)
      }
    }

    const { data, error } = await supabase.from('battle_records').update(updateData).eq('id', id).select().single()

    if (error) {
      throw new DatabaseError(`Failed to update battle record: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 根据 ID 获取战报记录
   */
  async getBattleRecordById(id: string): Promise<BattleRecord | null> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase.from('battle_records').select('*').eq('id', id).single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null
      }
      throw new DatabaseError(`Failed to get battle record: ${error.message}`, error.code, error)
    }

    return data
  }

  /**
   * 获取战报列表（分页）
   */
  async getBattleRecords(params: PaginationParams = {}): Promise<PaginatedResponse<BattleRecord>> {
    const supabase = getSupabaseClient()
    const { limit = 20, offset = 0 } = params

    const { data, error, count } = await supabase
      .from('battle_records')
      .select('*', { count: 'exact' })
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw new DatabaseError(`Failed to get battle records: ${error.message}`, error.code, error)
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
   * 获取玩家的战报记录
   */
  async getPlayerBattleRecords(
    playerId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResponse<PlayerBattleRecord>> {
    const supabase = getSupabaseClient()
    const { limit = 20, offset = 0 } = params

    const { data, error } = await supabase.rpc('get_player_battle_records', {
      p_player_id: playerId,
      p_limit: limit,
      p_offset: offset,
    })

    if (error) {
      throw new DatabaseError(`Failed to get player battle records: ${error.message}`, error.code, error)
    }

    // 获取总数
    const { count, error: countError } = await supabase
      .from('battle_records')
      .select('*', { count: 'exact', head: true })
      .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)

    if (countError) {
      throw new DatabaseError(
        `Failed to get player battle records count: ${countError.message}`,
        countError.code,
        countError,
      )
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
   * 获取战报统计信息
   */
  async getBattleStatistics(): Promise<BattleStatistics> {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase.rpc('get_battle_statistics')

    if (error) {
      throw new DatabaseError(`Failed to get battle statistics: ${error.message}`, error.code, error)
    }

    if (!data || data.length === 0) {
      return {
        total_battles: 0,
        total_players: 0,
        battles_today: 0,
        battles_this_week: 0,
        avg_battle_duration: 0,
      }
    }

    return data[0]
  }

  /**
   * 完成战报（设置结束状态）
   */
  async completeBattleRecord(
    id: string,
    winnerId: string | null,
    battleResult: string,
    endReason: string,
    battleMessages: any[],
    finalState: any,
  ): Promise<BattleRecord> {
    return this.updateBattleRecord(id, {
      ended_at: new Date().toISOString(),
      winner_id: winnerId,
      battle_result: battleResult as any,
      end_reason: endReason as any,
      battle_messages: battleMessages,
      final_state: finalState,
    })
  }

  /**
   * 删除战报记录（管理员功能）
   */
  async deleteBattleRecord(id: string): Promise<void> {
    const supabase = getSupabaseServiceClient()

    const { error } = await supabase.from('battle_records').delete().eq('id', id)

    if (error) {
      throw new DatabaseError(`Failed to delete battle record: ${error.message}`, error.code, error)
    }
  }

  /**
   * 清理废弃的战报
   */
  async cleanupAbandonedBattles(hoursThreshold: number = 24): Promise<number> {
    const supabase = getSupabaseServiceClient()

    const { data, error } = await supabase.rpc('cleanup_abandoned_battles', {
      p_hours_threshold: hoursThreshold,
    })

    if (error) {
      throw new DatabaseError(`Failed to cleanup abandoned battles: ${error.message}`, error.code, error)
    }

    return data || 0
  }

  /**
   * 清理超过指定天数的战报记录
   */
  async cleanupOldBattleRecords(daysThreshold: number = 7): Promise<number> {
    const supabase = getSupabaseServiceClient()

    const { data, error } = await supabase.rpc('cleanup_old_battle_records', {
      p_days_threshold: daysThreshold,
    })

    if (error) {
      throw new DatabaseError(`Failed to cleanup old battle records: ${error.message}`, error.code, error)
    }

    return data || 0
  }
}
