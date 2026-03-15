// battle/src/v2/systems/state-serializer.ts
// Converts World state to v1-compatible BattleState format.

import type { World, AttributeSystem, ModifierDef, AttributeValue } from '@arcadia-eternity/engine'
import { BattleStatus, BattlePhase, Element, Category, AttackTargetOpinion } from '@arcadia-eternity/const'
import type {
  BattleState, PlayerMessage, PetMessage, MarkMessage, SkillMessage,
  playerId, petId, speciesId, skillId, baseSkillId, markId, baseMarkId,
  MarkConfig, EntityModifierState, AttributeModifierInfo, ModifierInfo,
} from '@arcadia-eternity/const'
import type { PlayerSystem } from './player.system.js'
import type { PetSystem } from './pet.system.js'
import type { MarkSystem } from './mark.system.js'
import { BATTLE_OWNER_ID } from './mark.system.js'
import type { SkillSystem } from './skill.system.js'
import type { MarkData } from '../schemas/mark.schema.js'

export interface StateSerializerSystems {
  playerSystem: PlayerSystem
  petSystem: PetSystem
  markSystem: MarkSystem
  skillSystem: SkillSystem
  attrSystem: AttributeSystem
}

function toDisplayValue(value: AttributeValue): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value === null) return 'null'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function worldToBattleState(
  world: World,
  systems: StateSerializerSystems,
  viewerId?: string,
  showHidden = false,
): BattleState {
  const { playerSystem, petSystem, markSystem, skillSystem, attrSystem } = systems
  const playerAId = world.state.playerAId as string
  const playerBId = world.state.playerBId as string

  const status = mapStatus(world.state.status as string | undefined)
  const currentPhase = mapPhase(world.state.currentPhase as string | undefined)
  const currentTurn = (world.state.currentTurn as number) ?? 0

  const battleMarks: MarkMessage[] = markSystem
    .getMarksOnEntity(world, BATTLE_OWNER_ID)
    .map(m => serializeMark(world, systems, m))

  const players: PlayerMessage[] = []
  for (const pid of [playerAId, playerBId]) {
    const player = playerSystem.getOrThrow(world, pid)
    const isViewer = (viewerId !== undefined && viewerId === pid) || showHidden
    const alivePets = playerSystem.getAlivePets(world, pid)

    const team: PetMessage[] = player.battleTeamPetIds.map(
      petEntityId => serializePet(world, systems, petEntityId, isViewer, showHidden),
    )

    players.push({
      name: player.name,
      id: pid as unknown as playerId,
      rage: playerSystem.getRage(world, pid),
      maxRage: playerSystem.getMaxRage(world, pid),
      activePet: player.activePetId as unknown as petId,
      team,
      teamAlives: alivePets.length,
      modifierState: isViewer
        ? serializeModifierState(world, systems, pid)
        : undefined,
    })
  }

  return {
    status,
    currentPhase,
    currentTurn,
    marks: battleMarks,
    players,
  }
}

function serializePet(world: World, systems: StateSerializerSystems, petEntityId: string, isViewer: boolean, showHidden = false): PetMessage {
  const { petSystem, markSystem, skillSystem } = systems
  const pet = petSystem.getOrThrow(world, petEntityId)
  const shouldShowDetails = petSystem.isAppeared(world, petEntityId) || isViewer || showHidden
  const shouldShowModifiers = shouldShowDetails && (isViewer || showHidden)
  const maxHp = petSystem.getStatValue(world, petEntityId, 'maxHp')
  const marks = shouldShowDetails
    ? markSystem.getMarksOnEntity(world, petEntityId).map(m => serializeMark(world, systems, m))
    : []

  const msg: PetMessage = {
    isUnknown: !shouldShowDetails,
    name: shouldShowDetails ? petSystem.getName(world, petEntityId) : '',
    id: pet.id as unknown as petId,
    speciesID: shouldShowDetails ? (petSystem.getSpeciesId(world, petEntityId) as unknown as speciesId) : ('' as speciesId),
    element: shouldShowDetails ? (petSystem.getElement(world, petEntityId) as any) : Element.Normal as any,
    level: shouldShowDetails ? petSystem.getLevel(world, petEntityId) : 0,
    currentHp: shouldShowDetails ? petSystem.getCurrentHp(world, petEntityId) : 0,
    maxHp: shouldShowDetails ? maxHp : 0,
    marks,
    modifierState: shouldShowModifiers
      ? serializeModifierState(world, systems, pet.id)
      : undefined,
  }

  if (shouldShowDetails) {
    msg.skills = pet.skillIds.map((sid): SkillMessage => {
      const skill = skillSystem.getOrThrow(world, sid)
      const skillVisible = skillSystem.isAppeared(world, sid) || isViewer || showHidden
      if (!skillVisible) {
        return {
          isUnknown: true,
          id: sid as unknown as skillId,
          baseId: '' as baseSkillId,
          category: Category.Physical as any,
          element: Element.Normal as any,
          power: 0,
          rage: 0,
          accuracy: 0,
          priority: 0,
          target: AttackTargetOpinion.opponent as any,
          multihit: 1 as any,
          sureHit: false,
          tag: [],
        }
      }
      return {
        isUnknown: false,
        id: sid as unknown as skillId,
        baseId: skill.baseSkillId as unknown as baseSkillId,
        category: skillSystem.getCategory(world, sid) as any,
        element: skillSystem.getElement(world, sid) as any,
        power: skillSystem.getPower(world, sid),
        rage: skillSystem.getRage(world, sid),
        accuracy: skillSystem.getAccuracy(world, sid),
        priority: skillSystem.getPriority(world, sid),
        target: skillSystem.getTarget(world, sid) as any,
        multihit: skillSystem.getMultihit(world, sid) as any,
        sureHit: skillSystem.getSureHit(world, sid),
        tag: skillSystem.getTags(world, sid),
        modifierState: isViewer || showHidden
          ? serializeModifierState(world, systems, sid)
          : undefined,
      }
    })
    msg.stats = isViewer || showHidden ? {
      maxHp,
      atk: petSystem.getStatValue(world, petEntityId, 'atk'),
      def: petSystem.getStatValue(world, petEntityId, 'def'),
      spa: petSystem.getStatValue(world, petEntityId, 'spa'),
      spd: petSystem.getStatValue(world, petEntityId, 'spd'),
      spe: petSystem.getStatValue(world, petEntityId, 'spe'),
      accuracy: petSystem.getStatValue(world, petEntityId, 'accuracy'),
      critRate: petSystem.getStatValue(world, petEntityId, 'critRate'),
      evasion: petSystem.getStatValue(world, petEntityId, 'evasion'),
      ragePerTurn: petSystem.getStatValue(world, petEntityId, 'ragePerTurn'),
      weight: petSystem.getStatValue(world, petEntityId, 'weight'),
      height: petSystem.getStatValue(world, petEntityId, 'height'),
    } : undefined
  }

  return msg
}

