import { describe, expect, test } from 'vitest'
import { createBattle } from '../game.js'
import { seer2EffectInterpreter } from '../systems/effect-interpreter.js'
import { registerConditionHandler } from '../systems/interpreter/condition-registry.js'
import { resolveSelector } from '../systems/interpreter/selector.js'
import {
  registerSelectorBaseHandler,
  registerSelectorChainHandler,
} from '../systems/interpreter/selector-registry.js'
import { BATTLE_OWNER_ID } from '../systems/mark.system.js'
import { parseEffect } from '../data/parsers/effect-parser.js'
import {
  registerEffectTrigger,
  resetEffectTriggerRegistry,
} from '../data/parsers/trigger-registry.js'

describe('v2 dsl registries', () => {
  test('condition registry overrides non-common condition implementation', () => {
    const battle = createBattle()
    const context = { sourceEntityId: 'test_source', trigger: 'OnTurnStart' }

    expect(seer2EffectInterpreter.evaluateCondition(battle.world, { type: 'petIsActive' }, context)).toBe(false)

    registerConditionHandler(battle.world, 'petIsActive', () => true)

    expect(seer2EffectInterpreter.evaluateCondition(battle.world, { type: 'petIsActive' }, context)).toBe(true)
  })

  test('selector base/chain handlers are overridable', () => {
    const battle = createBattle()
    const ctx = {
      world: battle.world,
      systems: battle.world.systems as any,
      fireCtx: {
        sourceEntityId: 'test_source',
        trigger: 'selector-test',
      },
    }

    expect(resolveSelector(ctx, 'battle')).toEqual([BATTLE_OWNER_ID])

    registerSelectorBaseHandler(battle.world, 'battle', () => ['custom_battle'])
    expect(resolveSelector(ctx, 'battle')).toEqual(['custom_battle'])

    registerSelectorChainHandler(battle.world, 'selectPath', () => ['chain_override'])
    expect(resolveSelector(ctx, {
      base: 'battle',
      chain: [{ type: 'selectPath', arg: 'currentTurn' }],
    })).toEqual(['chain_override'])
  })

  test('trigger registry controls parse-time trigger validation', () => {
    resetEffectTriggerRegistry()
    const raw = {
      id: 'eff_custom_trigger',
      trigger: 'OnCustomTrigger',
      priority: 0,
      apply: { type: 'addPower', target: 'useSkillContext', value: 1 },
    } as Record<string, unknown>

    expect(() => parseEffect(raw)).toThrow("unknown trigger 'OnCustomTrigger'")

    registerEffectTrigger('OnCustomTrigger')
    expect(parseEffect(raw).triggers).toEqual(['OnCustomTrigger'])

    resetEffectTriggerRegistry()
  })
})
