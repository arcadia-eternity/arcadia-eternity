/**
 * Z-Index 层级常量
 * 用于统一管理整个应用的层叠顺序
 */

export const Z_INDEX = {
  // 基础层级 (0-99)
  PET_SPRITE: 5,
  TIMELINE_CLICKABLE: 10,
  PET_BUTTON_LEVEL: 10,

  // 控制层级 (100-199)
  TIMER: 30,
  SKILL_BUTTON: 30,
  BATTLE_STATUS_ICON: 40,
  PET_BUTTON: 45, // 提升到 45，确保能覆盖 BattleStatus 的触发区域
  MARK: 50,
  PET_BUTTON_CONTAINER: 50, // 侧边 PetButton 容器的 z-index
  DYNAMIC_ANIMATION: 50,

  // UI 层级 (200-999)
  TOOLTIP: 200,

  // 顶层 UI (1000+)
  KO_BANNER: 1000,
  BATTLE_END_UI: 1000,
} as const

export type ZIndexLevel = (typeof Z_INDEX)[keyof typeof Z_INDEX]
