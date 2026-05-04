import type { SpeciesSchemaType } from '@arcadia-eternity/schema'
import type { SpeciesDataProvider } from '../interfaces/SpeciesDataProvider'

/**
 * 服务端种族数据提供者
 * 从服务端的数据仓库中获取种族信息
 */
export class ServerSpeciesDataProvider implements SpeciesDataProvider {
  private dataRepository: Record<string, unknown> | undefined

  constructor(dataRepository?: Record<string, unknown>) {
    this.dataRepository = dataRepository
  }

  /**
   * 设置数据仓库
   * @param dataRepository 数据仓库实例
   */
  setDataRepository(dataRepository: Record<string, unknown>): void {
    this.dataRepository = dataRepository
  }

  /**
   * 根据种族ID获取种族数据
   * @param speciesId 种族ID
   * @returns 种族数据或undefined
   */
  getSpeciesById(speciesId: string): SpeciesSchemaType | undefined {
    if (!this.dataRepository) {
      console.warn('DataRepository not available in ServerSpeciesDataProvider')
      return undefined
    }

    try {
      // 尝试从DataRepository获取种族数据
      const repo = this.dataRepository as { getSpeciesById?: (id: string) => SpeciesSchemaType | undefined }
      if (repo.getSpeciesById) {
        return repo.getSpeciesById(speciesId)
      }

      // 尝试从getAllSpecies中查找
      const repoWithAll = this.dataRepository as { getAllSpecies?: () => SpeciesSchemaType[] }
      if (repoWithAll.getAllSpecies) {
        const allSpecies = repoWithAll.getAllSpecies()
        return allSpecies.find((species: SpeciesSchemaType) => species.id === speciesId)
      }

      // 尝试从species属性中获取
      const speciesMap = this.dataRepository.species as Record<string, SpeciesSchemaType> | undefined
      if (speciesMap && speciesMap[speciesId]) {
        return speciesMap[speciesId]
      }

      console.warn(`Species not found: ${speciesId}`)
      return undefined
    } catch (error) {
      console.error('Error getting species data from server:', error)
      return undefined
    }
  }

  /**
   * 检查数据提供者是否已准备就绪
   * @returns 是否准备就绪
   */
  isReady(): boolean {
    return !!this.dataRepository
  }

  /**
   * 获取所有可用的种族ID列表
   * @returns 种族ID列表
   */
  getAllSpeciesIds(): string[] {
    if (!this.dataRepository) {
      return []
    }

    try {
      const repoWithAll = this.dataRepository as { getAllSpecies?: () => SpeciesSchemaType[] }
      if (repoWithAll.getAllSpecies) {
        const allSpecies = repoWithAll.getAllSpecies()
        return allSpecies.map((species: SpeciesSchemaType) => species.id)
      }

      const speciesMap = this.dataRepository.species as Record<string, SpeciesSchemaType> | undefined
      if (speciesMap) {
        return Object.keys(speciesMap)
      }

      return []
    } catch (error) {
      console.error('Error getting all species IDs from server:', error)
      return []
    }
  }

  /**
   * 获取提供者状态信息
   * @returns 状态信息
   */
  getStatus(): {
    isReady: boolean
    hasDataRepository: boolean
    speciesCount: number
  } {
    const isReady = this.isReady()
    const speciesIds = this.getAllSpeciesIds()

    return {
      isReady,
      hasDataRepository: !!this.dataRepository,
      speciesCount: speciesIds.length,
    }
  }
}

/**
 * 全局服务端种族数据提供者实例
 */
let globalServerSpeciesDataProvider: ServerSpeciesDataProvider | null = null

/**
 * 获取全局服务端种族数据提供者
 * @returns 全局实例
 */
export function getGlobalServerSpeciesDataProvider(): ServerSpeciesDataProvider {
  if (!globalServerSpeciesDataProvider) {
    globalServerSpeciesDataProvider = new ServerSpeciesDataProvider()
  }
  return globalServerSpeciesDataProvider
}

/**
 * 初始化全局服务端种族数据提供者
 * @param dataRepository 数据仓库实例
 */
export function initializeGlobalServerSpeciesDataProvider(dataRepository: Record<string, unknown>): void {
  const provider = getGlobalServerSpeciesDataProvider()
  provider.setDataRepository(dataRepository)
  console.log('Global server species data provider initialized')
}

/**
 * 重置全局服务端种族数据提供者（主要用于测试）
 */
export function resetGlobalServerSpeciesDataProvider(): void {
  globalServerSpeciesDataProvider = null
}
