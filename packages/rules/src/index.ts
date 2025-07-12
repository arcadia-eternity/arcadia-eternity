// 导出核心接口和类型
export * from './interfaces'

// 导出核心类
export * from './core'

// 导出所有规则
export * from './rules'

// 导出预定义规则集
export * from './rulesets'

// 导出系统集成
export * from './integration'

// 导出数据提供者
export * from './providers'

// 导出管理器
export { BattleRuleManager } from './battle/BattleRuleManager'
export { TeamBuilderRuleManager } from './teambuilder/TeamBuilderRuleManager'
export { GlobalRuleRegistry } from './global/GlobalRuleRegistry'

// 导出便捷函数
export { createRuleSystemWithDefaults, registerDefaultRules, getAvailableRuleSets } from './utils/defaults'
