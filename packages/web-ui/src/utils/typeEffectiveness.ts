import { ELEMENT_CHART, Element } from '@arcadia-eternity/const'
import type { SkillMessage, PetMessage } from '@arcadia-eternity/const'

/**
 * 属性相性效果类型
 */
export type TypeEffectivenessType = 'super-effective' | 'not-very-effective' | 'no-effect' | 'normal'

/**
 * 属性相性效果配置
 */
export interface TypeEffectivenessConfig {
  type: TypeEffectivenessType
  multiplier: number
  bgColor: string
  description: string
}

/**
 * 属性相性效果样式配置
 */
export const TYPE_EFFECTIVENESS_STYLES: Record<TypeEffectivenessType, TypeEffectivenessConfig> = {
  'super-effective': {
    type: 'super-effective',
    multiplier: 2,
    bgColor: 'bg-red-500/30',
    description: '效果拔群',
  },
  'not-very-effective': {
    type: 'not-very-effective',
    multiplier: 0.5,
    bgColor: 'bg-blue-900/30',
    description: '效果不佳',
  },
  'no-effect': {
    type: 'no-effect',
    multiplier: 0,
    bgColor: 'bg-gray-600/30',
    description: '没有效果',
  },
  normal: {
    type: 'normal',
    multiplier: 1,
    bgColor: '',
    description: '普通效果',
  },
}

/**
 * 计算属性相性效果类型
 */
export function getTypeEffectivenessType(multiplier: number): TypeEffectivenessType {
  if (multiplier === 0) return 'no-effect'
  if (multiplier > 1) return 'super-effective'
  if (multiplier < 1) return 'not-very-effective'
  return 'normal'
}

/**
 * 计算技能对目标精灵的属性相性倍率
 */
export function calculateTypeEffectiveness(skillElement: Element, targetElement: Element): number {
  const effectiveness = ELEMENT_CHART[skillElement]?.[targetElement]
  return effectiveness !== undefined ? effectiveness : 1
}

/**
 * 获取属性相性效果配置
 */
export function getTypeEffectivenessConfig(multiplier: number): TypeEffectivenessConfig {
  const type = getTypeEffectivenessType(multiplier)
  const baseConfig = TYPE_EFFECTIVENESS_STYLES[type]

  // 返回配置，但使用实际的倍率值
  return {
    ...baseConfig,
    multiplier: multiplier,
  }
}

/**
 * 计算技能对精灵的属性相性效果
 */
export function getSkillTypeEffectiveness(skill: SkillMessage, target: PetMessage): TypeEffectivenessConfig {
  if (!skill.element || target.isUnknown) {
    return TYPE_EFFECTIVENESS_STYLES.normal
  }

  const multiplier = calculateTypeEffectiveness(skill.element, target.element)
  return getTypeEffectivenessConfig(multiplier)
}

/**
 * 获取当前选择技能对目标的属性相性效果（用于精灵状态显示）
 */
export function getCurrentSkillEffectiveness(
  selectedSkill: SkillMessage | null,
  targetPet: PetMessage,
): TypeEffectivenessConfig {
  if (!selectedSkill || !selectedSkill.element || targetPet.isUnknown) {
    return TYPE_EFFECTIVENESS_STYLES.normal
  }

  return getSkillTypeEffectiveness(selectedSkill, targetPet)
}
