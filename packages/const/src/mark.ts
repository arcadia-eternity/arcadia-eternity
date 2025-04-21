export enum StackStrategy {
  stack = 'stack', // 叠加层数并刷新持续时间
  refresh = 'refresh', // 保持层数但刷新持续时间
  extend = 'extend', // 叠加层数并延长持续时间
  max = 'max', // 取最大层数并刷新持续时间
  replace = 'replace', // 替换原有层数和叠层信息
  none = 'none', // 啥都不做
  remove = 'remove', // 直接移除
}

export type MarkConfig = {
  duration: number
  persistent: boolean
  maxStacks: number
  stackable: boolean
  stackStrategy: StackStrategy
  destroyable: boolean
  isShield: boolean
  keepOnSwitchOut: boolean
  transferOnSwitch: boolean
  inheritOnFaint: boolean
  mutexGroup?: string
  [id: string]: any
}
