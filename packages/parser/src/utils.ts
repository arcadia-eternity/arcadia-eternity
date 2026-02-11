/**
 * 格式化验证错误为用户友好的中文错误消息
 * @param error - 错误对象
 * @param prefix - 错误前缀，用于标识错误来源
 * @returns 格式化后的错误消息
 */
export function formatValidationError(error: Error, prefix: string): string {
  return `${prefix}: ${error.message}`
}

/**
 * 包装解析函数，提供统一的错误处理
 * @param parseFunction - 要包装的解析函数
 * @param errorPrefix - 错误前缀
 * @returns 包装后的解析函数
 */
export function withErrorHandling<T, R>(
  parseFunction: (data: T) => R,
  errorPrefix: string,
): (data: T) => R {
  return (data: T): R => {
    try {
      return parseFunction(data)
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(formatValidationError(error, errorPrefix))
      }
      throw error
    }
  }
}

/**
 * 创建带有上下文信息的错误
 * @param message - 错误消息
 * @param context - 上下文信息
 * @param originalError - 原始错误（可选）
 * @returns 新的错误对象
 */
export function createContextualError(
  message: string,
  context: Record<string, any>,
  originalError?: Error,
): Error {
  const contextStr = Object.entries(context)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')

  const fullMessage = originalError
    ? `${message} (${contextStr}): ${originalError.message}`
    : `${message} (${contextStr})`

  const error = new Error(fullMessage)
  if (originalError) {
    error.cause = originalError
  }
  return error
}
