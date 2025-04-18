export enum StackStrategy {
  stack = 'stack', // 叠加层数并刷新持续时间
  refresh = 'refresh', // 保持层数但刷新持续时间
  extend = 'extend', // 叠加层数并延长持续时间
  max = 'max', // 取最大层数并刷新持续时间
  replace = 'replace',
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
