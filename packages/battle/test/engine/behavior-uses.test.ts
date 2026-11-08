import { expect, it } from 'vitest'
import { createBehaviorUseProbes, resumeBehaviorUseProbes } from './behavior-use-host'

it('runs saved native uses independently and restores fresh factories at initial and action waits', async () => {
  const probes = await createBehaviorUseProbes()
  expect(probes).toHaveLength(2)
  const results = await resumeBehaviorUseProbes(JSON.parse(JSON.stringify(probes)))
  expect(results.map(({ mode, marks, hp }) => ({ mode, marks, hp }))).toEqual([
    { mode: 'native', marks: false, hp: 35 },
    { mode: 'native', marks: true, hp: 35 },
  ])
})
