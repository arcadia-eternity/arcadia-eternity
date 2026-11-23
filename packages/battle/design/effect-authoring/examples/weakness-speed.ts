import { targets } from '../api'

export { weaknessSpeedPenalty } from '../../../../../packs/base/src/effects/authored/weakness-speed'

const mark = targets.ownerMarks.where(candidate => candidate.baseId === 'mark_ruodianjihao').first()
const speedPenalty = (stack: number) => Math.floor(-25 * stack)

export const capturedInstancePenalty = mark
  .capture({ key: 'weakness-instance', scope: 'binding' })
  .attribute('stack')
  .follow({ key: 'weakness-stack' })
  .map(speedPenalty)

export const followingInstancePenalty = mark
  .follow({ key: 'weakness-instance' })
  .attribute('stack')
  .follow({ key: 'weakness-stack' })
  .map(speedPenalty)

export const entryStackPenalty = mark
  .follow({ key: 'weakness-instance' })
  .attribute('stack')
  .capture({ key: 'weakness-stack', scope: 'input' })
  .map(speedPenalty)
