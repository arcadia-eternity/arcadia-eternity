import type { Element } from '@arcadia-eternity/const'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { Team, RuleContext } from '../../interfaces/Rule'
import { ValidationResultBuilder, ValidationErrorType, type ValidationResult } from '../../interfaces/ValidationResult'
import { AbstractRule } from '../../core/AbstractRule'

/**
 * 属性限制规则
 * 限制队伍中精灵的属性组合
 */
export class ElementRestrictionRule extends AbstractRule {
  private allowedElements: Set<Element>
  private bannedElements: Set<Element>
  private maxSameElement: number
  private minDifferentElements: number

  constructor(
    id: string = 'element_restriction_rule',
    name: string = '属性限制规则',
    options: {
      description?: string
      priority?: number
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
      allowedElements?: Element[]
      bannedElements?: Element[]
      maxSameElement?: number
      minDifferentElements?: number
    } = {},
  ) {
    super(id, name, {
      description: options.description ?? '限制队伍中精灵的属性组合',
      ...options,
      tags: ['special', 'element', 'restriction', ...(options.tags ?? [])],
    })

    this.allowedElements = new Set(options.allowedElements ?? [])
    this.bannedElements = new Set(options.bannedElements ?? [])
    this.maxSameElement = options.maxSameElement ?? Infinity
    this.minDifferentElements = options.minDifferentElements ?? 0
  }

  /**
   * 验证队伍的属性组合
   */
  validateTeam(team: Team, _context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    // 统计各属性的精灵数量
    const elementCounts = new Map<Element, number>()
    const petsByElement = new Map<Element, PetSchemaType[]>()

    for (const pet of team) {
      // 这里需要从数据仓库获取精灵的属性信息
      // 暂时假设pet对象有element属性，实际实现时需要查询species数据
      const element = (pet as any).element as Element
      if (element) {
        elementCounts.set(element, (elementCounts.get(element) || 0) + 1)
        if (!petsByElement.has(element)) {
          petsByElement.set(element, [])
        }
        petsByElement.get(element)!.push(pet)
      }
    }

    // 检查是否有被禁用的属性
    for (const [element, pets] of petsByElement.entries()) {
      if (this.bannedElements.has(element)) {
        for (const pet of pets) {
          builder.addError(
            ValidationErrorType.PET_VALIDATION,
            'BANNED_ELEMENT',
            `精灵 "${pet.name}" 的属性 "${element}" 已被禁用`,
            pet.id,
            'pet',
            { element, petName: pet.name },
          )
        }
      }
    }

    // 检查是否只使用了允许的属性
    if (this.allowedElements.size > 0) {
      for (const [element, pets] of petsByElement.entries()) {
        if (!this.allowedElements.has(element)) {
          for (const pet of pets) {
            builder.addError(
              ValidationErrorType.PET_VALIDATION,
              'DISALLOWED_ELEMENT',
              `精灵 "${pet.name}" 的属性 "${element}" 不在允许列表中`,
              pet.id,
              'pet',
              { element, petName: pet.name, allowedElements: Array.from(this.allowedElements) },
            )
          }
        }
      }
    }

    // 检查同属性精灵数量限制
    for (const [element, count] of elementCounts.entries()) {
      if (count > this.maxSameElement) {
        builder.addError(
          ValidationErrorType.TEAM_VALIDATION,
          'TOO_MANY_SAME_ELEMENT',
          `队伍中 ${element} 属性精灵过多，最多允许 ${this.maxSameElement} 只，当前有 ${count} 只`,
          undefined,
          'team',
          { element, maxCount: this.maxSameElement, currentCount: count },
        )
      }
    }

    // 检查不同属性数量要求
    const differentElementCount = elementCounts.size
    if (differentElementCount < this.minDifferentElements) {
      builder.addError(
        ValidationErrorType.TEAM_VALIDATION,
        'TOO_FEW_DIFFERENT_ELEMENTS',
        `队伍中不同属性种类过少，至少需要 ${this.minDifferentElements} 种，当前只有 ${differentElementCount} 种`,
        undefined,
        'team',
        { minDifferent: this.minDifferentElements, currentDifferent: differentElementCount },
      )
    }

    return builder.build()
  }

  /**
   * 设置允许的属性
   */
  setAllowedElements(elements: Element[]): void {
    this.allowedElements = new Set(elements)
  }

  /**
   * 添加允许的属性
   */
  addAllowedElements(...elements: Element[]): void {
    for (const element of elements) {
      this.allowedElements.add(element)
    }
  }

  /**
   * 设置禁用的属性
   */
  setBannedElements(elements: Element[]): void {
    this.bannedElements = new Set(elements)
  }

  /**
   * 添加禁用的属性
   */
  addBannedElements(...elements: Element[]): void {
    for (const element of elements) {
      this.bannedElements.add(element)
    }
  }

  /**
   * 设置同属性精灵最大数量
   */
  setMaxSameElement(count: number): void {
    if (count < 0) {
      throw new Error('Max same element count cannot be negative')
    }
    this.maxSameElement = count
  }

  /**
   * 设置最少不同属性数量
   */
  setMinDifferentElements(count: number): void {
    if (count < 0) {
      throw new Error('Min different elements count cannot be negative')
    }
    this.minDifferentElements = count
  }

  /**
   * 获取允许的属性列表
   */
  getAllowedElements(): Element[] {
    return Array.from(this.allowedElements)
  }

  /**
   * 获取禁用的属性列表
   */
  getBannedElements(): Element[] {
    return Array.from(this.bannedElements)
  }

  /**
   * 检查属性是否被允许
   */
  isElementAllowed(element: Element): boolean {
    if (this.bannedElements.has(element)) {
      return false
    }
    if (this.allowedElements.size > 0) {
      return this.allowedElements.has(element)
    }
    return true
  }
}

/**
 * 创建单属性队伍规则
 */
export function createMonoElementRule(element: Element): ElementRestrictionRule {
  return new ElementRestrictionRule(`mono_${element.toLowerCase()}_rule`, `单${element}属性队伍`, {
    description: `队伍中只能使用${element}属性精灵`,
    allowedElements: [element],
    tags: ['mono', 'special', element.toLowerCase()],
  })
}

/**
 * 创建多样性队伍规则
 */
export function createDiversityRule(): ElementRestrictionRule {
  return new ElementRestrictionRule('diversity_rule', '多样性队伍', {
    description: '队伍中每种属性最多1只精灵，至少需要4种不同属性',
    maxSameElement: 1,
    minDifferentElements: 4,
    tags: ['diversity', 'special', 'challenge'],
  })
}

/**
 * 创建禁用传说属性规则
 */
export function createNoLegendaryElementRule(): ElementRestrictionRule {
  // 假设有传说属性，实际需要根据游戏设定调整
  return new ElementRestrictionRule('no_legendary_element_rule', '禁用传说属性', {
    description: '禁用传说属性精灵',
    bannedElements: [], // 需要根据实际游戏设定填入传说属性
    tags: ['competitive', 'no-legendary'],
  })
}
