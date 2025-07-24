import axios from 'axios'
import type {
  BattleRecord,
  PlayerBattleRecord,
  LeaderboardEntry,
  EloLeaderboardEntry,
  BattleStatistics,
  PlayerSearchResult,
  Player,
  PlayerStats,
  PaginatedResponse,
  RuleSetInfo,
  RuleSetDetails,
} from '@arcadia-eternity/database'

// API 基础配置
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8102/api/v1'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
api.interceptors.request.use(
  config => {
    // 可以在这里添加认证 token
    // const token = localStorage.getItem('auth_token')
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`
    // }
    return config
  },
  error => {
    return Promise.reject(error)
  },
)

// 响应拦截器
api.interceptors.response.use(
  response => {
    return response
  },
  error => {
    console.error('API Error:', error.response?.data || error.message)
    return Promise.reject(error)
  },
)

export interface PaginationParams {
  limit?: number
  offset?: number
}

/**
 * 战报服务 - 前端 API 客户端
 */
export class BattleReportService {
  /**
   * 获取战报列表
   */
  async getBattleRecords(params: PaginationParams = {}): Promise<PaginatedResponse<BattleRecord>> {
    const response = await api.get('/battles', { params })
    return response.data
  }

  /**
   * 获取单个战报详情
   */
  async getBattleRecord(id: string): Promise<BattleRecord> {
    const response = await api.get(`/battles/${id}`)
    return response.data
  }

  /**
   * 获取玩家的战报记录
   */
  async getPlayerBattleRecords(
    playerId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResponse<PlayerBattleRecord>> {
    const response = await api.get(`/players/${playerId}/battles`, { params })
    return response.data
  }

  /**
   * 获取玩家信息
   */
  async getPlayer(playerId: string): Promise<Player> {
    const response = await api.get(`/players/${playerId}`)
    return response.data
  }

  /**
   * 获取玩家统计信息
   */
  async getPlayerStats(playerId: string): Promise<PlayerStats> {
    const response = await api.get(`/players/${playerId}/stats`)
    return response.data
  }

  /**
   * 搜索玩家
   */
  async searchPlayers(searchTerm: string, limit: number = 20): Promise<PlayerSearchResult[]> {
    const response = await api.get('/players', {
      params: { search: searchTerm, limit },
    })
    return response.data.data
  }

  /**
   * 获取排行榜（已废弃，使用 getEloLeaderboard 代替）
   */
  async getLeaderboard(params: PaginationParams = {}): Promise<PaginatedResponse<LeaderboardEntry>> {
    const response = await api.get('/leaderboard', { params })
    return response.data
  }

  /**
   * 获取ELO排行榜
   */
  async getEloLeaderboard(
    ruleSetId: string,
    params: PaginationParams = {},
  ): Promise<PaginatedResponse<EloLeaderboardEntry>> {
    const response = await api.get(`/elo/leaderboard/${ruleSetId}`, { params })
    return response.data.data // API返回 { success: true, data: PaginatedResponse }
  }

  /**
   * 获取所有规则集
   */
  async getRuleSets(): Promise<RuleSetInfo[]> {
    const response = await api.get('/rulesets')
    return response.data.data
  }

  /**
   * 获取启用ELO的规则集
   */
  async getEloEnabledRuleSets(): Promise<RuleSetInfo[]> {
    const response = await api.get('/rulesets/elo-enabled')
    return response.data.data
  }

  /**
   * 获取规则集详情
   */
  async getRuleSetDetails(ruleSetId: string): Promise<RuleSetDetails> {
    const response = await api.get(`/rulesets/${ruleSetId}`)
    return response.data.data
  }

  /**
   * 获取战报统计信息
   */
  async getBattleStatistics(): Promise<BattleStatistics> {
    const response = await api.get('/statistics')
    return response.data
  }
}

// 创建默认实例
export const battleReportService = new BattleReportService()

// 导出类型
export type {
  BattleRecord,
  PlayerBattleRecord,
  LeaderboardEntry,
  EloLeaderboardEntry,
  BattleStatistics,
  PlayerSearchResult,
  Player,
  PlayerStats,
  PaginatedResponse,
  RuleSetInfo,
  RuleSetDetails,
}
