import { createLocalBattleFromYAML } from '@arcadia-eternity/battle/node'
import type { BattleConfig as V2BattleConfig, TeamConfig } from '@arcadia-eternity/battle'
import type { playerId } from '@arcadia-eternity/const'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { PackLock } from '@arcadia-eternity/schema/src/pack.js'
import type { PlayerSchemaType } from '@arcadia-eternity/schema'
import { ServerRuleIntegration } from '@arcadia-eternity/rules'
import type { Logger } from 'pino'

import type { RoomState } from '../../../cluster/types'
import { resolvePackRefFromLock } from '../pack'
import type { LocalBattleRoomData } from './battleRuntimeHost'

function toTeamConfig(player: PlayerSchemaType): TeamConfig {
  return {
    id: player.id,
    name: player.name,
    team: player.team.map(pet => ({
      name: pet.name,
      species: pet.species,
      level: pet.level,
      evs: pet.evs,
      ivs: pet.ivs,
      nature: pet.nature,
      skills: pet.skills,
      ability: pet.ability || undefined,
      emblem: pet.emblem || undefined,
      gender: pet.gender,
      weight: pet.weight,
      height: pet.height,
    })),
  }
}

function toRuleValidationTeam(player: PlayerSchemaType) {
  return player.team.map(pet => ({
    id: pet.id,
    name: pet.name,
    species: pet.species,
    level: pet.level,
    evs: pet.evs,
    ivs: pet.ivs,
    skills: pet.skills,
    gender: pet.gender,
    nature: pet.nature,
    ability: pet.ability || '',
    emblem: pet.emblem,
    height: pet.height,
    weight: pet.weight,
  }))
}

function resolveRuntimeSeed(roomState: RoomState): string {
  const metadataSeed = roomState.metadata?.runtimeSeed
  if (typeof metadataSeed === 'string' && metadataSeed.length > 0) {
    return metadataSeed
  }
  return `room:${roomState.id}`
}

export class LocalBattleRuntimeFactory {
  constructor(private readonly logger: Logger) {}

  async createBattleSystem(
    roomState: RoomState,
    player1Data: PlayerSchemaType,
    player2Data: PlayerSchemaType,
  ): Promise<IBattleSystem> {
    const ruleSetId = roomState.metadata?.ruleSetId || 'casual_standard_ruleset'
    const requiredPackLock = roomState.metadata?.requiredPackLock as PackLock | undefined
    const packRef = resolvePackRefFromLock(requiredPackLock)
    const runtimeSeed = resolveRuntimeSeed(roomState)

    this.logger.info(
      {
        roomId: roomState.id,
        ruleSetId,
        packRef,
        runtimeSeed,
        player1: player1Data.name,
        player2: player2Data.name,
      },
      'Creating battle with rule set',
    )

    try {
      const battleValidation = await ServerRuleIntegration.validateBattleCreation(
        toRuleValidationTeam(player1Data),
        toRuleValidationTeam(player2Data),
        [ruleSetId],
        {
          allowFaintSwitch: true,
          showHidden: false,
        },
      )

      if (!battleValidation.validation.isValid) {
        const errorMessage = `战斗验证失败: ${battleValidation.validation.errors.map(e => e.message).join(', ')}`
        this.logger.error(
          {
            roomId: roomState.id,
            ruleSetId,
            errors: battleValidation.validation.errors,
          },
          errorMessage,
        )
        throw new Error(errorMessage)
      }

      const battleConfig: V2BattleConfig = {
        seed: runtimeSeed,
        allowFaintSwitch: battleValidation.battleOptions.allowFaintSwitch,
        showHidden: battleValidation.battleOptions.showHidden,
        timerConfig: battleValidation.battleOptions.timerConfig,
      }

      const battle = await createLocalBattleFromYAML(
        packRef,
        toTeamConfig(player1Data),
        toTeamConfig(player2Data),
        battleConfig,
      )

      this.logger.info(
        {
          roomId: roomState.id,
          ruleSetId,
          battleOptions: battleValidation.battleOptions,
          runtimeSeed,
        },
        'V2 battle created with validated rule options',
      )

      return battle
    } catch (error) {
      this.logger.warn(
        {
          roomId: roomState.id,
          ruleSetId,
          error: error instanceof Error ? error.message : error,
        },
        'Failed to use rule system, falling back to default battle creation',
      )

      const fallbackConfig: V2BattleConfig = {
        seed: runtimeSeed,
        showHidden: false,
        timerConfig: {
          enabled: true,
          turnTimeLimit: 30,
          totalTimeLimit: 1500,
          animationPauseEnabled: true,
          maxAnimationDuration: 20000,
        },
        teamSelection: {
          enabled: false,
        },
      }

      return createLocalBattleFromYAML(
        packRef,
        toTeamConfig(player1Data),
        toTeamConfig(player2Data),
        fallbackConfig,
      )
    }
  }

  createRoomData(
    roomState: RoomState,
    battle: IBattleSystem,
    player1Data: PlayerSchemaType,
    player2Data: PlayerSchemaType,
  ): LocalBattleRoomData {
    const players = roomState.sessions.map(sessionId => roomState.sessionPlayers[sessionId]).filter(Boolean)

    return {
      id: roomState.id,
      battle,
      battlePlayerIds: [player1Data.id, player2Data.id] as [playerId, playerId],
      players,
      playersReady: new Set(),
      status: 'waiting',
      lastActive: Date.now(),
      battleRecordId: roomState.metadata?.battleRecordId,
      privateRoom: roomState.metadata?.privateRoom,
    }
  }
}
