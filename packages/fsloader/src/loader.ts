import fs from 'fs/promises'
import path, { dirname } from 'path'
import YAML from 'yaml'
import chokidar from 'chokidar'
import { DataRepository, ScriptLoader } from '@arcadia-eternity/data-repository'
import { extractMetadata } from '@arcadia-eternity/schema'
import { EffectParser, MarkParser, SkillParser, SpeciesParser } from '@arcadia-eternity/parser'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 增强类型定义
type FileCategory = 'effect' | 'mark' | 'skill' | 'species'

// 数据依赖关系定义
interface DataDependency {
  category: FileCategory
  dependsOn: FileCategory[]
  priority: number
}

const DATA_DEPENDENCIES: DataDependency[] = [
  { category: 'effect', dependsOn: [], priority: 1 },
  { category: 'mark', dependsOn: ['effect'], priority: 2 },
  { category: 'skill', dependsOn: ['effect', 'mark'], priority: 3 },
  { category: 'species', dependsOn: ['skill', 'mark'], priority: 4 },
]

// 热重载回调类型
type HotReloadCallback = (event: HotReloadEvent) => void | Promise<void>

// 热重载事件
interface HotReloadEvent {
  type: 'file-changed' | 'file-added' | 'file-removed' | 'reload-complete' | 'reload-error'
  category?: FileCategory
  filePath?: string
  error?: Error
  stats?: {
    reloadedFiles: number
    totalTime: number
    reloadedItems: string[]
  }
}

// 对象代理管理器
class ObjectProxyManager {
  private proxies = new Map<string, any>()
  private targets = new Map<string, any>()
  private subscribers = new Map<string, Set<(newValue: any) => void>>()

  // 创建代理对象
  createProxy<T>(id: string, target: T): T {
    if (this.proxies.has(id)) {
      // 更新现有代理的目标
      this.updateTarget(id, target)
      return this.proxies.get(id)
    }

    const proxy = new Proxy(target as any, {
      get: (_, prop) => {
        const currentTarget = this.targets.get(id) || target
        const value = (currentTarget as any)[prop]

        // 如果是函数，绑定正确的 this
        if (typeof value === 'function') {
          return value.bind(currentTarget)
        }
        return value
      },
      set: (_, prop, value) => {
        const currentTarget = this.targets.get(id) || target
        ;(currentTarget as any)[prop] = value
        return true
      },
      has: (_, prop) => {
        const currentTarget = this.targets.get(id) || target
        return prop in currentTarget
      },
      ownKeys: _ => {
        const currentTarget = this.targets.get(id) || target
        return Reflect.ownKeys(currentTarget)
      },
      getOwnPropertyDescriptor: (_, prop) => {
        const currentTarget = this.targets.get(id) || target
        return Reflect.getOwnPropertyDescriptor(currentTarget, prop)
      },
    })

    this.proxies.set(id, proxy)
    this.targets.set(id, target)
    return proxy
  }

  // 更新代理目标
  updateTarget(id: string, newTarget: any): void {
    this.targets.set(id, newTarget)

    // 通知订阅者
    const subs = this.subscribers.get(id)
    if (subs) {
      subs.forEach(callback => {
        try {
          callback(newTarget)
        } catch (error) {
          console.error(`代理更新回调失败 ${id}:`, error)
        }
      })
    }
  }

  // 订阅对象更新
  subscribe(id: string, callback: (newValue: any) => void): () => void {
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set())
    }
    this.subscribers.get(id)!.add(callback)

    // 返回取消订阅函数
    return () => {
      const subs = this.subscribers.get(id)
      if (subs) {
        subs.delete(callback)
        if (subs.size === 0) {
          this.subscribers.delete(id)
        }
      }
    }
  }

  // 清理代理
  cleanup(id: string): void {
    this.proxies.delete(id)
    this.targets.delete(id)
    this.subscribers.delete(id)
  }

  // 获取所有代理ID
  getAllProxyIds(): string[] {
    return Array.from(this.proxies.keys())
  }
}

