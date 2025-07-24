import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { BattleReportService, type PlayerEloRating } from '@/services/battleReportService'

// ELO信息接口，包含排名
export interface PlayerEloInfo extends PlayerEloRating {
  rank: number | null
}

// ELO状态接口
interface EloState {
  playerElos: Record<string, PlayerEloInfo> // key: ruleSetId, value: ELO信息
  loading: boolean
  error: string | null
  lastUpdated: number | null
}

export const useEloStore = defineStore('elo', () => {
  // 状态
  const state = ref<EloState>({
    playerElos: {},
    loading: false,
    error: null,
    lastUpdated: null,
  })

  // 服务实例
  const battleReportService = new BattleReportService()

  // 计算属性
  const isLoading = computed(() => state.value.loading)
  const error = computed(() => state.value.error)
  const playerElos = computed(() => state.value.playerElos)

  // 获取特定规则集的ELO信息
  const getEloForRuleSet = computed(() => (ruleSetId: string) => {
    return state.value.playerElos[ruleSetId] || null
  })

  // 检查是否有ELO数据
  const hasEloData = computed(() => Object.keys(state.value.playerElos).length > 0)

  // 获取最高ELO的规则集
  const highestEloRuleSet = computed(() => {
    const eloEntries = Object.entries(state.value.playerElos)
    if (eloEntries.length === 0) return null

    return eloEntries.reduce(
      (highest, [ruleSetId, elo]) => {
        if (!highest || elo.elo_rating > highest.elo.elo_rating) {
          return { ruleSetId, elo }
        }
        return highest
      },
      null as { ruleSetId: string; elo: PlayerEloInfo } | null,
    )
  })

  // 方法
  const clearError = () => {
    state.value.error = null
  }

  const setLoading = (loading: boolean) => {
    state.value.loading = loading
  }

  const setError = (error: string) => {
    state.value.error = error
    state.value.loading = false
  }

  // 获取玩家所有规则集的ELO信息
  const fetchPlayerAllElos = async (playerId: string, force = false) => {
    // 如果不是强制刷新且数据较新（5分钟内），则跳过
    const now = Date.now()
    if (!force && state.value.lastUpdated && now - state.value.lastUpdated < 5 * 60 * 1000) {
      return
    }

    try {
      setLoading(true)
      clearError()

      const eloData = await battleReportService.getPlayerAllElos(playerId)

      // 转换为以ruleSetId为key的对象
      const eloMap: Record<string, PlayerEloInfo> = {}
      eloData.forEach(elo => {
        eloMap[elo.rule_set_id] = elo
      })

      state.value.playerElos = eloMap
      state.value.lastUpdated = now
    } catch (error) {
      console.error('Failed to fetch player ELOs:', error)
      setError(error instanceof Error ? error.message : '获取ELO信息失败')
    } finally {
      setLoading(false)
    }
  }

  // 获取特定规则集的ELO信息
  const fetchPlayerElo = async (playerId: string, ruleSetId: string, force = false) => {
    // 如果已有数据且不是强制刷新，则跳过
    if (!force && state.value.playerElos[ruleSetId]) {
      return state.value.playerElos[ruleSetId]
    }

    try {
      setLoading(true)
      clearError()

      const eloData = await battleReportService.getPlayerElo(playerId, ruleSetId)

      // 更新特定规则集的ELO信息
      state.value.playerElos[ruleSetId] = eloData
      state.value.lastUpdated = Date.now()

      return eloData
    } catch (error) {
      console.error(`Failed to fetch player ELO for rule set ${ruleSetId}:`, error)

      // 如果是404错误（玩家没有该规则集的ELO记录），不设置错误状态
      if (error instanceof Error && error.message.includes('404')) {
        return null
      }

      setError(error instanceof Error ? error.message : '获取ELO信息失败')
      return null
    } finally {
      setLoading(false)
    }
  }

  // 刷新所有ELO数据
  const refreshAllElos = async (playerId: string) => {
    await fetchPlayerAllElos(playerId, true)
  }

  // 清空ELO数据
  const clearEloData = () => {
    state.value.playerElos = {}
    state.value.lastUpdated = null
    clearError()
  }

  // 格式化胜率
  const formatWinRate = (wins: number, losses: number, draws: number): string => {
    const total = wins + losses + draws
    if (total === 0) return '0%'
    return `${Math.round((wins / total) * 100)}%`
  }

  return {
    // 状态
    isLoading,
    error,
    playerElos,
    hasEloData,
    highestEloRuleSet,

    // 计算属性
    getEloForRuleSet,

    // 方法
    fetchPlayerAllElos,
    fetchPlayerElo,
    refreshAllElos,
    clearEloData,
    clearError,
    formatWinRate,
  }
})
