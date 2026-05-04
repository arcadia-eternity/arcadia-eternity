/**
 * 验证结果接口
 */
export interface ValidationResult {
  /** 验证是否通过 */
  isValid: boolean
  /** 错误信息列表 */
  errors: ValidationError[]
  /** 警告信息列表 */
  warnings: ValidationWarning[]
}

/**
 * 验证错误
 */
export interface ValidationError {
  /** 错误类型 */
  type: ValidationErrorType
  /** 错误代码 */
  code: string
  /** 错误消息 */
  message: string
  /** 相关的对象ID */
  objectId?: string
  /** 相关的对象类型 */
  objectType?: string
  /** 额外的上下文信息 */
  context?: Record<string, any>
}

/**
 * 验证警告
 */
export interface ValidationWarning {
  /** 警告类型 */
  type: ValidationWarningType
  /** 警告代码 */
  code: string
  /** 警告消息 */
  message: string
  /** 相关的对象ID */
  objectId?: string
  /** 相关的对象类型 */
  objectType?: string
  /** 额外的上下文信息 */
  context?: Record<string, any>
}

/**
 * 验证错误类型
 */
export enum ValidationErrorType {
  /** 队伍验证错误 */
  TEAM_VALIDATION = 'team_validation',
  /** 精灵验证错误 */
  PET_VALIDATION = 'pet_validation',
  /** 技能验证错误 */
  SKILL_VALIDATION = 'skill_validation',
  /** 印记验证错误 */
  MARK_VALIDATION = 'mark_validation',
  /** 规则冲突 */
  RULE_CONFLICT = 'rule_conflict',
  /** 配置错误 */
  CONFIG_ERROR = 'config_error',
  /** 系统错误 */
  SYSTEM_ERROR = 'system_error',
}

/**
 * 验证警告类型
 */
export enum ValidationWarningType {
  /** 性能警告 */
  PERFORMANCE_WARNING = 'performance_warning',
  /** 兼容性警告 */
  COMPATIBILITY_WARNING = 'compatibility_warning',
  /** 建议优化 */
  OPTIMIZATION_SUGGESTION = 'optimization_suggestion',
  /** 弃用警告 */
  DEPRECATION_WARNING = 'deprecation_warning',
}

/**
 * 创建验证结果的辅助函数
 */
export class ValidationResultBuilder {
  private errors: ValidationError[] = []
  private warnings: ValidationWarning[] = []

  /**
   * 添加错误
   */
  addError(
    type: ValidationErrorType,
    code: string,
    message: string,
    objectId?: string,
    objectType?: string,
    context?: Record<string, any>
  ): this {
    this.errors.push({
      type,
      code,
      message,
      objectId,
      objectType,
      context,
    })
    return this
  }

  /**
   * 添加警告
   */
  addWarning(
    type: ValidationWarningType,
    code: string,
    message: string,
    objectId?: string,
    objectType?: string,
    context?: Record<string, any>
  ): this {
    this.warnings.push({
      type,
      code,
      message,
      objectId,
      objectType,
      context,
    })
    return this
  }

  /**
   * 合并其他验证结果
   */
  merge(other: ValidationResult): this {
    this.errors.push(...other.errors)
    this.warnings.push(...other.warnings)
    return this
  }

  /**
   * 构建验证结果
   */
  build(): ValidationResult {
    return {
      isValid: this.errors.length === 0,
      errors: [...this.errors],
      warnings: [...this.warnings],
    }
  }

  /**
   * 重置构建器
   */
  reset(): this {
    this.errors = []
    this.warnings = []
    return this
  }
}

/**
 * 创建成功的验证结果
 */
export function createSuccessResult(warnings: ValidationWarning[] = []): ValidationResult {
  return {
    isValid: true,
    errors: [],
    warnings,
  }
}

/**
 * 创建失败的验证结果
 */
export function createFailureResult(
  errors: ValidationError[],
  warnings: ValidationWarning[] = []
): ValidationResult {
  return {
    isValid: false,
    errors,
    warnings,
  }
}
