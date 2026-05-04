import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { Team, RuleContext } from '../../interfaces/Rule'
import { ValidationResultBuilder, ValidationErrorType, type ValidationResult } from '../../interfaces/ValidationResult'
import { AbstractRule } from '../../core/AbstractRule'

/**
 * 队伍大小限制规则
 * 限制队伍中精灵的数量
 */
export class TeamSizeRule extends AbstractRule {
  private minSize: number
  private maxSize: number

  constructor(
    id: string = 'team_size_rule',
    name: string = '队伍大小限制',
    minSize: number = 1,
    maxSize: number = 6,
    options: {
      description?: string
      priority?: number
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
    } = {},
  ) {
    super(id, name, {
      description: options.description ?? `限制队伍大小在 ${minSize}-${maxSize} 只精灵之间`,
      ...options,
      tags: ['basic', 'team', 'size', ...(options.tags ?? [])],
    })

    this.minSize = minSize
    this.maxSize = maxSize
  }

  /**
   * 验证队伍大小
   */
  validateTeam(team: Team, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()
    const teamSize = team.length

    if (teamSize < this.minSize) {
      builder.addError(
        ValidationErrorType.TEAM_VALIDATION,
        'TEAM_TOO_SMALL',
        `队伍精灵数量不足，至少需要 ${this.minSize} 只精灵，当前只有 ${teamSize} 只`,
        undefined,
        'team',
        { minSize: this.minSize, currentSize: teamSize },
      )
    }

    if (teamSize > this.maxSize) {
      builder.addError(
        ValidationErrorType.TEAM_VALIDATION,
        'TEAM_TOO_LARGE',
        `队伍精灵数量过多，最多允许 ${this.maxSize} 只精灵，当前有 ${teamSize} 只`,
        undefined,
        'team',
        { maxSize: this.maxSize, currentSize: teamSize },
      )
    }

    return builder.build()
  }

  /**
   * 获取最小队伍大小
   */
  getMinSize(): number {
    return this.minSize
  }

  /**
   * 获取最大队伍大小
   */
  getMaxSize(): number {
    return this.maxSize
  }

  /**
   * 设置队伍大小限制
   */
  setSizeLimit(minSize: number, maxSize: number): void {
    if (minSize < 0) {
      throw new Error('Minimum team size cannot be negative')
    }
    if (maxSize < minSize) {
      throw new Error('Maximum team size cannot be less than minimum team size')
    }

    this.minSize = minSize
    this.maxSize = maxSize
  }
}

/**
 * 创建标准队伍大小规则（1-6只精灵）
 */
export function createStandardTeamSizeRule(): TeamSizeRule {
  return new TeamSizeRule('standard_team_size', '标准队伍大小', 1, 6, {
    description: '标准游戏模式的队伍大小限制（1-6只精灵）',
    tags: ['standard', 'basic'],
  })
}

/**
 * 创建竞技队伍大小规则（6只精灵）
 */
export function createCompetitiveTeamSizeRule(): TeamSizeRule {
  return new TeamSizeRule('competitive_team_size', '竞技队伍大小', 6, 6, {
    description: '竞技模式的队伍大小限制（必须6只精灵）',
    tags: ['competitive', 'strict'],
  })
}
