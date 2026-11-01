import {
  BaseMark,
  ConfigSystem,
  createContentCatalog,
  EffectContext,
  EffectTrigger,
  RemoveMarkContext,
  TurnContext,
  setGlobalLogger,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { createOfficialEffectCandidates } from '@arcadia-eternity/data-pack-base/native'
import { beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'
import { loadBaseMetadata } from './base-metadata'

beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
function marks() {
  const metadata = loadBaseMetadata('marks').map(raw => ({ ...(raw as object), effect: [] }))
  const catalog = createContentCatalog({ marks: metadata, skills: [], species: [] }, 'candidate-dependencies')
  return new Map(catalog.marks.map(mark => [mark.id, mark]))
}
it('uses the caller-provided amplification prototype when the supplied shield is destroyed', async () => {
  const dependencies = marks()
  const candidates = createOfficialEffectCandidates(dependencies)
  const { battle, a } = makeScenario()
  try {
    const source = dependencies.get('mark_shuiwenpingzhang')!.createInstance()
    source.setOwner(a.activePet, battle.emitter)
    a.activePet.marks.push(source)
    source.effects.push(candidates.effects.get('effect_mark_onDestroy_add_mark_shanghaizengjia')!)
    const parent = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
    battle.removeMark(new RemoveMarkContext(parent, source))
    const amplification = a.activePet.marks.find(mark => mark.baseId === 'mark_shanghaizengjia')
    expect(amplification?.base).toBe(dependencies.get('mark_shanghaizengjia'))
    expect(amplification?.stack).toBe(100)
  } finally {
    await battle.cleanup()
  }
})
it('rejects missing and mismatched dependencies before publishing a directory', () => {
  const dependencies = marks()
  dependencies.delete('mark_shuiwenpingzhang')
  expect(() => createOfficialEffectCandidates(dependencies)).toThrow()
  dependencies.set('mark_shuiwenpingzhang', new BaseMark('fixture/wrong' as baseMarkId, []))
  expect(() => createOfficialEffectCandidates(dependencies)).toThrow()
})
it('installs all distinct parameter catalogs without address conflicts and keeps worlds isolated', () => {
  const result = createOfficialEffectCandidates(marks())
  const first = ConfigSystem.createInstance()
  const second = ConfigSystem.createInstance()
  try {
    for (const catalog of new Set(result.parameters.values())) {
      catalog.install(first)
      catalog.install(second)
    }
    const shield = result.parameters.get('effect_skill_add_mark_shuiwenpingzhang')!
    const alias = 'effect_skill_add_mark_shuiwenpingzhang.multiply_value'
    shield.set(first, alias, 1.5)
    expect(shield.read(first, alias)).toBe(1.5)
    expect(shield.read(second, alias)).toBe(1)
  } finally {
    first.destroy()
    second.destroy()
  }
})
