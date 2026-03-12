import {
  AttackTargetOpinion,
  BattleMessageType,
  BattleStatus,
  Category,
  DamageType,
  Gender,
  IgnoreStageStrategy,
  Nature,
  type BattleMessage,
  type playerId,
} from '@arcadia-eternity/const'
import type { V2DataRepository } from '../../data/v2-data-repository.js'
import { createBattleFromConfig } from '../../data/battle-factory.js'
import { loadV2GameDataFromPack, type LoadResult } from '../../data/v2-data-loader.js'
import type { TeamConfig } from '../../data/team-config.js'
import type { UseSkillContextData } from '../../schemas/context.schema.js'
import type { BattleInstance } from '../../game.js'
import { LocalBattleSystemV2 } from '../../local-battle.js'

const PACK_REF = 'builtin:base'

let repoPromise: Promise<V2DataRepository> | undefined

export async function getTestRepository(): Promise<V2DataRepository> {
  if (!repoPromise) {
    repoPromise = loadV2GameDataFromPack(PACK_REF, { continueOnError: false, validateReferences: true })
      .then((result: LoadResult) => result.repository)
  }
  return repoPromise
}

export function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be string`)
  return value
}

export function getBattlePlayerIds(world: BattleInstance['world']): { playerAId: string; playerBId: string } {
  return {
    playerAId: expectString(world.state.playerAId, 'playerAId'),
    playerBId: expectString(world.state.playerBId, 'playerBId'),
  }
}

export function makeTeamConfig(name: string, species: string, skills: string[], gender: Gender): TeamConfig {
  return {
    name,
    team: [
      {
        name: `${name}-pet`,
        species,
        level: 100,
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: Nature.Hardy,
        skills,
        gender,
      },
    ],
  }
}

export function findSkillInstanceIdByBaseId(
  skillIds: string[],
  baseSkillId: string,
  getBaseSkillId: (skillId: string) => string | undefined,
): string {
  const id = skillIds.find(sid => getBaseSkillId(sid) === baseSkillId)
  if (!id) throw new Error(`Skill instance for base skill '${baseSkillId}' not found`)
  return id
}

export function makeUseSkillContext(params: {
  petId: string
  skillId: string
  originPlayerId: string
  targetId: string
  power: number
  element: UseSkillContextData['element']
  category?: UseSkillContextData['category']
  targetOpinion?: UseSkillContextData['selectTarget']
}): UseSkillContextData {
  return {
    type: 'use-skill',
    parentId: 'test-phase',
    petId: params.petId,
    skillId: params.skillId,
    originPlayerId: params.originPlayerId,
    selectTarget: params.targetOpinion ?? AttackTargetOpinion.opponent,
    priority: 0,
    category: params.category ?? Category.Physical,
    element: params.element,
    power: params.power,
    accuracy: 100,
    petAccuracy: 100,
    rage: 0,
    evasion: 0,
    critRate: 7,
    ignoreShield: false,
    ignoreStageStrategy: IgnoreStageStrategy.none,
    multihit: 1,
    available: true,
    actualTargetId: params.targetId,
    hitResult: false,
    crit: false,
    multihitResult: 1,
    currentHitCount: 1,
    damageType: DamageType.Physical,
    typeMultiplier: 1,
    stabMultiplier: 1,
    critMultiplier: 2,
    baseDamage: 0,
    randomFactor: 1,
    defeated: false,
  }
}

export function makeUseSkillContextFromSkill(params: {
  battle: BattleInstance
  petId: string
  skillId: string
  originPlayerId: string
  fallbackTargetId: string
  parentId?: string
}): UseSkillContextData {
  const { battle, petId, skillId, originPlayerId, fallbackTargetId, parentId } = params
  const { world, skillSystem, playerSystem } = battle
  const targetOpinion = skillSystem.getTarget(world, skillId)
  const { playerAId, playerBId } = getBattlePlayerIds(world)
  const actualTargetId = targetOpinion === AttackTargetOpinion.self
    ? petId
    : (targetOpinion === AttackTargetOpinion.opponent
      ? playerSystem.getActivePet(world, originPlayerId === playerAId ? playerBId : playerAId).id
      : fallbackTargetId)
  const ctx = makeUseSkillContext({
    petId,
    skillId,
    originPlayerId,
    targetId: actualTargetId,
    power: skillSystem.getPower(world, skillId),
    element: skillSystem.getElement(world, skillId),
    category: skillSystem.getCategory(world, skillId),
    targetOpinion,
  })
  if (parentId) ctx.parentId = parentId
  ctx.priority = skillSystem.getPriority(world, skillId)
  ctx.rage = skillSystem.getRage(world, skillId)
  ctx.accuracy = skillSystem.getAccuracy(world, skillId)
  ctx.multihit = skillSystem.getMultihit(world, skillId)
  ctx.ignoreShield = skillSystem.getIgnoreShield(world, skillId)
  return ctx
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

export async function runAutoBattleWithSeed(
  repo: V2DataRepository,
  seed: string,
): Promise<{
  winnerSide?: 'A' | 'B'
  turn: number
  messageTypeCount: Record<string, number>
  critCount: number
  missCount: number
  remainingHpByPlayer: number[]
}> {
  const battle = createBattleFromConfig(
    {
      name: 'A',
      team: [
        {
          name: 'A-pet',
          species: 'pet_dilan',
          level: 50,
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          nature: Nature.Hardy,
          skills: ['skill_shuipao', 'skill_paida'],
          gender: Gender.Male,
        },
      ],
    },
    {
      name: 'B',
      team: [
        {
          name: 'B-pet',
          species: 'pet_dilan',
          level: 50,
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          nature: Nature.Hardy,
          skills: ['skill_shuipao', 'skill_paida'],
          gender: Gender.Male,
        },
      ],
    },
    repo,
    { seed },
  )

  const { world } = battle
  const { playerAId, playerBId } = getBattlePlayerIds(world)
  const system = new LocalBattleSystemV2(battle)
  const messages: BattleMessage[] = []
  system.BattleEvent(msg => messages.push(msg))

  await system.ready()
  await sleep(20)

  let turn = 0
  const maxTurns = 60
  while (turn < maxTurns) {
    const state = await system.getState()
    if (state.status === BattleStatus.Ended) break
    turn++

    const selA = await system.getAvailableSelection(playerAId as unknown as playerId)
    const selB = await system.getAvailableSelection(playerBId as unknown as playerId)
    const actionA = selA.find(s => s.type === 'use-skill') ?? selA[0]
    const actionB = selB.find(s => s.type === 'use-skill') ?? selB[0]
    if (actionA) await system.submitAction(actionA)
    if (actionB) await system.submitAction(actionB)
    await sleep(30)
  }

  const finalState = await system.getState()
  const messageTypeCount: Record<string, number> = {}
  let critCount = 0
  let missCount = 0
  for (const msg of messages) {
    messageTypeCount[msg.type] = (messageTypeCount[msg.type] ?? 0) + 1
    if (msg.type === BattleMessageType.Damage && (msg as { data?: { isCrit?: boolean } }).data?.isCrit) {
      critCount++
    }
    if (msg.type === BattleMessageType.SkillMiss) missCount++
  }

  const remainingHpByPlayer = finalState.players.map(p => {
    const activePet = p.team?.find(pet => pet.id === p.activePet)
    return activePet?.currentHp ?? 0
  })

  await system.cleanup()
  const victorId = typeof world.state.victor === 'string' ? world.state.victor : undefined
  return {
    winnerSide: victorId === playerAId ? 'A' : (victorId === playerBId ? 'B' : undefined),
    turn,
    messageTypeCount,
    critCount,
    missCount,
    remainingHpByPlayer,
  }
}
