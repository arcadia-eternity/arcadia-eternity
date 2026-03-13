import { describe, expect, test } from 'vitest'
import { createBattle } from '../game.js'
import { resolveExtractorByKind } from '../systems/interpreter/extractor-runtime.js'

describe('v2 strict runtime', () => {
  test('strict extractor typing is always enabled', () => {
    const battle = createBattle()
    expect(battle.world.meta.strictExtractorTyping).toBe(true)

    const battleWithOverride = createBattle({ strictExtractorTyping: false } as unknown as Parameters<typeof createBattle>[0])
    expect(battleWithOverride.world.meta.strictExtractorTyping).toBe(true)
  })

  test('undeclared attribute access throws immediately', () => {
    const battle = createBattle()
    const systems = battle.world.systems as unknown as Parameters<typeof resolveExtractorByKind>[1]

    expect(() =>
      resolveExtractorByKind(
        battle.world,
        systems,
        { type: 'use-skill' },
        'attribute',
        'unknownAttr',
      )).toThrow("attribute 'unknownAttr' is not declared for owner 'useSkillContext'")
  })
})
