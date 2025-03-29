import axios from 'axios'

interface LoaderConfig {
  devBasePath: string
  prodBaseUrl: string
}
export class GameDataLoader {
  private config: LoaderConfig

  constructor(config: LoaderConfig) {
    this.config = config
  }

  async load<T>(dataType: string): Promise<T> {
    try {
      const basePath = import.meta.env.DEV ? this.config.devBasePath : this.config.prodBaseUrl

      // 构建 JSON 文件路径
      const targetUrl = `${basePath}/${dataType}.json`

      // 获取并解析 JSON
      const response = await axios.get<T>(targetUrl, {
        validateStatus: status => status >= 200 && status < 300,
        responseType: 'json',
      })

      // 确保返回数组格式
      return response.data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status
        const url = error.config?.url
        console.error(`[${status}] 加载 JSON 文件失败: ${url}`, error.message)
      } else {
        console.error(`加载 ${dataType} 数据失败:`, error)
      }
      throw new Error(`加载 ${dataType} 数据失败`)
    }
  }
}