// 加载策略配置
interface LoadingStrategy {
  validateDependencies: boolean
  validateCrossReferences: boolean
  allowPartialLoad: boolean
  continueOnError: boolean
  loadScripts: boolean // 是否加载脚本
  scriptPaths?: string[] // 脚本路径
  scriptBaseUrl?: string // 脚本基础URL (浏览器环境)
  // 热重载配置
  enableHotReload?: boolean // 是否启用热重载
  hotReloadDebounce?: number // 热重载防抖延迟（毫秒）
  hotReloadCallback?: HotReloadCallback // 热重载回调
  watchScripts?: boolean // 是否监控脚本文件变化
}

const DEFAULT_LOADING_STRATEGY: LoadingStrategy = {
  validateDependencies: true,
  validateCrossReferences: true,
  allowPartialLoad: false,
  continueOnError: false,
  loadScripts: false,
  enableHotReload: false,
  hotReloadDebounce: 300,
  watchScripts: true,
}

// 验证结果接口
interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

interface ValidationError {
  type: 'missing_dependency' | 'missing_reference' | 'circular_dependency' | 'parse_error'
  category: FileCategory
  file?: string
  itemId?: string
  referencedId?: string
  referencedType?: string
  message: string
}

interface ValidationWarning {
  type: 'unused_reference' | 'deprecated_reference'
  category: FileCategory
  itemId: string
  message: string
}

// 初始化数据仓库
const dataRepo = DataRepository.getInstance()

// 支持的文件前缀映射
const FILE_CATEGORIES: Record<string, FileCategory> = {
  effect: 'effect',
  mark: 'mark',
  skill: 'skill',
  species: 'species',
}

// 热重载管理器
class HotReloadManager {
  private watcher: ReturnType<typeof chokidar.watch> | null = null
  private dataDir: string
  private strategy: LoadingStrategy
  private debounceTimer: NodeJS.Timeout | null = null
  private reloadInProgress = false
  private scriptLoader: ScriptLoader | null = null

  constructor(dataDir: string, strategy: LoadingStrategy) {
    this.dataDir = dataDir
    this.strategy = strategy
  }

