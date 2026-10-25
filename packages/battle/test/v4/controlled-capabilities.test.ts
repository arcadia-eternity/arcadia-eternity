import { expect, it } from 'vitest'
import { createControlledCapabilityProbes, resumeControlledCapabilityProbes } from './controlled-capabilities-host'

it('runs saved controlled scenarios with native parity and restores independent uses at supported waits', async () => {
  const probes = await createControlledCapabilityProbes()
  expect(probes).toHaveLength(6)
  const results = await resumeControlledCapabilityProbes(JSON.parse(JSON.stringify(probes)))
  expect(results.map(result => result.scenario)).toEqual(['damage', 'damage', 'stacks', 'stacks', 'capture', 'capture'])
  expect(results.filter(result => result.scenario !== 'damage').every(result => result.sourceCount === 0)).toBe(true)
})
