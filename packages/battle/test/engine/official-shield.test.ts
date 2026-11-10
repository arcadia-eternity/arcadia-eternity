import { ShieldEffects } from '../../../../packs/base/src/effects/shield.effect'
import { setGlobalLogger, type Battle } from '@arcadia-eternity/battle/engine'

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
  expect(() => ShieldEffects.build({ mark: () => f.debuff })).toThrow('requires mark_shuiwenpingzhang')
})
