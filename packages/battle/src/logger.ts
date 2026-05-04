/**
 * 兼容的logger接口，可以是pino、winston或任何其他logger
 */
export interface CompatibleLogger {
  debug(obj: Record<string, unknown>, msg?: string): void
  debug(msg: string, ...args: unknown[]): void
  info(obj: Record<string, unknown>, msg?: string): void
  info(msg: string, ...args: unknown[]): void
  warn(obj: Record<string, unknown>, msg?: string): void
  warn(msg: string, ...args: unknown[]): void
  error(obj: Record<string, unknown>, msg?: string): void
  error(msg: string, ...args: unknown[]): void
  child?(bindings: Record<string, unknown>): CompatibleLogger
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
      debug: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          // 字符串消息格式: debug(message, ...args)
          if (args.length > 0) {
            globalLogger!.debug({ args }, objOrMessage)
          } else {
            globalLogger!.debug(objOrMessage)
          }
        } else {
          // 对象格式: debug(obj, msg?)
          globalLogger!.debug(objOrMessage, msg)
        }
      },
      info: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          if (args.length > 0) {
            globalLogger!.info({ args }, objOrMessage)
          } else {
            globalLogger!.info(objOrMessage)
          }
        } else {
          globalLogger!.info(objOrMessage, msg)
        }
      },
      warn: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          if (args.length > 0) {
            globalLogger!.warn({ args }, objOrMessage)
          } else {
            globalLogger!.warn(objOrMessage)
          }
        } else {
          globalLogger!.warn(objOrMessage, msg)
        }
      },
      error: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          if (args.length > 0) {
            globalLogger!.error({ args }, objOrMessage)
          } else {
            globalLogger!.error(objOrMessage)
          }
        } else {
          globalLogger!.error(objOrMessage, msg)
        }
      },
      log: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          if (args.length > 0) {
            globalLogger!.info({ args }, objOrMessage)
          } else {
            globalLogger!.info(objOrMessage)
          }
        } else {
          globalLogger!.info(objOrMessage, msg)
        }
      },
    } as BattleLogger
  }

  // 回退到console
  return {
    debug: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.debug(objOrMessage, ...args)
      } else {
        console.debug(objOrMessage, msg)
      }
    },
    info: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.info(objOrMessage, ...args)
      } else {
        console.info(objOrMessage, msg)
      }
    },
    warn: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.warn(objOrMessage, ...args)
      } else {
        console.warn(objOrMessage, msg)
      }
    },
    error: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.error(objOrMessage, ...args)
      } else {
        console.error(objOrMessage, msg)
      }
    },
    log: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.log(objOrMessage, ...args)
      } else {
        console.log(objOrMessage, msg)
      }
    },
  } as BattleLogger
}

/**
 * Battle系统专用的logger接口
 */
export interface BattleLogger {
  debug(obj: Record<string, unknown>, msg?: string): void
  debug(message: string, ...args: unknown[]): void
  info(obj: Record<string, unknown>, msg?: string): void
  info(message: string, ...args: unknown[]): void
  warn(obj: Record<string, unknown>, msg?: string): void
  warn(message: string, ...args: unknown[]): void
  error(obj: Record<string, unknown>, msg?: string): void
  error(message: string, ...args: unknown[]): void
  log(obj: Record<string, unknown>, msg?: string): void
  log(message: string, ...args: unknown[]): void
}

/**
 * 创建带有子标签的logger
 */
export function createChildLogger(tag: string): BattleLogger {
  if (globalLogger) {
    // 如果logger支持child方法，使用它；否则直接使用原logger但添加组件信息
    const childLogger = globalLogger.child ? globalLogger.child({ component: tag }) : globalLogger

    return {
      debug: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          if (args.length > 0) {
            childLogger.debug({ args, component: tag }, objOrMessage)
          } else {
            childLogger.debug({ component: tag }, objOrMessage)
          }
        } else {
          childLogger.debug({ ...objOrMessage, component: tag }, msg)
        }
      },
      info: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          if (args.length > 0) {
            childLogger.info({ args, component: tag }, objOrMessage)
          } else {
            childLogger.info({ component: tag }, objOrMessage)
          }
        } else {
          childLogger.info({ ...objOrMessage, component: tag }, msg)
        }
      },
      warn: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          if (args.length > 0) {
            childLogger.warn({ args, component: tag }, objOrMessage)
          } else {
            childLogger.warn({ component: tag }, objOrMessage)
          }
        } else {
          childLogger.warn({ ...objOrMessage, component: tag }, msg)
        }
      },
      error: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          if (args.length > 0) {
            childLogger.error({ args, component: tag }, objOrMessage)
          } else {
            childLogger.error({ component: tag }, objOrMessage)
          }
        } else {
          childLogger.error({ ...objOrMessage, component: tag }, msg)
        }
      },
      log: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
        if (typeof objOrMessage === 'string') {
          if (args.length > 0) {
            childLogger.info({ args, component: tag }, objOrMessage)
          } else {
            childLogger.info({ component: tag }, objOrMessage)
          }
        } else {
          childLogger.info({ ...objOrMessage, component: tag }, msg)
        }
      },
    } as BattleLogger
  }

  // 回退到console，但添加标签前缀
  const prefix = `[${tag}]`
  return {
    debug: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.debug(prefix, objOrMessage, ...args)
      } else {
        console.debug(prefix, objOrMessage, msg)
      }
    },
    info: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.info(prefix, objOrMessage, ...args)
      } else {
        console.info(prefix, objOrMessage, msg)
      }
    },
    warn: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.warn(prefix, objOrMessage, ...args)
      } else {
        console.warn(prefix, objOrMessage, msg)
      }
    },
    error: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.error(prefix, objOrMessage, ...args)
      } else {
        console.error(prefix, objOrMessage, msg)
      }
    },
    log: (objOrMessage: Record<string, unknown> | string, msg?: string, ...args: unknown[]) => {
      if (typeof objOrMessage === 'string') {
        console.log(prefix, objOrMessage, ...args)
      } else {
        console.log(prefix, objOrMessage, msg)
      }
    },
  } as BattleLogger
}
