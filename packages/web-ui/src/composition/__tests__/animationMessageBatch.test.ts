import { expect, it } from 'vitest'
import { planAnimationMessages } from '../animationMessageBatch'

it('a snapshot inside a skill group preserves later damage without replaying the covered skill start', () => {
  const start = { type: 'SKILL_USE', sequenceId: 10 }
  const damage = { type: 'DAMAGE', sequenceId: 12 }
  const end = { type: 'SKILL_USE_END', sequenceId: 13 }
  expect(planAnimationMessages([start, damage, end], 11)).toEqual({ pending: [damage, end], animate: false })
})
it('fully covered groups are skipped and a new complete group still animates', () => {
  const messages = [{ sequenceId: 10 }, { sequenceId: 11 }]
  expect(planAnimationMessages(messages, 11)).toEqual({ pending: [], animate: false })
  expect(planAnimationMessages(messages, 9)).toEqual({ pending: messages, animate: true })
})
it('unsequenced messages cannot be declared covered by a snapshot', () => {
  const message: { sequenceId?: number } = {}
  expect(planAnimationMessages([message], 50)).toEqual({ pending: [message], animate: true })
})
