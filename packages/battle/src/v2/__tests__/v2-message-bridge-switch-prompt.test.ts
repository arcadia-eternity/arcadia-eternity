import { beforeAll, describe, expect, test } from 'vitest'
import { BattleMessageType, Gender } from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../data/battle-factory.js'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import { MessageBridge } from '../systems/message-bridge.js'
import { getBattlePlayerIds, getTestRepository, makeTeamConfig } from './helpers/regression-helpers.js'

let repo: V2DataRepository

beforeAll(async () => {
  repo = await getTestRepository()
})

describe('v2 message bridge switch prompt', () => {
  test('forcedSwitch/faintSwitch are dispatched immediately inside phase transaction', () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      repo,
      { seed: 'message-bridge-switch-prompt' },
    )
    const { playerAId, playerBId } = getBattlePlayerIds(battle.world)

    const bridge = new MessageBridge(
      battle.world,
      battle.eventBus,
      {
        playerSystem: battle.playerSystem,
        petSystem: battle.petSystem,
        markSystem: battle.markSystem,
        skillSystem: battle.skillSystem,
        attrSystem: battle.attrSystem,
      },
      false,
    )

    const types: BattleMessageType[] = []
    bridge.subscribe(msg => types.push(msg.type))

    bridge.beginPhaseTransaction('phase_switch')
    battle.eventBus.emit(battle.world, 'forcedSwitch', { playerIds: [playerBId] })
    battle.eventBus.emit(battle.world, 'faintSwitch', { playerId: playerAId })

    expect(types).toContain(BattleMessageType.ForcedSwitch)
    expect(types).toContain(BattleMessageType.FaintSwitch)

    bridge.rollbackPhaseTransaction('phase_switch')
    bridge.cleanup()
  })
})

