export enum StackStrategy {
  'stack', // 叠加层数并刷新持续时间
  'refresh', // 保持层数但刷新持续时间
  'extend', // 叠加层数并延长持续时间
  'max', // 取最大层数并刷新持续时间
  'replace',
}
