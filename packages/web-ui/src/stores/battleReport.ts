import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { battleReportService } from '@/services/battleReportService'
import type {
  BattleRecord,
  PlayerBattleRecord,
  LeaderboardEntry,
  BattleStatistics,
  PlayerSearchResult,
  Player,
  PlayerStats,
  PaginatedResponse
} from '@/services/battleReportService'

export const useBattleReportStore = defineStore('battleReport', () => {
  // 状态
  const battleRecords = ref<BattleRecord[]>([])
  const currentBattleRecord = ref<BattleRecord | null>(null)
  const playerBattleRecords = ref<PlayerBattleRecord[]>([])
  const leaderboard = ref<LeaderboardEntry[]>([])
  const battleStatistics = ref<BattleStatistics | null>(null)
  const searchResults = ref<PlayerSearchResult[]>([])
  const currentPlayer = ref<Player | null>(null)
  const currentPlayerStats = ref<PlayerStats | null>(null)
  
  // 分页状态
  const battleRecordsPagination = ref({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false
  })
  
  const playerBattleRecordsPagination = ref({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false
  })
  
  const leaderboardPagination = ref({
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false
  })
  
  // 加载状态
  const loading = ref({
    battleRecords: false,
    battleRecord: false,
    playerBattleRecords: false,
    leaderboard: false,
    statistics: false,
    search: false,
    player: false,
    playerStats: false
  })
  
  // 错误状态
  const errors = ref<Record<string, string | null>>({})
  
  // 计算属性
  const isLoading = computed(() => Object.values(loading.value).some(Boolean))
  const hasErrors = computed(() => Object.values(errors.value).some(Boolean))
  
  // 清除错误
  const clearError = (key: string) => {
    errors.value[key] = null
  }
  
  const clearAllErrors = () => {
    Object.keys(errors.value).forEach(key => {
      errors.value[key] = null
    })
  }
  
  // 获取战报列表
  const fetchBattleRecords = async (reset: boolean = false) => {
    try {
      loading.value.battleRecords = true
      clearError('battleRecords')
      
      const offset = reset ? 0 : battleRecordsPagination.value.offset
      const result = await battleReportService.getBattleRecords({
        limit: battleRecordsPagination.value.limit,
        offset
      })
      
      if (reset) {
        battleRecords.value = result.data
      } else {
        battleRecords.value.push(...result.data)
      }
      
      battleRecordsPagination.value = {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.has_more
      }
      
    } catch (error) {
      errors.value.battleRecords = error instanceof Error ? error.message : 'Failed to fetch battle records'
    } finally {
      loading.value.battleRecords = false
    }
  }
  
  // 加载更多战报
  const loadMoreBattleRecords = async () => {
    if (!battleRecordsPagination.value.hasMore || loading.value.battleRecords) {
      return
    }
    
    battleRecordsPagination.value.offset += battleRecordsPagination.value.limit
    await fetchBattleRecords(false)
  }
  
  // 获取单个战报详情
  const fetchBattleRecord = async (id: string) => {
    try {
      loading.value.battleRecord = true
      clearError('battleRecord')
      
      const result = await battleReportService.getBattleRecord(id)
      currentBattleRecord.value = result
      
    } catch (error) {
      errors.value.battleRecord = error instanceof Error ? error.message : 'Failed to fetch battle record'
    } finally {
      loading.value.battleRecord = false
    }
  }
  
  // 获取玩家战报记录
  const fetchPlayerBattleRecords = async (playerId: string, reset: boolean = false) => {
    try {
      loading.value.playerBattleRecords = true
      clearError('playerBattleRecords')
      
      const offset = reset ? 0 : playerBattleRecordsPagination.value.offset
      const result = await battleReportService.getPlayerBattleRecords(playerId, {
        limit: playerBattleRecordsPagination.value.limit,
        offset
      })
      
      if (reset) {
        playerBattleRecords.value = result.data
      } else {
        playerBattleRecords.value.push(...result.data)
      }
      
      playerBattleRecordsPagination.value = {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.has_more
      }
      
    } catch (error) {
      errors.value.playerBattleRecords = error instanceof Error ? error.message : 'Failed to fetch player battle records'
    } finally {
      loading.value.playerBattleRecords = false
    }
  }
  
  // 获取排行榜
  const fetchLeaderboard = async (reset: boolean = false) => {
    try {
      loading.value.leaderboard = true
      clearError('leaderboard')
      
      const offset = reset ? 0 : leaderboardPagination.value.offset
      const result = await battleReportService.getLeaderboard({
        limit: leaderboardPagination.value.limit,
        offset
      })
      
      if (reset) {
        leaderboard.value = result.data
      } else {
        leaderboard.value.push(...result.data)
      }
      
      leaderboardPagination.value = {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.has_more
      }
      
    } catch (error) {
      errors.value.leaderboard = error instanceof Error ? error.message : 'Failed to fetch leaderboard'
    } finally {
      loading.value.leaderboard = false
    }
  }
  
  // 获取战报统计
  const fetchBattleStatistics = async () => {
    try {
      loading.value.statistics = true
      clearError('statistics')
      
      const result = await battleReportService.getBattleStatistics()
      battleStatistics.value = result
      
    } catch (error) {
      errors.value.statistics = error instanceof Error ? error.message : 'Failed to fetch battle statistics'
    } finally {
      loading.value.statistics = false
    }
  }
  
  // 搜索玩家
  const searchPlayers = async (searchTerm: string, limit: number = 20) => {
    try {
      loading.value.search = true
      clearError('search')
      
      const result = await battleReportService.searchPlayers(searchTerm, limit)
      searchResults.value = result
      
    } catch (error) {
      errors.value.search = error instanceof Error ? error.message : 'Failed to search players'
    } finally {
      loading.value.search = false
    }
  }
  
  // 获取玩家信息
  const fetchPlayer = async (playerId: string) => {
    try {
      loading.value.player = true
      clearError('player')
      
      const result = await battleReportService.getPlayer(playerId)
      currentPlayer.value = result
      
    } catch (error) {
      errors.value.player = error instanceof Error ? error.message : 'Failed to fetch player'
    } finally {
      loading.value.player = false
    }
  }
  
  // 获取玩家统计
  const fetchPlayerStats = async (playerId: string) => {
    try {
      loading.value.playerStats = true
      clearError('playerStats')
      
      const result = await battleReportService.getPlayerStats(playerId)
      currentPlayerStats.value = result
      
    } catch (error) {
      errors.value.playerStats = error instanceof Error ? error.message : 'Failed to fetch player stats'
    } finally {
      loading.value.playerStats = false
    }
  }
  
  // 重置状态
  const reset = () => {
    battleRecords.value = []
    currentBattleRecord.value = null
    playerBattleRecords.value = []
    leaderboard.value = []
    battleStatistics.value = null
    searchResults.value = []
    currentPlayer.value = null
    currentPlayerStats.value = null
    
    // 重置分页
    battleRecordsPagination.value = { total: 0, limit: 20, offset: 0, hasMore: false }
    playerBattleRecordsPagination.value = { total: 0, limit: 20, offset: 0, hasMore: false }
    leaderboardPagination.value = { total: 0, limit: 50, offset: 0, hasMore: false }
    
    // 清除错误
    clearAllErrors()
  }
  
  return {
    // 状态
    battleRecords,
    currentBattleRecord,
    playerBattleRecords,
    leaderboard,
    battleStatistics,
    searchResults,
    currentPlayer,
    currentPlayerStats,
    
    // 分页状态
    battleRecordsPagination,
    playerBattleRecordsPagination,
    leaderboardPagination,
    
    // 加载状态
    loading,
    errors,
    isLoading,
    hasErrors,
    
    // 方法
    fetchBattleRecords,
    loadMoreBattleRecords,
    fetchBattleRecord,
    fetchPlayerBattleRecords,
    fetchLeaderboard,
    fetchBattleStatistics,
    searchPlayers,
    fetchPlayer,
    fetchPlayerStats,
    clearError,
    clearAllErrors,
    reset
  }
})
