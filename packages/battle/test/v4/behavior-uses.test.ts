import { expect, it } from 'vitest'
import { createBehaviorUseProbes, resumeBehaviorUseProbes } from './behavior-use-host'

it('runs saved rule and native uses independently and restores fresh factories at initial and action waits', async () => {
  const probes = await createBehaviorUseProbes()
  expect(probes).toHaveLength(4)
  const results = await resumeBehaviorUseProbes(JSON.parse(JSON.stringify(probes)))
  expect(results.map(({ mode, marks, hp }) => ({ mode, marks, hp }))).toEqual([
    { mode: 'rule', marks: false, hp: 35 },
    { mode: 'rule', marks: true, hp: 8 },
    { mode: 'native', marks: false, hp: 35 },
    { mode: 'native', marks: true, hp: 35 },
  ])
})