function serializeModifierState(
  world: World,
  systems: Pick<StateSerializerSystems, 'petSystem' | 'markSystem' | 'skillSystem' | 'attrSystem'>,
  entityId: string,
): EntityModifierState {
  const store = systems.attrSystem.get(world, entityId)
  if (!store) return { attributes: [], hasModifiers: false }

  const attributes: AttributeModifierInfo[] = Object.keys(store.bases).map((attributeName) => {
    const baseValue = toDisplayValue(store.bases[attributeName] as AttributeValue)
    const currentValue = toDisplayValue(systems.attrSystem.getValue(world, entityId, attributeName))
    const mods = systems.attrSystem.getModifiers(world, entityId, attributeName)

    const modifiers: ModifierInfo[] = mods
      .slice()
      .sort((a, b) => b.priority - a.priority)
      .map((mod): ModifierInfo => toModifierInfo(world, systems, mod))

    return {
      attributeName,
      baseValue,
      currentValue,
      modifiers,
      isModified: modifiers.length > 0,
    }
  })

  return {
    attributes,
    hasModifiers: attributes.some(attr => attr.modifiers.length > 0),
  }
}

function toModifierInfo(
  world: World,
  systems: Pick<StateSerializerSystems, 'markSystem' | 'skillSystem'>,
  mod: ModifierDef,
): ModifierInfo {
  const sourceId = mod.sourceId
  const sourceMark = sourceId ? systems.markSystem.get(world, sourceId) : undefined
  const sourceSkill = sourceId ? systems.skillSystem.get(world, sourceId) : undefined
  const sourceType: ModifierInfo['sourceType'] = sourceMark
    ? 'mark'
    : sourceSkill
      ? 'skill'
      : 'other'
  const sourceName = sourceMark
    ? sourceMark.baseMarkId
    : sourceSkill
      ? sourceSkill.baseSkillId
      : undefined

  const value = mod.value.kind === 'static'
    ? toDisplayValue(mod.value.value)
    : 'dynamic'

  return {
    id: mod.id,
    type: mod.type,
    value,
    priority: mod.priority,
    sourceType,
    sourceId,
    sourceName,
  }
}

function serializeMark(world: World, systems: Pick<StateSerializerSystems, 'markSystem'>, mark: MarkData): MarkMessage {
  return {
    id: mark.id as unknown as markId,
    baseId: mark.baseMarkId as unknown as baseMarkId,
    stack: systems.markSystem.getStack(world, mark.id),
    duration: systems.markSystem.getDuration(world, mark.id),
    isActive: systems.markSystem.isActive(world, mark.id),
    config: systems.markSystem.getConfig(world, mark.id) as unknown as Partial<MarkConfig>,
  }
}

function mapStatus(status: string | undefined): BattleStatus {
  switch (status) {
    case 'active': return BattleStatus.OnBattle
    case 'ended': return BattleStatus.Ended
    default: return BattleStatus.Unstarted
  }
}

function mapPhase(phase: string | undefined): BattlePhase {
  switch (phase) {
    case 'selection': return BattlePhase.SelectionPhase
    case 'teamSelection': return BattlePhase.SelectionPhase
    case 'execution': return BattlePhase.ExecutionPhase
    case 'switch': return BattlePhase.SwitchPhase
    case 'ended': return BattlePhase.Ended
    default: return BattlePhase.StartPhase
  }
}
