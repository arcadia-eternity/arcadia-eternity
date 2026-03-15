import { describe, expect, test } from 'vitest'
import { Type } from '@sinclair/typebox'
import { parseWithErrors } from '../src/utils'

describe('parseWithErrors', () => {
  test('accepts proxy input and validates normally', () => {
    const schema = Type.Object(
      {
        type: Type.Literal('use-skill'),
        player: Type.String(),
        skill: Type.String(),
      },
      { additionalProperties: false },
    )

    const proxyInput = new Proxy(
      {
        type: 'use-skill',
        player: 'player_1',
        skill: 'skill_1',
        extra: 'removed',
      },
      {},
    )

    const parsed = parseWithErrors(schema, proxyInput)
    expect(parsed).toEqual({
      type: 'use-skill',
      player: 'player_1',
      skill: 'skill_1',
    })
  })
})

