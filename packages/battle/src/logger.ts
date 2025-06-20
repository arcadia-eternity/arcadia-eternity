/**
 * 兼容的logger接口，可以是pino、winston或任何其他logger
 */
export interface CompatibleLogger {
  debug(obj: any, msg?: string): void
  debug(msg: string, ...args: any[]): void
  info(obj: any, msg?: string): void
  info(msg: string, ...args: any[]): void
  warn(obj: any, msg?: string): void
  warn(msg: string, ...args: any[]): void
  error(obj: any, msg?: string): void
  error(msg: string, ...args: any[]): void
  child?(bindings: any): CompatibleLogger
}

// 创建一个全局logger实例
let globalLogger: CompatibleLogger | undefined

/**
 * 设置全局logger实例
 * 这个方法应该在服务器启动时调用
 */
export function setGlobalLogger(logger: CompatibleLogger): void {
  globalLogger = logger
}

/**
 * 获取logger实例
 * 如果设置了全局logger则使用注入的logger，否则回退到console
 */
export function getLogger(): BattleLogger {
  if (globalLogger) {
    return {
      debug: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          globalLogger!.debug({ args }, message)
        } else {
          globalLogger!.debug(message)
        }
      },
      info: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          globalLogger!.info({ args }, message)
        } else {
          globalLogger!.info(message)
        }
      },
      warn: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          globalLogger!.warn({ args }, message)
        } else {
          globalLogger!.warn(message)
        }
      },
      error: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          globalLogger!.error({ args }, message)
        } else {
          globalLogger!.error(message)
        }
      },
      log: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          globalLogger!.info({ args }, message)
        } else {
          globalLogger!.info(message)
        }
      },
    }
  }

  // 回退到console
  return {
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    log: console.log.bind(console),
  }
}

/**
 * Battle系统专用的logger接口
 */
export interface BattleLogger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
  log(message: string, ...args: any[]): void
}

/**
 * 创建带有子标签的logger
 */
export function createChildLogger(tag: string): BattleLogger {
  if (globalLogger) {
    // 如果logger支持child方法，使用它；否则直接使用原logger但添加组件信息
    const childLogger = globalLogger.child ? globalLogger.child({ component: tag }) : globalLogger

    return {
      debug: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          childLogger.debug({ args, component: tag }, message)
        } else {
          childLogger.debug({ component: tag }, message)
        }
      },
      info: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          childLogger.info({ args, component: tag }, message)
        } else {
          childLogger.info({ component: tag }, message)
        }
      },
      warn: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          childLogger.warn({ args, component: tag }, message)
        } else {
          childLogger.warn({ component: tag }, message)
        }
      },
      error: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          childLogger.error({ args, component: tag }, message)
        } else {
          childLogger.error({ component: tag }, message)
        }
      },
      log: (message: string, ...args: any[]) => {
        if (args.length > 0) {
          childLogger.info({ args, component: tag }, message)
        } else {
          childLogger.info({ component: tag }, message)
        }
      },
    }
  }

  // 回退到console，但添加标签前缀
  const prefix = `[${tag}]`
  return {
    debug: (message: string, ...args: any[]) => console.debug(prefix, message, ...args),
    info: (message: string, ...args: any[]) => console.info(prefix, message, ...args),
    warn: (message: string, ...args: any[]) => console.warn(prefix, message, ...args),
    error: (message: string, ...args: any[]) => console.error(prefix, message, ...args),
    log: (message: string, ...args: any[]) => console.log(prefix, message, ...args),
  }
}
