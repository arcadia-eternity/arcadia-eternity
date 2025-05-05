export enum ContinuousUseSkillStrategy {
  // 按一定的频率进行触发 exp：每三次触发一次
  Periodic = 'Periodic',
  // 达到一定的次数后触发，且在后续的使用中不再触发 exp：使用三次后触发一次 后面不再触发
  Once = 'Once',
  // 达到一定的次数后触发，且在后续的使用中继续触发 exp：使用三次后触发一次 后面继续触发
  Continuous = 'Continuous',
}
