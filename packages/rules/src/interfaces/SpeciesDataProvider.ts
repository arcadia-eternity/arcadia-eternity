import type { SpeciesSchemaType } from '@arcadia-eternity/schema'

/**
 * 种族数据提供者接口
 * 用于为规则系统提供精灵种族数据
 */
export interface SpeciesDataProvider {
  /**
   * 根据种族ID获取种族数据
   * @param speciesId 种族ID
   * @returns 种族数据，如果不存在则返回undefined
   */
  getSpeciesById(speciesId: string): SpeciesSchemaType | undefined
}
