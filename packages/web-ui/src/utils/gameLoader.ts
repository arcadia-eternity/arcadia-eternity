// src/utils/yamlLoader.ts
import { parse } from 'yaml'
import type { Schema } from 'yaml'

interface LoaderConfig {
  devBasePath: string
  prodBaseUrl: string
}

export class GameDataLoader {
  private config: LoaderConfig
  private schema?: Schema

  constructor(config: LoaderConfig) {
    this.config = config
  }

  async load<T>(dataType: string): Promise<T[]> {
    try {
      const url = import.meta.env.DEV
        ? `${this.config.devBasePath}/${dataType}.yaml`
        : `${this.config.prodBaseUrl}/api/${dataType}`

      const response = await fetch(url)
      const text = await response.text()
      return parse(text, { schema: this.schema }) as T[]
    } catch (error) {
      console.error(`加载 ${dataType} 数据失败:`, error)
      throw error
    }
  }
}