  // 启动热重载监控
  async start(): Promise<void> {
    if (this.watcher) {
      console.warn('⚠️ 热重载已经启动')
      return
    }

    console.log('🔥 启动热重载监控...')

    // 构建监控路径 - 直接监控目录，让 chokidar 处理 glob
    const watchPaths: string[] = [this.dataDir]

    // 如果启用脚本监控，添加脚本路径
    if (this.strategy.watchScripts && this.strategy.scriptPaths) {
      for (const scriptPath of this.strategy.scriptPaths) {
        watchPaths.push(path.resolve(scriptPath))
      }
    }

    this.watcher = chokidar.watch(watchPaths, {
      ignored: [
        /(^|[\/\\])\../, // 忽略隐藏文件
        '**/node_modules/**', // 忽略 node_modules
        '**/dist/**', // 忽略构建目录
        '**/*.backup', // 忽略备份文件
      ],
      persistent: true,
      ignoreInitial: true, // 忽略初始扫描
    })

    this.watcher
      .on('change', (filePath: string) => this.handleFileChange('file-changed', filePath))
      .on('add', (filePath: string) => this.handleFileChange('file-added', filePath))
      .on('unlink', (filePath: string) => this.handleFileChange('file-removed', filePath))
      .on('error', (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err))
        console.error('🔥 文件监控错误:', error)
        this.emitEvent({ type: 'reload-error', error })
      })

    console.log(`🔥 热重载监控已启动，监控路径: ${watchPaths.join(', ')}`)
  }

  // 停止热重载监控
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
      console.log('🔥 热重载监控已停止')
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  // 处理文件变化
  private handleFileChange(eventType: 'file-changed' | 'file-added' | 'file-removed', filePath: string): void {
    // 检查是否是我们关心的文件类型
    const isDataFile = /\.ya?ml$/.test(filePath)
    const isScriptFile = this.isScriptFile(filePath)

    if (!isDataFile && !isScriptFile) {
      return // 忽略不相关的文件
    }

    if (this.reloadInProgress) {
      console.log(`🔥 重载进行中，跳过文件变化: ${path.basename(filePath)}`)
      return
    }

    console.log(
      `🔥 检测到文件${eventType === 'file-changed' ? '变化' : eventType === 'file-added' ? '添加' : '删除'}: ${path.basename(filePath)}`,
    )

    // 发送文件变化事件
    const category = this.getFileCategory(filePath)
    this.emitEvent({ type: eventType, category: category || undefined, filePath })

    // 防抖处理
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.performReload(filePath)
    }, this.strategy.hotReloadDebounce || 300)
  }

  // 执行重载
  private async performReload(changedFilePath: string): Promise<void> {
    if (this.reloadInProgress) return

    this.reloadInProgress = true
    const startTime = Date.now()
    let reloadedFiles = 0
    const reloadedItems: string[] = []

    try {
      console.log('🔄 开始热重载...')

      // 判断是数据文件还是脚本文件
      const isScriptFile = this.isScriptFile(changedFilePath)

      if (isScriptFile && this.strategy.loadScripts) {
        // 重载脚本
        const scriptItems = await this.reloadScripts()
        reloadedFiles = 1
        reloadedItems.push(...scriptItems)
      } else {
        // 精细化重载：只重载单个文件
        const category = this.getFileCategory(changedFilePath)
        if (category) {
          const fileItems = await this.reloadSingleFile(changedFilePath, category)
          reloadedFiles = 1
          reloadedItems.push(...fileItems)
        }
      }

      const totalTime = Date.now() - startTime
      console.log(`✅ 热重载完成，耗时 ${totalTime}ms，重载了 ${reloadedItems.length} 个对象`)

      this.emitEvent({
        type: 'reload-complete',
        stats: { reloadedFiles, totalTime, reloadedItems },
      })
    } catch (error) {
      console.error('❌ 热重载失败:', error instanceof Error ? error.message : error)
      this.emitEvent({
        type: 'reload-error',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    } finally {
      this.reloadInProgress = false
    }
  }

  // 重载指定类别的数据
  private async reloadDataCategory(category: FileCategory): Promise<void> {
    console.log(`🔄 重载 ${category} 数据...`)

    // 清除该类别的现有数据
    this.clearCategoryData(category)

    // 重新加载该类别的所有文件
    const files = await fs.readdir(this.dataDir)
    const categoryFiles = files.filter(file => {
      if (!/\.ya?ml$/.test(file)) return false
      const prefix = file.split(/[._]/)[0]
      return FILE_CATEGORIES[prefix] === category
    })

    for (const file of categoryFiles) {
      await loadDataFile(path.join(this.dataDir, file), category, this.strategy)
    }
  }

  // 重载脚本
  private async reloadScripts(): Promise<string[]> {
    console.log('🔄 重载脚本...')

    // 清除现有脚本声明
    dataRepo.clearScriptDeclarations()

    // 重新加载脚本
    if (!this.scriptLoader) {
      this.scriptLoader = new ScriptLoader({
        scriptPaths: this.strategy.scriptPaths || ['./scripts'],
        recursive: true,
      })
    }

    const reloadedItems: string[] = []
    if (this.strategy.scriptPaths) {
      for (const scriptPath of this.strategy.scriptPaths) {
        await this.scriptLoader.loadScriptsFromFileSystem(scriptPath)
      }

      // 获取重载的脚本声明
      const declarations = dataRepo.getScriptDeclarations()
      reloadedItems.push(...declarations.map(d => `${d.type}:${d.id}`))
    }

    return reloadedItems
  }

  // 重载单个文件（精细化重载）
  private async reloadSingleFile(filePath: string, category: FileCategory): Promise<string[]> {
    console.log(`🔄 重载单个文件: ${path.basename(filePath)} (${category})`)

    // 启用热重载代理（如果还没有启用）
    dataRepo.enableHotReloadForExistingObjects()

    // 重新加载单个文件
    const reloadedItems: string[] = []

    try {
      // 读取并解析文件
      const fileContent = await fs.readFile(filePath, 'utf-8')
      const documents = YAML.parseAllDocuments(fileContent)

      for (const doc of documents) {
        if (doc.errors.length > 0) {
          console.warn(`⚠️ YAML 解析警告 ${path.basename(filePath)}:`, doc.errors)
        }

        const data = doc.toJS()
        if (!data || typeof data !== 'object') continue

        // 处理单个数据项或数组
        const items = Array.isArray(data) ? data : [data]

        for (const item of items) {
          if (!item || typeof item !== 'object') continue

          try {
            const itemId = await this.reloadSingleItem(item, category)
            if (itemId) {
              reloadedItems.push(`${category}:${itemId}`)
            }
          } catch (error) {
            console.error(`❌ 重载项目失败:`, error instanceof Error ? error.message : error)
            if (!this.strategy.continueOnError) {
              throw error
            }
          }
        }
      }
    } catch (error) {
      console.error(`❌ 重载文件失败 ${path.basename(filePath)}:`, error instanceof Error ? error.message : error)
      if (!this.strategy.continueOnError) {
        throw error
      }
    }

    return reloadedItems
  }

  // 重载单个数据项
  private async reloadSingleItem(item: any, category: FileCategory): Promise<string | null> {
    switch (category) {
      case 'effect':
        const effect = EffectParser.parse(item)
        dataRepo.registerEffect(effect.id, effect, true) // allowUpdate = true
        return effect.id
      case 'mark':
        const mark = MarkParser.parse({
          ...item,
          type: 'base', // 默认类型，可以根据需要调整
        })
        dataRepo.registerMark(mark.id, mark, true)
        return mark.id
      case 'skill':
        const skill = SkillParser.parse(item)
        dataRepo.registerSkill(skill.id, skill, true)
        return skill.id
      case 'species':
        const species = SpeciesParser.parse(item)
        dataRepo.registerSpecies(species.id, species, true)
        return species.id
      default:
        return null
    }
  }

  // 清除指定类别的数据
  private clearCategoryData(category: FileCategory): void {
    switch (category) {
      case 'effect':
        dataRepo.effects.clear()
        break
      case 'mark':
        dataRepo.marks.clear()
        break
      case 'skill':
        dataRepo.skills.clear()
        break
      case 'species':
        dataRepo.species.clear()
        break
    }
  }

  // 获取文件类别
  private getFileCategory(filePath: string): FileCategory | null {
    const fileName = path.basename(filePath)
    if (!/\.ya?ml$/.test(fileName)) return null

    const prefix = fileName.split(/[._]/)[0]
    return FILE_CATEGORIES[prefix] || null
  }

  // 判断是否为脚本文件
  private isScriptFile(filePath: string): boolean {
    return /\.(js|mjs|ts)$/.test(filePath)
  }

  // 统计类别文件数量
  private async countCategoryFiles(category: FileCategory): Promise<number> {
    try {
      const files = await fs.readdir(this.dataDir)
      return files.filter(file => {
        if (!/\.ya?ml$/.test(file)) return false
        const prefix = file.split(/[._]/)[0]
        return FILE_CATEGORIES[prefix] === category
      }).length
    } catch {
      return 0
    }
  }

  // 发送事件
  private emitEvent(event: HotReloadEvent): void {
    if (this.strategy.hotReloadCallback) {
      try {
        const result = this.strategy.hotReloadCallback(event)
        if (result instanceof Promise) {
          result.catch(error => {
            console.error('🔥 热重载回调执行失败:', error)
          })
        }
      } catch (error) {
        console.error('🔥 热重载回调执行失败:', error)
      }
    }
  }
}

// 交叉引用验证函数 - 验证已解析的数据对象
function validateCrossReferences(): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // 验证技能引用的效果 (BaseSkill.effects)
  for (const skill of dataRepo.skills.values()) {
    if (skill.effects && skill.effects.length > 0) {
      for (const effect of skill.effects) {
        if (!dataRepo.effects.has(effect.id)) {
          errors.push({
            type: 'missing_reference',
            category: 'skill',
            itemId: skill.id,
            referencedId: effect.id,
            referencedType: 'effect',
            message: `技能 ${skill.id} 引用了不存在的效果 ${effect.id}`,
          })
        }
      }
    }
  }

  // 验证标记引用的效果 (BaseMark.effects)
  for (const mark of dataRepo.marks.values()) {
    if (mark.effects && mark.effects.length > 0) {
      for (const effect of mark.effects) {
        if (!dataRepo.effects.has(effect.id)) {
          errors.push({
            type: 'missing_reference',
            category: 'mark',
            itemId: mark.id,
            referencedId: effect.id,
            referencedType: 'effect',
            message: `标记 ${mark.id} 引用了不存在的效果 ${effect.id}`,
          })
        }
      }
    }
  }

  // 验证物种引用的技能和标记
  for (const species of dataRepo.species.values()) {
    // 验证能力标记
    if (species.ability) {
      for (const abilityMark of species.ability) {
        if (!dataRepo.marks.has(abilityMark.id)) {
          errors.push({
            type: 'missing_reference',
            category: 'species',
            itemId: species.id,
            referencedId: abilityMark.id,
            referencedType: 'mark',
            message: `物种 ${species.id} 引用了不存在的能力标记 ${abilityMark.id}`,
          })
        }
      }
    }

    // 验证徽章标记
    if (species.emblem) {
      for (const emblemMark of species.emblem) {
        if (!dataRepo.marks.has(emblemMark.id)) {
          errors.push({
            type: 'missing_reference',
            category: 'species',
            itemId: species.id,
            referencedId: emblemMark.id,
            referencedType: 'mark',
            message: `物种 ${species.id} 引用了不存在的徽章标记 ${emblemMark.id}`,
          })
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

// 验证原始数据的交叉引用 - 在解析前验证
function validateRawDataReferences(rawData: any[], category: FileCategory): ValidationError[] {
  const errors: ValidationError[] = []

  for (const item of rawData) {
    switch (category) {
      case 'skill':
        // 验证技能的effect字段
        if (item.effect && Array.isArray(item.effect)) {
          for (const effectId of item.effect) {
            if (!dataRepo.effects.has(effectId)) {
              errors.push({
                type: 'missing_reference',
                category: 'skill',
                itemId: item.id,
                referencedId: effectId,
                referencedType: 'effect',
                message: `技能 ${item.id} 引用了不存在的效果 ${effectId}`,
              })
            }
          }
        }
        break

      case 'mark':
        // 验证标记的effect字段
        if (item.effect && Array.isArray(item.effect)) {
          for (const effectId of item.effect) {
            if (!dataRepo.effects.has(effectId)) {
              errors.push({
                type: 'missing_reference',
                category: 'mark',
                itemId: item.id,
                referencedId: effectId,
                referencedType: 'effect',
                message: `标记 ${item.id} 引用了不存在的效果 ${effectId}`,
              })
            }
          }
        }
        break

      case 'species':
        // 验证物种的learnable_skills字段
        if (item.learnable_skills && Array.isArray(item.learnable_skills)) {
          for (const learnableSkill of item.learnable_skills) {
            if (!dataRepo.skills.has(learnableSkill.skill_id)) {
              errors.push({
                type: 'missing_reference',
                category: 'species',
                itemId: item.id,
                referencedId: learnableSkill.skill_id,
                referencedType: 'skill',
                message: `物种 ${item.id} 引用了不存在的技能 ${learnableSkill.skill_id}`,
              })
            }
          }
        }

        // 验证能力标记
        if (item.ability && Array.isArray(item.ability)) {
          for (const abilityId of item.ability) {
            if (!dataRepo.marks.has(abilityId)) {
              errors.push({
                type: 'missing_reference',
                category: 'species',
                itemId: item.id,
                referencedId: abilityId,
                referencedType: 'mark',
                message: `物种 ${item.id} 引用了不存在的能力标记 ${abilityId}`,
              })
            }
          }
        }

        // 验证徽章标记
        if (item.emblem && Array.isArray(item.emblem)) {
          for (const emblemId of item.emblem) {
            if (!dataRepo.marks.has(emblemId)) {
              errors.push({
                type: 'missing_reference',
                category: 'species',
                itemId: item.id,
                referencedId: emblemId,
                referencedType: 'mark',
                message: `物种 ${item.id} 引用了不存在的徽章标记 ${emblemId}`,
              })
            }
          }
        }
        break
    }
  }

  return errors
}

// 验证脚本和数据之间的交叉引用
function validateScriptDataCrossReferences(): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // 获取脚本声明
  const scriptDeclarations = dataRepo.getScriptDeclarations()

  // 检查脚本定义的数据是否与YAML数据冲突
  for (const declaration of scriptDeclarations) {
    const existingData = (() => {
      switch (declaration.type) {
        case 'effect':
          return dataRepo.effects.get(declaration.id)
        case 'mark':
          return dataRepo.marks.get(declaration.id)
        case 'skill':
          return dataRepo.skills.get(declaration.id)
        case 'species':
          return dataRepo.species.get(declaration.id)
        default:
          return undefined
      }
    })()

    if (existingData && existingData !== declaration.instance) {
      warnings.push({
        type: 'deprecated_reference',
        category: declaration.type as FileCategory,
        itemId: declaration.id,
        message: `${declaration.type} ${declaration.id} 同时在脚本和数据文件中定义，脚本定义将覆盖数据文件定义`,
      })
    }
  }

  // 检查数据文件引用的脚本定义
  for (const skill of dataRepo.skills.values()) {
    if (skill.effects && skill.effects.length > 0) {
      for (const effect of skill.effects) {
        // 检查是否为脚本定义的效果
        const scriptDeclaration = scriptDeclarations.find(decl => decl.type === 'effect' && decl.id === effect.id)
        if (scriptDeclaration) {
          // 这是正常的脚本引用，记录为信息
          console.log(`ℹ️ 技能 ${skill.id} 引用了脚本定义的效果 ${effect.id}`)
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

// 获取依赖排序的加载顺序
function getDependencyOrder(availableCategories: FileCategory[]): FileCategory[] {
  const dependencies = DATA_DEPENDENCIES.filter(dep => availableCategories.includes(dep.category))

  // 按优先级排序
  dependencies.sort((a, b) => a.priority - b.priority)

  // 验证循环依赖
  const visited = new Set<FileCategory>()
  const visiting = new Set<FileCategory>()

  function hasCyclicDependency(category: FileCategory): boolean {
    if (visiting.has(category)) return true
    if (visited.has(category)) return false

    visiting.add(category)
    const dep = dependencies.find(d => d.category === category)
    if (dep) {
      for (const depCategory of dep.dependsOn) {
        if (availableCategories.includes(depCategory) && hasCyclicDependency(depCategory)) {
          return true
        }
      }
    }
    visiting.delete(category)
    visited.add(category)
    return false
  }

  for (const category of availableCategories) {
    if (hasCyclicDependency(category)) {
      throw new Error(`检测到循环依赖: ${category}`)
    }
  }

  return dependencies.map(dep => dep.category)
}

// 核心加载逻辑
async function loadDataFile(
  filePath: string,
  category: FileCategory,
  strategy: LoadingStrategy = DEFAULT_LOADING_STRATEGY,
) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const metadata = extractMetadata(content)

    // 元数据校验
    if (metadata.metaType !== category) {
      throw new Error(`元数据类型不匹配: 文件类型 ${category}, 元数据类型 ${metadata.metaType}`)
    }

    // YAML 解析
    const data = YAML.parse(content, {
      merge: true,
    })

    // 验证原始数据的交叉引用
    if (strategy.validateCrossReferences) {
      const referenceErrors = validateRawDataReferences(data, category)
      if (referenceErrors.length > 0) {
        if (!strategy.continueOnError) {
          const errorMessages = referenceErrors.map(err => err.message).join('\n')
          throw new Error(`交叉引用验证失败:\n${errorMessages}`)
        } else {
          console.warn(`⚠️ 发现 ${referenceErrors.length} 个交叉引用错误，但继续加载:`)
          referenceErrors.forEach(err => console.warn(`  - ${err.message}`))
        }
      }
    }

    // 数据校验与注册
    switch (category) {
      case 'mark':
        for (const item of data) {
          const mark = MarkParser.parse({
            ...item,
            type: path.basename(filePath, '.yaml').split('_')[1] || 'base',
          })
          dataRepo.registerMark(mark.id, mark)
        }
        break
      case 'effect':
        for (const item of data) {
          const effect = EffectParser.parse(item)
          DataRepository.getInstance().registerEffect(effect.id, effect)
        }
        break
      case 'skill':
        for (const item of data) {
          const skill = SkillParser.parse(item)
          DataRepository.getInstance().registerSkill(skill.id, skill)
        }
        break
      case 'species':
        for (const item of data) {
          const species = SpeciesParser.parse(item)
          DataRepository.getInstance().registerSpecies(species.id, species)
        }
        break
    }

    console.log(`✅ 成功加载 ${path.basename(filePath)} (${data.length} 条记录)`)
  } catch (error) {
    console.error(`💥 加载失败 ${path.basename(filePath)}:`, error instanceof Error ? error.message : error)
    if (!strategy.continueOnError) {
      throw error // 向上传递错误
    }
  }
}

// 增强的游戏数据加载函数
export async function loadGameData(
  dataDir = path.join(__dirname, '../../../data'),
  strategy: LoadingStrategy = DEFAULT_LOADING_STRATEGY,
): Promise<HotReloadManager | null> {
  try {
    const files = await fs.readdir(dataDir)

    // 按类型分组文件
    const fileGroups: Record<FileCategory, string[]> = {
      effect: [],
      mark: [],
      skill: [],
      species: [],
    }

    // 分类文件到对应分组
    for (const file of files) {
      if (!/\.ya?ml$/.test(file)) continue

      const prefix = file.split(/[._]/)[0]
      const category = FILE_CATEGORIES[prefix]

      if (category && fileGroups[category]) {
        fileGroups[category].push(file)
      } else {
        console.warn(`⚠️ 忽略未注册类型文件: ${file}`)
      }
    }

    // 获取可用的数据类型
    const availableCategories = Object.keys(fileGroups).filter(
      category => fileGroups[category as FileCategory].length > 0,
    ) as FileCategory[]

    // 根据依赖关系确定加载顺序
    const loadOrder = strategy.validateDependencies ? getDependencyOrder(availableCategories) : availableCategories

    console.log(`📋 数据加载顺序: ${loadOrder.join(' → ')}`)

    // 按依赖顺序加载
    for (const category of loadOrder) {
      const categoryFiles = fileGroups[category]
      if (categoryFiles.length === 0) continue

      console.log(`⏳ 开始加载 ${category} 数据...`)

      // 根据策略选择并行或串行加载
      if (strategy.validateCrossReferences) {
        // 串行加载以便及时发现依赖问题
        for (const file of categoryFiles) {
          await loadDataFile(path.join(dataDir, file), category, strategy)
        }
      } else {
        // 并行加载以提高性能
        await Promise.all(categoryFiles.map(file => loadDataFile(path.join(dataDir, file), category, strategy)))
      }

      console.log(`✅ 完成加载 ${category} 数据`)
    }

    // 加载脚本定义
    if (strategy.loadScripts) {
      console.log('📜 开始加载脚本定义...')

      try {
        const scriptLoader = new ScriptLoader({
          scriptPaths: strategy.scriptPaths || ['./scripts'],
          recursive: true,
        })

        if (typeof (globalThis as any).window === 'undefined') {
          // Node.js环境 - 从文件系统加载
          if (strategy.scriptPaths) {
            for (const scriptPath of strategy.scriptPaths) {
              await scriptLoader.loadScriptsFromFileSystem(scriptPath)
            }
          }
        } else {
          // 浏览器环境 - 从HTTP加载
          if (strategy.scriptBaseUrl && strategy.scriptPaths) {
            await scriptLoader.loadScriptsFromHttp(strategy.scriptBaseUrl, strategy.scriptPaths)
          }
        }

        // 输出脚本加载统计
        const scriptStats = scriptLoader.getLoadedScriptsStats()
        console.log('📊 脚本加载统计:')
        console.log(`  - 总计: ${scriptStats.total} 个`)
        console.log(`  - 效果: ${scriptStats.byType.effect} 个`)
        console.log(`  - 标记: ${scriptStats.byType.mark} 个`)
        console.log(`  - 技能: ${scriptStats.byType.skill} 个`)
        console.log(`  - 物种: ${scriptStats.byType.species} 个`)

        console.log('✅ 脚本加载完成')
      } catch (error) {
        console.error('❌ 脚本加载失败:', error instanceof Error ? error.message : error)
        if (!strategy.continueOnError) {
          throw error
        }
      }
    }

    // 最终验证 (包括脚本定义的数据)
    if (strategy.validateCrossReferences) {
      console.log('🔍 执行最终交叉引用验证...')
      const validationResult = validateCrossReferences()

      // 如果加载了脚本，还要验证脚本和数据的交叉引用
      let scriptValidationResult: ValidationResult | null = null
      if (strategy.loadScripts) {
        console.log('🔍 执行脚本-数据交叉引用验证...')
        scriptValidationResult = validateScriptDataCrossReferences()
      }

      // 合并验证结果
      const allErrors = [...validationResult.errors, ...(scriptValidationResult?.errors || [])]
      const allWarnings = [...validationResult.warnings, ...(scriptValidationResult?.warnings || [])]

      if (allErrors.length > 0) {
        console.error('❌ 发现交叉引用错误:')
        allErrors.forEach(error => {
          console.error(`  - ${error.message}`)
        })

        if (!strategy.continueOnError) {
          throw new Error(`发现 ${allErrors.length} 个交叉引用错误`)
        }
      }

      if (allWarnings.length > 0) {
        console.warn('⚠️ 发现警告:')
        allWarnings.forEach(warning => {
          console.warn(`  - ${warning.message}`)
        })
      }
    }

    // 输出加载统计
    console.log('📊 数据加载统计:')
    console.log(`  - 效果: ${dataRepo.effects.size} 个`)
    console.log(`  - 标记: ${dataRepo.marks.size} 个`)
    console.log(`  - 技能: ${dataRepo.skills.size} 个`)
    console.log(`  - 物种: ${dataRepo.species.size} 个`)

    console.log('🎉 所有数据加载完成')

    // 启动热重载（仅在 Node.js 环境且启用热重载时）
    let hotReloadManager: HotReloadManager | null = null
    if (strategy.enableHotReload && typeof (globalThis as any).window === 'undefined') {
      try {
        // 为现有对象启用代理
        dataRepo.enableHotReloadForExistingObjects()
        console.log('🔥 已为现有对象启用热重载代理')

        // 输出代理统计
        const proxyStats = dataRepo.getProxyStats()
        console.log('📊 代理统计:', proxyStats)

        hotReloadManager = new HotReloadManager(dataDir, strategy)
        await hotReloadManager.start()
      } catch (error) {
        console.error('🔥 热重载启动失败:', error instanceof Error ? error.message : error)
        if (!strategy.continueOnError) {
          throw error
        }
      }
    }

    return hotReloadManager
  } catch (error) {
    console.error('🔥 数据初始化失败:', error instanceof Error ? error.message : error)
    if (!strategy.continueOnError) {
      process.exit(1)
    }
    return null
  }
}

// 导出配置选项供外部使用
export type { LoadingStrategy, ValidationResult, ValidationError, ValidationWarning, HotReloadEvent, HotReloadCallback }
export { HotReloadManager }

// 预设的加载策略
export const LOADING_STRATEGIES = {
  // 严格模式：完整验证，遇到错误停止
  STRICT: {
    validateDependencies: true,
    validateCrossReferences: true,
    allowPartialLoad: false,
    continueOnError: false,
    loadScripts: false,
  } as LoadingStrategy,

  // 宽松模式：基本验证，遇到错误继续
  LENIENT: {
    validateDependencies: true,
    validateCrossReferences: false,
    allowPartialLoad: true,
    continueOnError: true,
    loadScripts: false,
  } as LoadingStrategy,

  // 快速模式：跳过验证，最快加载
  FAST: {
    validateDependencies: false,
    validateCrossReferences: false,
    allowPartialLoad: true,
    continueOnError: true,
    loadScripts: false,
  } as LoadingStrategy,

  // 完整模式：数据+脚本，完整验证
  FULL: {
    validateDependencies: true,
    validateCrossReferences: true,
    allowPartialLoad: false,
    continueOnError: false,
    loadScripts: true,
    scriptPaths: ['./scripts'],
  } as LoadingStrategy,

  // 开发模式：数据+脚本，宽松验证
  DEVELOPMENT: {
    validateDependencies: true,
    validateCrossReferences: true,
    allowPartialLoad: true,
    continueOnError: true,
    loadScripts: true,
    scriptPaths: ['./scripts'],
  } as LoadingStrategy,

  // 开发热重载模式：数据+脚本+热重载
  DEVELOPMENT_HOT: {
    validateDependencies: true,
    validateCrossReferences: true,
    allowPartialLoad: true,
    continueOnError: true,
    loadScripts: true,
    scriptPaths: ['./scripts'],
    enableHotReload: true,
    hotReloadDebounce: 300,
    watchScripts: true,
  } as LoadingStrategy,
}
