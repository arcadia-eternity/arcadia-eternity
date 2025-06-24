/**
 * CLI数据验证相关类型定义
 */

export interface ValidationError {
  type: 'missing_id' | 'missing_reference' | 'invalid_format' | 'duplicate_id'
  category: string
  itemId?: string
  referencedId?: string
  referencedType?: string
  message: string
  filePath?: string
}

export interface ValidationWarning {
  type: 'unused_reference' | 'deprecated_reference' | 'format_warning'
  category: string
  itemId: string
  message: string
  filePath?: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface DataValidationOptions {
  /** 是否验证交叉引用 */
  validateCrossReferences?: boolean
  /** 是否验证ID格式 */
  validateIdFormat?: boolean
  /** 是否检查重复ID */
  checkDuplicateIds?: boolean
  /** 是否在发现错误时继续验证 */
  continueOnError?: boolean
  /** 是否显示详细的验证信息 */
  verbose?: boolean
}

export interface NormalizedData<T> {
  byId: Record<string, T>
  allIds: string[]
}
