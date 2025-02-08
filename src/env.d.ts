// 统一环境类型
interface GameEnv {
  // 核心系统版本
  readonly CORE_VERSION: string

  // 运行模式
  MODE: 'development' | 'production'

  // 特性开关
  FEATURES: {
    DEBUG_TOOLS?: boolean
    CHEAT_MENU?: boolean
  }
}

// 浏览器环境
interface ImportMeta {
  readonly env: GameEnv
}

// Node.js 环境
declare namespace NodeJS {
  interface ProcessEnv extends GameEnv {
    NODE_ENV: GameEnv['MODE']
  }
}
