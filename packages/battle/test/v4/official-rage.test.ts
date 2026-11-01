import {
  ConfigDurationType,
  ConfigModifier,
  ConfigModifierType,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { officialRageCandidate } from '@arcadia-eternity/data-pack-base/native'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'

const id = 'effect_skill_add_rage_20_if_rage_below_40'
const alias = `${id}.add_rage_value`
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
it('records a stable canonical parameter address and an explicit legacy alias', () => {
  expect(officialRageCandidate.value.address).toBe(`ae:param:["${id}","add-rage","value"]`)
  expect(officialRageCandidate.value.aliases).toEqual([alias])
  expect(officialRageCandidate.value.tags).toEqual([])
})
it('isolates the new parameter by battle and source, with reversible alias-based changes', () => {
  const first = makeScenario(233),
    second = makeScenario(234)
  battles.push(first.battle, second.battle)
  for (const f of [first, second]) officialRageCandidate.parameters.install(f.battle.configSystem)
  const source = first.a.activePet.skills[0]
  const remove = officialRageCandidate.parameters.modify(
    first.battle.configSystem,
    alias,
    new ConfigModifier(ConfigDurationType.binding, 'only-first-source', 7, ConfigModifierType.delta, 0),
    source,
  )
  expect(officialRageCandidate.parameters.read(first.battle.configSystem, alias, source)).toBe(27)
  expect(officialRageCandidate.parameters.read(first.battle.configSystem, alias, first.b.activePet.skills[0])).toBe(20)
  expect(officialRageCandidate.parameters.read(second.battle.configSystem, alias, second.a.activePet.skills[0])).toBe(
    20,
  )
  remove()
  expect(officialRageCandidate.parameters.read(first.battle.configSystem, alias, source)).toBe(20)
})
