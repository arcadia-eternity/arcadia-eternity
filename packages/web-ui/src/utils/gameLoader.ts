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
      // 使用 Vite 的 glob 导入功能
      const modules = import.meta.env.DEV
        ? import.meta.glob('@data/**/*.yaml', {
            import: 'default',
            eager: false, // 开发环境使用动态导入
          })
        : import.meta.glob('@data/**/*.yaml', {
            import: 'default',
            eager: true, // 生产环境使用静态导入
          })

      // 过滤目标文件
      const matchedPaths = Object.keys(modules).filter(
        path => path.includes(`/${dataType}.yaml`) || path.includes(`/${dataType}/`),
      )

      // 加载模块内容
      const results = await Promise.all(
        matchedPaths.map(async path => {
          const module = modules[path]
          return import.meta.env.DEV
            ? await (module as () => Promise<any>)() // 开发环境异步加载
            : module // 生产环境直接获取
        }),
      )

      // 合并数据
      return results.flatMap(r => (Array.isArray(r) ? r : [r])) as T[]
    } catch (error) {
      console.error(`加载 ${dataType} 数据失败:`, error)
      throw error
    }
  }
}
