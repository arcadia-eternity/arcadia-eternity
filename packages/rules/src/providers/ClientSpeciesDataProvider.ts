import type { SpeciesSchemaType } from '@arcadia-eternity/schema'
import type { SpeciesDataProvider } from '../rules/basic/SkillAvailabilityRule'

/**
 * 客户端种族数据提供者
 * 从客户端的游戏数据存储中获取种族信息
 */
export class ClientSpeciesDataProvider implements SpeciesDataProvider {
  private gameDataStore: any

  constructor(gameDataStore?: any) {
    this.gameDataStore = gameDataStore
  }

  /**
   * 设置游戏数据存储
   * @param gameDataStore 游戏数据存储实例
   */
  setGameDataStore(gameDataStore: any): void {
    this.gameDataStore = gameDataStore
  }

  /**
   * 根据种族ID获取种族数据
   * @param speciesId 种族ID
   * @returns 种族数据或undefined
   */
  getSpeciesById(speciesId: string): SpeciesSchemaType | undefined {
    if (!this.gameDataStore) {
      return undefined
    }

    try {
      // 尝试从speciesList中查找
      if (this.gameDataStore.speciesList && Array.isArray(this.gameDataStore.speciesList)) {
        return this.gameDataStore.speciesList.find((species: SpeciesSchemaType) => species.id === speciesId)
      }

      // 尝试从其他可能的数据结构中查找
      if (this.gameDataStore.species && this.gameDataStore.species[speciesId]) {
        return this.gameDataStore.species[speciesId]
      }

      // 如果有byId映射
      if (this.gameDataStore.species && this.gameDataStore.species.byId && this.gameDataStore.species.byId[speciesId]) {
        return this.gameDataStore.species.byId[speciesId]
      }

      return undefined
    } catch (error) {
      console.error('Error getting species data:', error)
      return undefined
    }
  }

  /**
   * 检查数据提供者是否已准备就绪
   * @returns 是否准备就绪
   */
  isReady(): boolean {
    return !!this.gameDataStore
  }

  /**
   * 获取所有可用的种族ID列表
   * @returns 种族ID列表
   */
  getAllSpeciesIds(): string[] {
    if (!this.gameDataStore) {
      return []
    }

    try {
      if (this.gameDataStore.speciesList && Array.isArray(this.gameDataStore.speciesList)) {
        return this.gameDataStore.speciesList.map((species: SpeciesSchemaType) => species.id)
      }

      if (this.gameDataStore.species && this.gameDataStore.species.byId) {
        return Object.keys(this.gameDataStore.species.byId)
      }

      return []
    } catch (error) {
      console.error('Error getting all species IDs:', error)
      return []
    }
  }

  /**
   * 获取提供者状态信息
   * @returns 状态信息
   */
  getStatus(): {
    isReady: boolean
    hasGameDataStore: boolean
    speciesCount: number
  } {
    const isReady = this.isReady()
    const speciesIds = this.getAllSpeciesIds()

    return {
      isReady,
      hasGameDataStore: !!this.gameDataStore,
      speciesCount: speciesIds.length,
    }
  }
}

/**
 * 全局客户端种族数据提供者实例
 */
let globalClientSpeciesDataProvider: ClientSpeciesDataProvider | null = null

/**
 * 获取全局客户端种族数据提供者
 * @returns 全局实例
 */
export function getGlobalClientSpeciesDataProvider(): ClientSpeciesDataProvider {
  if (!globalClientSpeciesDataProvider) {
    globalClientSpeciesDataProvider = new ClientSpeciesDataProvider()
  }
  return globalClientSpeciesDataProvider
}

/**
 * 初始化全局客户端种族数据提供者
 * @param gameDataStore 游戏数据存储实例
 */
export function initializeGlobalClientSpeciesDataProvider(gameDataStore: any): void {
  const provider = getGlobalClientSpeciesDataProvider()
  provider.setGameDataStore(gameDataStore)
}

/**
 * 重置全局客户端种族数据提供者（主要用于测试）
 */
export function resetGlobalClientSpeciesDataProvider(): void {
  globalClientSpeciesDataProvider = null
}
