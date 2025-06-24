/**
 * Z-Index 层级常量
 * 用于统一管理整个应用的层叠顺序
 */

// 数值常量，用于需要动态设置 style.zIndex 的场景
export const Z_INDEX_VALUES = {
  // 基础层级 (0-99)
  PET_SPRITE: 5,
  TIMELINE_CLICKABLE: 10,
  PET_BUTTON_LEVEL: 10,
  DYNAMIC_ANIMATION: 10,

  // 控制层级 (100-199)
  TIMER: 30,
  SKILL_BUTTON: 30,
  BATTLE_STATUS_ICON: 40,
  PET_BUTTON: 45,
  MARK: 50,
  PET_BUTTON_CONTAINER: 50, // 侧边 PetButton 容器的 z-index

  // UI 层级 (200-999)
  TOOLTIP: 200,

  // 顶层 UI (1000+)
  KO_BANNER: 1000,
  BATTLE_END_UI: 1000,

  // Climax 特效层级 (1050+)
  CLIMAX_BLACK_SCREEN: 1050, // Climax 黑屏遮罩
  CLIMAX_EFFECT: 1060, // Climax 特效本身

  // 移动端适配 UI (1100+)
  MOBILE_ORIENTATION_HINT: 1100,
  MOBILE_FULLSCREEN_BUTTON: 1200,

  // 加载遮罩 (1500+)
  LOADING_OVERLAY: 1500, // 加载遮罩，需要覆盖大部分UI但低于确认对话框

  CUSTOM_CONFIRM_DIALOG: 2000, // 提高到最高层级，确保在全屏模式下也能显示
} as const

// Tailwind CSS 类名枚举，用于模板中的 class 绑定
export enum Z_INDEX_CLASS {
  // 基础层级
  PET_SPRITE = 'z-[5]',
  TIMELINE_CLICKABLE = 'z-[10]',
  PET_BUTTON_LEVEL = 'z-[10]',
  DYNAMIC_ANIMATION = 'z-[10]',

  // 控制层级
  TIMER = 'z-[30]',
  SKILL_BUTTON = 'z-[30]',
  BATTLE_STATUS_ICON = 'z-[40]',
  PET_BUTTON = 'z-[45]',
  MARK = 'z-[50]',
  PET_BUTTON_CONTAINER = 'z-[50]',

  // UI 层级
  TOOLTIP = 'z-[200]',

  // 顶层 UI
  KO_BANNER = 'z-[1000]',
  BATTLE_END_UI = 'z-[1000]',

  // Climax 特效层级
  CLIMAX_BLACK_SCREEN = 'z-[1050]',
  CLIMAX_EFFECT = 'z-[1060]',

  // 移动端适配 UI
  MOBILE_ORIENTATION_HINT = 'z-[1100]',
  MOBILE_FULLSCREEN_BUTTON = 'z-[1200]',

  // 加载遮罩
  LOADING_OVERLAY = 'z-[1500]',

  CUSTOM_CONFIRM_DIALOG = 'z-[2000]', // 提高到最高层级，确保在全屏模式下也能显示
}

// 向后兼容的别名
export const Z_INDEX = Z_INDEX_VALUES

export type ZIndexLevel = (typeof Z_INDEX_VALUES)[keyof typeof Z_INDEX_VALUES]
