import { DataRepository } from './dataRepository.js'

export interface ScriptLoaderConfig {
  scriptPaths?: string[]
  baseUrl?: string
  recursive?: boolean
}

export class ScriptLoader {
  private config: ScriptLoaderConfig
  private dataRepo: DataRepository

  constructor(config: ScriptLoaderConfig = {}) {
    this.config = {
      recursive: true,
      ...config,
    }
    this.dataRepo = DataRepository.getInstance()
  }

  // Node.js环境下的脚本加载
  async loadScriptsFromFileSystem(scriptDir: string): Promise<void> {
    if (typeof window !== 'undefined') {
      throw new Error('loadScriptsFromFileSystem can only be used in Node.js environment')
    }

    const fs = await import('fs/promises')
    const path = await import('path')

    try {
      const allFiles = await this.findScriptFiles(scriptDir, fs, path)
      const files = this.filterDuplicateScripts(allFiles)
      console.log(`🔍 发现 ${allFiles.length} 个脚本文件，过滤后 ${files.length} 个`)

      for (const file of files) {
        await this.loadScriptFile(file)
      }

      console.log(`✅ 成功加载 ${files.length} 个脚本文件`)
    } catch (error) {
      console.error('❌ 脚本加载失败:', error)
      throw error
    }
  }

  // 浏览器环境下的脚本加载
  async loadScriptsFromHttp(baseUrl: string, scriptPaths: string[]): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('loadScriptsFromHttp can only be used in browser environment')
    }

    console.log(`🔍 开始从 ${baseUrl} 加载 ${scriptPaths.length} 个脚本`)

    for (const scriptPath of scriptPaths) {
      try {
        const fullUrl = `${baseUrl}/${scriptPath}`
        await this.loadScriptFromUrl(fullUrl)
      } catch (error) {
        console.error(`❌ 加载脚本失败: ${scriptPath}`, error)
        throw error
      }
    }

    console.log(`✅ 成功加载 ${scriptPaths.length} 个脚本`)
  }

  // 递归查找脚本文件
  private async findScriptFiles(
    dir: string,
    fs: typeof import('fs/promises'),
    path: typeof import('path'),
  ): Promise<string[]> {
    const files: string[] = []
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory() && this.config.recursive) {
        const subFiles = await this.findScriptFiles(fullPath, fs, path)
        files.push(...subFiles)
      } else if (entry.isFile() && this.isScriptFile(entry.name)) {
        files.push(fullPath)
      }
    }

    return files
  }

  // 检查是否为脚本文件
  private isScriptFile(filename: string): boolean {
    return /\.(ts|js|mjs)$/.test(filename) && !filename.endsWith('.d.ts')
  }

  // 过滤重复的脚本文件（优先选择JS文件而不是TS文件）
  private filterDuplicateScripts(files: string[]): string[] {
    const fileMap = new Map<string, string>()

    for (const file of files) {
      const baseName = file.replace(/\.(ts|js|mjs)$/, '')
      const extension = file.match(/\.(ts|js|mjs)$/)?.[1]

      if (!fileMap.has(baseName)) {
        fileMap.set(baseName, file)
      } else {
        // 如果已存在，优先选择JS文件
        const existing = fileMap.get(baseName)!
        const existingExt = existing.match(/\.(ts|js|mjs)$/)?.[1]

        if (extension === 'js' && existingExt === 'ts') {
          fileMap.set(baseName, file)
        } else if (extension === 'mjs' && (existingExt === 'ts' || existingExt === 'js')) {
          fileMap.set(baseName, file)
        }
      }
    }

    return Array.from(fileMap.values())
  }

  // 加载单个脚本文件
  private async loadScriptFile(filePath: string): Promise<void> {
    try {
      console.log(`📄 加载脚本: ${filePath}`)

      // 转换为绝对路径和file:// URL
      const path = await import('path')
      const { fileURLToPath, pathToFileURL } = await import('url')
      const absolutePath = path.resolve(filePath)
      const fileUrl = pathToFileURL(absolutePath).href

      // 动态导入脚本
      const module = await import(/* @vite-ignore */ fileUrl)

      // 脚本加载后，声明会自动注册到DataRepository
      console.log(`✅ 脚本加载成功: ${filePath}`)
    } catch (error) {
      console.error(`❌ 脚本加载失败: ${filePath}`, error)
      throw new Error(`Failed to load script ${filePath}: ${error instanceof Error ? error.message : error}`)
    }
  }

  // 从URL加载脚本
  private async loadScriptFromUrl(url: string): Promise<void> {
    try {
      console.log(`🌐 加载脚本: ${url}`)

      // 在浏览器中动态导入
      const module = await import(/* @vite-ignore */ url)

      console.log(`✅ 脚本加载成功: ${url}`)
    } catch (error) {
      console.error(`❌ 脚本加载失败: ${url}`, error)
      throw new Error(`Failed to load script from ${url}: ${error instanceof Error ? error.message : error}`)
    }
  }

  // 获取已加载的脚本声明统计
  getLoadedScriptsStats() {
    const declarations = this.dataRepo.getScriptDeclarations()
    const stats = {
      total: declarations.length,
      byType: {
        effect: 0,
        species: 0,
        skill: 0,
        mark: 0,
      },
    }

    declarations.forEach(decl => {
      stats.byType[decl.type]++
    })

    return stats
  }

  // 清理已加载的脚本
  clearLoadedScripts() {
    this.dataRepo.clearScriptDeclarations()
  }
}

// 便捷函数
export async function loadScripts(config: ScriptLoaderConfig): Promise<ScriptLoader> {
  const loader = new ScriptLoader(config)

  if ((typeof window as any) === 'undefined') {
    // Node.js环境
    if (config.scriptPaths && config.scriptPaths.length > 0) {
      for (const scriptPath of config.scriptPaths) {
        await loader.loadScriptsFromFileSystem(scriptPath)
      }
    }
  } else {
    // 浏览器环境
    if (config.baseUrl && config.scriptPaths) {
      await loader.loadScriptsFromHttp(config.baseUrl, config.scriptPaths)
    }
  }

  return loader
}
