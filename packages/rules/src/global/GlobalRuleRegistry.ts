import { RuleRegistry } from '../core/RuleRegistry'
import { registerDefaultRules, validateRuleSystemSetup } from '../utils/defaults'

/**
 * 全局规则注册表管理器
 * 负责初始化和管理全局规则注册表，但不管理具体的战斗规则
 */
export class GlobalRuleRegistry {
  private static isInitialized: boolean = false

  /**
   * 初始化全局规则注册表
   * 这个方法应该在应用启动时调用一次
   */
  static async initialize(): Promise<void> {
    if (GlobalRuleRegistry.isInitialized) {
      return
    }

    try {
      const registry = RuleRegistry.getInstance()
      
      // 注册默认规则和规则集
      registerDefaultRules(registry)
      
      // 验证注册表
      const validation = validateRuleSystemSetup(registry)
      if (!validation.isValid) {
        console.error('规则注册表初始化失败:', validation.errors)
        throw new Error('规则注册表初始化失败: ' + validation.errors.join(', '))
      }

      GlobalRuleRegistry.isInitialized = true
      console.log('全局规则注册表初始化成功', validation.stats)
    } catch (error) {
      console.error('全局规则注册表初始化失败:', error)
      throw error
    }
  }

  /**
   * 获取全局规则注册表实例
   */
  static getRegistry(): RuleRegistry {
    if (!GlobalRuleRegistry.isInitialized) {
      throw new Error('全局规则注册表尚未初始化，请先调用 GlobalRuleRegistry.initialize()')
    }
    return RuleRegistry.getInstance()
  }

  /**
   * 检查是否已初始化
   */
  static isReady(): boolean {
    return GlobalRuleRegistry.isInitialized
  }

  /**
   * 获取注册表状态
   */
  static getStatus() {
    if (!GlobalRuleRegistry.isInitialized) {
      return {
        isInitialized: false,
        error: '尚未初始化',
      }
    }

    const registry = RuleRegistry.getInstance()
    const validation = validateRuleSystemSetup(registry)
    
    return {
      isInitialized: true,
      validation,
      availableRuleSets: registry.getAllRuleSets().map(ruleSet => ({
        id: ruleSet.id,
        name: ruleSet.name,
        description: ruleSet.description,
        enabled: ruleSet.enabled,
        ruleCount: ruleSet.rules.length,
      })),
    }
  }

  /**
   * 重置注册表（主要用于测试）
   */
  static reset(): void {
    const registry = RuleRegistry.getInstance()
    registry.clear()
    GlobalRuleRegistry.isInitialized = false
  }
}
