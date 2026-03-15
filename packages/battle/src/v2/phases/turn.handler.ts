// battle/src/v2/phases/turn.handler.ts
// TurnHandler — full turn execution logic ported from v1.

import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { Category, AttackTargetOpinion, EffectTrigger, type PlayerSelection } from '@arcadia-eternity/const'
import type { PlayerSystem } from '../systems/player.system.js'
import type { PetSystem } from '../systems/pet.system.js'
import type { SkillSystem } from '../systems/skill.system.js'
import type { MarkSystem } from '../systems/mark.system.js'
import type { UseSkillContextData, SwitchPetContextData } from '../schemas/context.schema.js'
import { getSeer2ElementChart } from '../systems/element-chart.js'
import { getEffectiveness } from '@arcadia-eternity/plugin-element'
import { queryByTag } from '@arcadia-eternity/engine'

export interface TurnData {
  turnNumber: number
  selections?: Record<string, PlayerSelection>
  plannedSkillPetIds?: string[]
  executedSkillPetIds?: string[]
}

interface QueuedAction {
  type: 'skill' | 'switch'
  playerId: string
  priority: number
  speed: number
  data: UseSkillContextData | SwitchPetContextData
}

export class TurnHandler implements PhaseHandler<TurnData> {
  readonly type = 'turn'

  constructor(
    private playerSystem: PlayerSystem,
    private petSystem: PetSystem,
    private skillSystem: SkillSystem,
    private markSystem: MarkSystem,
    private phaseManager: PhaseManager,
    private effectPipeline: EffectPipeline,
  ) {}

