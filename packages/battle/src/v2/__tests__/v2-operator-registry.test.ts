import { describe, expect, test } from 'vitest'
import { getConfigValue } from '@arcadia-eternity/engine'
import { createBattle } from '../game.js'
import { seer2EffectInterpreter } from '../systems/effect-interpreter.js'
import { registerOperatorHandler } from '../systems/interpreter/operator-registry.js'

describe('v2 operator registry', () => {
  test('default handlers are registered on battle creation', async () => {
    const battle = createBattle()

    await seer2EffectInterpreter.executeOperator(
      battle.world,
      { type: 'setConfig', target: 'battle', key: 'test.default', value: 42 },
      { sourceEntityId: 'test_source', trigger: 'OnTurnStart' },
    )

    expect(getConfigValue(battle.world.configStore, 'test.default')).toBe(42)
  })

  test('runtime registration overrides default implementation', async () => {
    const battle = createBattle()

    registerOperatorHandler(battle.world, 'setConfig', (ctx, op) => {
      ctx.world.meta.__setConfigOverride = `override:${String(op.type)}`
    })

    await seer2EffectInterpreter.executeOperator(
      battle.world,
      { type: 'setConfig', target: 'battle', key: 'test.override', value: 99 },
      { sourceEntityId: 'test_source', trigger: 'OnTurnStart' },
    )

    expect(battle.world.meta.__setConfigOverride).toBe('override:setConfig')
    expect(getConfigValue(battle.world.configStore, 'test.override')).toBeUndefined()
  })

  test('config operatorHandlers can inject handlers at creation time', async () => {
    const battle = createBattle({
      operatorHandlers: {
        setConfig: (ctx, op) => {
          ctx.world.meta.__configInjected = `config:${String(op.type)}`
        },
      },
    })

    await seer2EffectInterpreter.executeOperator(
      battle.world,
      { type: 'setConfig', target: 'battle', key: 'test.injected', value: 7 },
      { sourceEntityId: 'test_source', trigger: 'OnTurnStart' },
    )

    expect(battle.world.meta.__configInjected).toBe('config:setConfig')
    expect(getConfigValue(battle.world.configStore, 'test.injected')).toBeUndefined()
  })
})
