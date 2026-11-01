import { setGlobalLogger, type Battle } from '@arcadia-eternity/battle/v4'
import { createOfficialWaterShieldCandidate } from '@arcadia-eternity/data-pack-base/native'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
it('requires the declared mark dependency rather than creating a fallback', () => {
  const f = makeScenario()
  battles.push(f.battle)
  expect(() => createOfficialWaterShieldCandidate(f.debuff)).toThrow('requires mark_shuiwenpingzhang')
})
