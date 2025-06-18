import type { ModifierInfo, AttributeModifierInfo } from '@arcadia-eternity/const'

/**
 * Modifier 效果类型
 */
export type ModifierEffectType =
  | 'none' // 无修改器
  | 'buffed' // 增益效果
  | 'debuffed' // 减益效果
  | 'clamped' // 限制效果
  | 'mixed' // 混合效果
  | 'neutral' // 中性效果

/**
 * 样式配置接口
 */
export interface ModifierStyleConfig {
  textColor: string
  description: string
}

/**
 * Modifier 样式配置
 */
export const MODIFIER_STYLES: Record<ModifierEffectType, ModifierStyleConfig> = {
  none: {
    textColor: 'text-white',
    description: '无修改器效果',
  },
  buffed: {
    textColor: 'text-green-400',
    description: '增益效果 - 属性得到提升',
  },
  debuffed: {
    textColor: 'text-red-400',
    description: '减益效果 - 属性被削弱',
  },
  clamped: {
    textColor: 'text-orange-400',
    description: '限制效果 - 属性被限制在特定范围',
  },
  mixed: {
    textColor: 'text-purple-400',
    description: '复合效果 - 同时存在多种修改器',
  },
  neutral: {
    textColor: 'text-blue-400',
    description: '中性效果 - 属性被修改但无明显倾向',
  },
}

/**
 * 属性评估策略类型
 */
export type AttributeEvaluationStrategy = 'benefit' | 'cost'

/**
 * 属性策略配置
 */
const ATTRIBUTE_STRATEGIES: Record<string, AttributeEvaluationStrategy> = {
  // 收益型属性 - 数值越高越好
  power: 'benefit',
  accuracy: 'benefit',
  priority: 'benefit',
  atk: 'benefit',
  def: 'benefit',
  spa: 'benefit',
  spd: 'benefit',
  spe: 'benefit',
  maxHp: 'benefit',
  currentHp: 'benefit',
  maxRage: 'benefit',
  currentRage: 'benefit',
  critRate: 'benefit',
  evasion: 'benefit',
  level: 'benefit',

  // 成本型属性 - 数值越低越好
  rage: 'cost',
}

/**
 * 获取属性的评估策略
 */
function getAttributeStrategy(attributeName: string): AttributeEvaluationStrategy {
  return ATTRIBUTE_STRATEGIES[attributeName] || 'benefit'
}

/**
 * 分析 modifier 效果类型（支持策略）
 */
export function analyzeModifierType(attributeInfo?: AttributeModifierInfo, attributeName?: string): ModifierEffectType {
  if (!attributeInfo?.isModified || !attributeInfo.modifiers?.length) {
    return 'none'
  }

  const modifiers = attributeInfo.modifiers
  const baseValue = attributeInfo.baseValue as number
  const currentValue = attributeInfo.currentValue as number

  // 获取属性策略，优先使用传入的属性名，否则使用 attributeInfo 中的
  const strategy = getAttributeStrategy(attributeName || attributeInfo.attributeName)

  // 检查是否有限制类型的修改器
  const hasClamp = modifiers.some(m => m.type === 'clampMax' || m.type === 'clampMin' || m.type === 'clamp')

  // 根据策略检查正面和负面效果
  const hasPositive = modifiers.some(m => {
    let isIncrease = false

    switch (m.type) {
      case 'delta':
        isIncrease = typeof m.value === 'number' && m.value > 0
        break
      case 'percent':
        isIncrease = typeof m.value === 'number' && m.value > 0
        break
      case 'override':
        isIncrease = typeof m.value === 'number' && m.value > baseValue
        break
      default:
        return false
    }

    // 根据策略判断增加是否为正面效果
    return strategy === 'benefit' ? isIncrease : !isIncrease
  })

  const hasNegative = modifiers.some(m => {
    let isDecrease = false

    switch (m.type) {
      case 'delta':
        isDecrease = typeof m.value === 'number' && m.value < 0
        break
      case 'percent':
        isDecrease = typeof m.value === 'number' && m.value < 0
        break
      case 'override':
        isDecrease = typeof m.value === 'number' && m.value < baseValue
        break
      default:
        return false
    }

    // 根据策略判断减少是否为负面效果
    return strategy === 'benefit' ? isDecrease : !isDecrease
  })

  // 根据最终值变化判断整体效果
  const valueIncreased = currentValue > baseValue
  const valueDecreased = currentValue < baseValue

  // 根据策略判断最终值变化的效果
  const finalPositive = strategy === 'benefit' ? valueIncreased : valueDecreased
  const finalNegative = strategy === 'benefit' ? valueDecreased : valueIncreased

  // 根据效果类型返回相应的类型
  if (hasClamp) return 'clamped'
  if (hasPositive && hasNegative) return 'mixed'
  if (hasPositive || finalPositive) return 'buffed'
  if (hasNegative || finalNegative) return 'debuffed'
  return 'neutral'
}

/**
 * 获取 modifier 样式类
 */
export function getModifierClasses(
  effectType: ModifierEffectType,
  size: 'sm' | 'md' | 'lg' = 'md',
  inline: boolean = false,
): string[] {
  const config = MODIFIER_STYLES[effectType]

  const baseClasses = ['transition-colors duration-300 ease-in-out', inline ? 'inline' : 'block']

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  }

  if (effectType === 'none') {
    return [...baseClasses, sizeClasses[size]]
  }

  return [...baseClasses, sizeClasses[size], config.textColor, 'font-semibold'].filter(Boolean)
}

/**
 * 获取 modifier 描述文本
 */
export function getModifierDescription(effectType: ModifierEffectType): string {
  return MODIFIER_STYLES[effectType].description
}

/**
 * 获取修改器类型的图标
 */
export function getModifierIcon(modifierType: string): string {
  const iconMap: Record<string, string> = {
    delta: '±',
    percent: '%',
    override: '→',
    clampMax: '↓',
    clampMin: '↑',
    clamp: '↕',
  }
  return iconMap[modifierType] || '?'
}

/**
 * 格式化修改器值显示
 */
export function formatModifierValue(modifier: ModifierInfo): string {
  const value = modifier.value

  switch (modifier.type) {
    case 'percent':
      return `${value > 0 ? '+' : ''}${value}%`
    case 'delta':
      return `${value > 0 ? '+' : ''}${value}`
    case 'override':
      return `→${value}`
    case 'clampMax':
      return `≤${value}`
    case 'clampMin':
      return `≥${value}`
    case 'clamp':
      return `[${modifier.value}]`
    default:
      return String(value)
  }
}

/**
 * 获取修改器优先级颜色
 */
export function getPriorityColor(priority: number): string {
  if (priority >= 10) return 'text-red-500'
  if (priority >= 5) return 'text-orange-500'
  if (priority >= 1) return 'text-yellow-500'
  return 'text-gray-500'
}
