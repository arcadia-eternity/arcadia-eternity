import type { TimerConfig } from '@arcadia-eternity/const'
import type { RuleContext } from '../../interfaces/Rule'
import { AbstractRule } from '../../core/AbstractRule'

/**
 * 计时器规则
 * 修改战斗计时器的配置
 */
export class TimerRule extends AbstractRule {
  private timerConfig: Partial<TimerConfig>

  constructor(
    id: string = 'timer_rule',
    name: string = '计时器规则',
    timerConfig: Partial<TimerConfig> = {},
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
      description: options.description ?? '修改战斗计时器配置',
      ...options,
      tags: ['timer', 'battle', 'config', ...(options.tags ?? [])],
    })

    this.timerConfig = { ...timerConfig }
  }

  /**
   * 获取计时器配置修改
   */
  getTimerConfigModifications(context?: RuleContext): Partial<TimerConfig> {
    return { ...this.timerConfig }
  }

  /**
   * 设置计时器配置
   */
  setTimerConfig(config: Partial<TimerConfig>): void {
    this.timerConfig = { ...config }
  }

  /**
   * 更新计时器配置
   */
  updateTimerConfig(config: Partial<TimerConfig>): void {
    Object.assign(this.timerConfig, config)
  }

  /**
   * 启用计时器
   */
  enableTimer(): void {
    this.timerConfig.enabled = true
  }

  /**
   * 禁用计时器
   */
  disableTimer(): void {
    this.timerConfig.enabled = false
  }

  /**
   * 设置回合时间限制
   */
  setTurnTimeLimit(seconds: number): void {
    if (seconds <= 0) {
      throw new Error('Turn time limit must be positive')
    }
    this.timerConfig.turnTimeLimit = seconds
  }

  /**
   * 设置总时间限制
   */
  setTotalTimeLimit(seconds: number): void {
    if (seconds <= 0) {
      throw new Error('Total time limit must be positive')
    }
    this.timerConfig.totalTimeLimit = seconds
  }

  /**
   * 设置动画暂停功能
   */
  setAnimationPauseEnabled(enabled: boolean): void {
    this.timerConfig.animationPauseEnabled = enabled
  }

  /**
   * 设置最大动画持续时间
   */
  setMaxAnimationDuration(milliseconds: number): void {
    if (milliseconds <= 0) {
      throw new Error('Max animation duration must be positive')
    }
    this.timerConfig.maxAnimationDuration = milliseconds
  }

  /**
   * 获取当前计时器配置
   */
  getTimerConfig(): Partial<TimerConfig> {
    return { ...this.timerConfig }
  }
}

/**
 * 创建标准竞技计时器规则
 */
export function createStandardCompetitiveTimerRule(): TimerRule {
  return new TimerRule(
    'standard_competitive_timer',
    '标准竞技计时器',
    {
      enabled: true,
      turnTimeLimit: 30, // 30秒每回合
      totalTimeLimit: 900, // 15分钟总时间
      animationPauseEnabled: true,
      maxAnimationDuration: 10000, // 10秒最大动画时长
    },
    {
      description: '标准竞技模式的计时器配置（30秒/回合，15分钟总时间）',
      tags: ['standard', 'competitive'],
    },
  )
}

/**
 * 创建休闲模式计时器规则
 */
export function createCasualTimerRule(): TimerRule {
  return new TimerRule(
    'casual_timer',
    '休闲模式计时器',
    {
      enabled: true,
      turnTimeLimit: 60, // 60秒每回合
      totalTimeLimit: 1800, // 30分钟总时间
      animationPauseEnabled: true,
      maxAnimationDuration: 20000, // 20秒最大动画时长
    },
    {
      description: '休闲模式的计时器配置（60秒/回合，30分钟总时间）',
      tags: ['casual', 'relaxed'],
    },
  )
}