  initialize(world: World, phase: PhaseDef): TurnData {
    const currentTurn = ((world.state.currentTurn as number) ?? 0) + 1
    world.state.currentTurn = currentTurn
    const init = phase.data as Partial<TurnData> | undefined
    return {
      turnNumber: currentTurn,
      selections: init?.selections,
      plannedSkillPetIds: [],
      executedSkillPetIds: [],
    }
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as TurnData
    const selections = data.selections ?? {}

    bus.emit(world, 'turnStart', { turn: data.turnNumber })

    const playerAId = world.state.playerAId as string
    const playerBId = world.state.playerBId as string

    await this.effectPipeline.fire(world, EffectTrigger.TurnStart, {
      trigger: EffectTrigger.TurnStart,
      sourceEntityId: '',
      turn: data.turnNumber,
    })

    // Build action queue from selections
    const actions: QueuedAction[] = []

    for (const playerId of [playerAId, playerBId]) {
      const sel = selections[playerId]
      if (!sel) continue

      switch (sel.type) {
        case 'use-skill': {
          const pet = this.playerSystem.getActivePet(world, playerId)
          const targetPet = sel.target === AttackTargetOpinion.opponent
            ? this.playerSystem.getActivePet(world, playerId === playerAId ? playerBId : playerAId)
            : pet

          const skillElement = this.skillSystem.getElement(world, sel.skill)
          const skillCategory = this.skillSystem.getCategory(world, sel.skill)
          const elementChart = getSeer2ElementChart()
          const typeMultiplier = getEffectiveness(elementChart, skillElement, this.petSystem.getElement(world, targetPet.id))
          const stabMultiplier = this.petSystem.getElement(world, pet.id) === skillElement ? 1.5 : 1

          const ctx: UseSkillContextData = {
            type: 'use-skill',
            parentId: phase.id,
            petId: pet.id,
            skillId: sel.skill,
            originPlayerId: playerId,
            selectTarget: sel.target,
            priority: this.skillSystem.getPriority(world, sel.skill),
            category: skillCategory,
            element: skillElement,
            power: this.skillSystem.getPower(world, sel.skill),
            accuracy: this.skillSystem.getAccuracy(world, sel.skill),
            petAccuracy: this.petSystem.getStatValue(world, pet.id, 'accuracy'),
            rage: this.skillSystem.getRage(world, sel.skill),
            evasion: this.petSystem.getStatValue(world, targetPet.id, 'evasion'),
            critRate: this.petSystem.getStatValue(world, pet.id, 'critRate'),
            ignoreShield: this.skillSystem.getIgnoreShield(world, sel.skill),
            ignoreStageStrategy: this.skillSystem.getIgnoreOpponentStageStrategy(world, sel.skill),
            multihit: this.skillSystem.getMultihit(world, sel.skill),
            available: true,
            actualTargetId: targetPet.id,
            hitResult: false,
            crit: false,
            multihitResult: 1,
            currentHitCount: 1,
            damageType: skillCategory === Category.Physical || skillCategory === Category.Climax ? 'physical' : 'special',
            typeMultiplier,
            stabMultiplier,
            critMultiplier: 2,
            baseDamage: 0,
            randomFactor: 1,
            defeated: false,
          }

          await this.effectPipeline.fire(world, EffectTrigger.BeforeSort, {
            trigger: EffectTrigger.BeforeSort,
            sourceEntityId: pet.id,
            context: ctx,
          })

          actions.push({
            type: 'skill',
            playerId,
            priority: ctx.priority,
            speed: this.petSystem.getStatValue(world, pet.id, 'spe'),
            data: ctx,
          })
          break
        }
        case 'switch-pet': {
          const activePet = this.playerSystem.getActivePet(world, playerId)
          const ctx: SwitchPetContextData = {
            type: 'switch-pet',
            parentId: phase.id,
            originPlayerId: playerId,
            switchInPetId: sel.pet,
            switchOutPetId: activePet.id,
          }
          actions.push({
            type: 'switch',
            playerId,
            priority: 0,
            speed: 0,
            data: ctx,
          })
          break
        }
        case 'do-nothing':
          break
        case 'surrender': {
          const opponentId = playerId === playerAId ? playerBId : playerAId
          world.state.victor = opponentId
          world.state.endReason = 'surrender'
          world.state.status = 'ended'
          bus.emit(world, 'turnEnd', { turn: data.turnNumber })
          return { success: true, state: 'completed', data }
        }
      }
    }

    // Sort: switch first, then by skill priority desc, then speed desc
    actions.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'switch' ? -1 : 1
      }
      if (a.type === 'skill' && b.type === 'skill') {
        if (a.priority !== b.priority) return b.priority - a.priority
        if (a.speed !== b.speed) return b.speed - a.speed
      }
      return 0
    })

    data.plannedSkillPetIds = actions
      .filter((action): action is QueuedAction & { type: 'skill'; data: UseSkillContextData } => action.type === 'skill')
      .map(action => action.data.petId)

    // Execute actions sequentially
    for (const action of actions) {
      if (world.state.status === 'ended' || world.state.victor) break

      if (action.type === 'skill') {
        if (!Array.isArray(data.executedSkillPetIds)) data.executedSkillPetIds = []
        data.executedSkillPetIds.push((action.data as UseSkillContextData).petId)
        await this.phaseManager.execute(world, 'skill', bus, { context: action.data })
      } else {
        await this.phaseManager.execute(world, 'switch', bus, { context: action.data })
      }

      await this.phaseManager.execute(world, 'markCleanup', bus, {})
    }

    await this.effectPipeline.fire(world, EffectTrigger.TurnEnd, {
      trigger: EffectTrigger.TurnEnd,
      sourceEntityId: '',
      turn: data.turnNumber,
    })

    // Add turn rage to both players
    for (const playerId of [playerAId, playerBId]) {
      const activePet = this.playerSystem.getActivePet(world, playerId)
      if (!this.petSystem.isAlive(world, activePet.id)) continue
      const ragePerTurn = this.petSystem.getStatValue(world, activePet.id, 'ragePerTurn')
      await this.phaseManager.execute(world, 'rage', bus, {
        context: {
          type: 'rage',
          parentId: phase.id,
          targetPlayerId: playerId,
          reason: 'turn',
          modifiedType: 'add',
          value: ragePerTurn,
          ignoreRageObtainEfficiency: false,
          modified: [0, 0],
          rageChangeResult: 0,
          available: true,
        },
      })
    }

    // Update marks (decrement duration)
    const markIds = queryByTag(world, 'mark')
    for (const markId of markIds) {
      const mark = this.markSystem.get(world, markId)
      if (mark && this.markSystem.isActive(world, markId)) {
        await this.phaseManager.execute(world, 'markUpdate', bus, { markId })
      }
    }

    // Final mark cleanup
    await this.phaseManager.execute(world, 'markCleanup', bus, {})

    bus.emit(world, 'turnEnd', { turn: data.turnNumber })

    return { success: true, state: 'completed', data }
  }
}
