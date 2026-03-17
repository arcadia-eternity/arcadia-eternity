// battle/src/v2/phases/skill.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { GameRng } from '@arcadia-eternity/engine'
import { Category, EffectTrigger, IgnoreStageStrategy } from '@arcadia-eternity/const'
import type { PlayerSystem } from '../systems/player.system.js'
import type { PetSystem } from '../systems/pet.system.js'
import type { SkillSystem } from '../systems/skill.system.js'
import type { StatStageMarkSystem } from '../systems/stat-stage-mark.system.js'
import type { UseSkillContextData, DamageContextData } from '../schemas/context.schema.js'

export interface SkillPhaseData {
  context: UseSkillContextData
}

const STAGE_MULTIPLIER_TABLE: Record<number, number> = {
  [-6]: 2 / 8, [-5]: 2 / 7, [-4]: 2 / 6, [-3]: 2 / 5,
  [-2]: 2 / 4, [-1]: 2 / 3, [0]: 1,
  [1]: 3 / 2, [2]: 4 / 2, [3]: 5 / 2,
  [4]: 6 / 2, [5]: 7 / 2, [6]: 8 / 2,
}

export class SkillHandler implements PhaseHandler<SkillPhaseData> {
  readonly type = 'skill'
  private readonly historyLimit = 10

  constructor(
    private playerSystem: PlayerSystem,
    private petSystem: PetSystem,
    private skillSystem: SkillSystem,
    private statStageSystem: StatStageMarkSystem,
    private phaseManager: PhaseManager,
    private effectPipeline: EffectPipeline,
  ) {}

  private shouldIgnoreStage(stage: number, strategy: UseSkillContextData['ignoreStageStrategy']): boolean {
    if (strategy === IgnoreStageStrategy.all) return stage !== 0
    if (strategy === IgnoreStageStrategy.positive) return stage > 0
    if (strategy === IgnoreStageStrategy.negative) return stage < 0
    return false
  }

  private getStatValueWithStrategy(
    world: World,
    petId: string,
    stat: 'atk' | 'def' | 'spa' | 'spd',
    strategy: UseSkillContextData['ignoreStageStrategy'],
  ): number {
    const value = this.petSystem.getStatValue(world, petId, stat)
    const stage = this.statStageSystem.getStage(world, petId, stat)
    if (!this.shouldIgnoreStage(stage, strategy)) return value
    const mult = STAGE_MULTIPLIER_TABLE[stage] ?? 1
    if (mult === 0) return value
    return value / mult
  }

  private async applyDefeatIfNeeded(
    world: World,
    bus: EventBus,
    ctx: UseSkillContextData,
  ): Promise<void> {
    if (ctx.defeated) return
    if (!ctx.actualTargetId) return
    if (this.petSystem.isAlive(world, ctx.actualTargetId)) return

    bus.emit(world, 'petDefeated', {
      petId: ctx.actualTargetId,
      killerId: ctx.petId,
    })
    world.state.lastKillerId = ctx.petId
    ctx.defeated = true

    await this.effectPipeline.fire(world, EffectTrigger.OnDefeat, {
      trigger: EffectTrigger.OnDefeat,
      sourceEntityId: ctx.actualTargetId,
      context: ctx,
      killerId: ctx.petId,
    })
  }

  initialize(_world: World, phase: PhaseDef): SkillPhaseData {
    return phase.data as SkillPhaseData
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as SkillPhaseData
    const ctx = data.context
    const rng = (world.systems as any).rng as GameRng

    await this.effectPipeline.fire(world, EffectTrigger.BeforeUseSkillCheck, {
      trigger: EffectTrigger.BeforeUseSkillCheck,
      sourceEntityId: ctx.petId,
      context: ctx,
    })

    if (!ctx.available) {
      bus.emit(world, 'skillFail', { petId: ctx.petId, skillId: ctx.skillId, reason: 'disabled' })
      return { success: true, state: 'completed', data }
    }

    // Check pet is alive
    if (!this.petSystem.isAlive(world, ctx.petId)) {
      bus.emit(world, 'skillFail', { petId: ctx.petId, skillId: ctx.skillId, reason: 'faint' })
      return { success: true, state: 'completed', data }
    }

    // Check rage
    const currentRage = this.playerSystem.getRage(world, ctx.originPlayerId)
    if (currentRage < ctx.rage) {
      bus.emit(world, 'skillFail', { petId: ctx.petId, skillId: ctx.skillId, reason: 'noRage' })
      return { success: true, state: 'completed', data }
    }

    // Determine actual target
    if (!ctx.actualTargetId) {
      bus.emit(world, 'skillFail', { petId: ctx.petId, skillId: ctx.skillId, reason: 'noTarget' })
      return { success: true, state: 'completed', data }
    }

    // Track skill usage
    const pet = this.petSystem.getOrThrow(world, ctx.petId)
    const currentBaseSkillId = this.skillSystem.get(world, ctx.skillId)?.baseSkillId ?? ctx.skillId
    pet.lastSkillId = ctx.skillId
    if (pet.lastBaseSkillId === currentBaseSkillId) {
      pet.lastSkillUsedTimes++
    } else {
      pet.lastBaseSkillId = currentBaseSkillId
      pet.lastSkillUsedTimes = 1
    }
    pet.skillHistorySkillIds.push(ctx.skillId)
    pet.skillHistoryBaseIds.push(currentBaseSkillId)
    if (pet.skillHistorySkillIds.length > this.historyLimit) {
      pet.skillHistorySkillIds.splice(0, pet.skillHistorySkillIds.length - this.historyLimit)
    }
    if (pet.skillHistoryBaseIds.length > this.historyLimit) {
      pet.skillHistoryBaseIds.splice(0, pet.skillHistoryBaseIds.length - this.historyLimit)
    }
    // v1 visibility semantics: a skill becomes visible once used.
    this.skillSystem.setAppeared(world, ctx.skillId, true)

    bus.emit(world, 'skillUse', {
      petId: ctx.petId,
      skillId: ctx.skillId,
      baseSkillId: this.skillSystem.get(world, ctx.skillId)?.baseSkillId ?? ctx.skillId,
      target: ctx.selectTarget,
      targetId: ctx.actualTargetId,
      rage: ctx.rage,
    })

    // Consume rage via rage phase
    await this.phaseManager.execute(world, 'rage', bus, {
      context: {
        type: 'rage',
        parentId: phase.id,
        targetPlayerId: ctx.originPlayerId,
        reason: 'skill',
        modifiedType: 'reduce',
        value: ctx.rage,
        ignoreRageObtainEfficiency: false,
        modified: [0, 0],
        rageChangeResult: 0,
        available: true,
      },
    })

    await this.effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: ctx.petId,
      context: ctx,
    })

    // Read sureHit/sureCrit from SkillData
    const skillData = this.skillSystem.get(world, ctx.skillId)
    const sureHit = skillData?.sureHit ?? false
    const sureCrit = skillData?.sureCrit ?? false

    // Determine multihit count
    const multihit = ctx.multihit
    let hitCount: number
    if (typeof multihit === 'number') {
      hitCount = multihit
    } else {
      const [min, max] = multihit
      hitCount = min + Math.floor(rng.next() * (max - min + 1))
    }
    ctx.multihitResult = hitCount

    // Hit check (accuracy vs evasion)
    const hitRoll = rng.next() * 100
    const hitThreshold = sureHit ? 100 : ctx.accuracy * (ctx.petAccuracy / 100) * (1 - ctx.evasion / 100)
    ctx.hitResult = hitRoll < hitThreshold

    if (!ctx.hitResult) {
      bus.emit(world, 'skillMiss', {
        petId: ctx.petId,
        targetId: ctx.actualTargetId,
        skillId: ctx.skillId,
      })
      await this.effectPipeline.fire(world, EffectTrigger.OnMiss, {
        trigger: EffectTrigger.OnMiss,
        sourceEntityId: ctx.petId,
        context: ctx,
      })
      await this.applyDefeatIfNeeded(world, bus, ctx)
      bus.emit(world, 'skillUseEnd', { petId: ctx.petId })
      return { success: true, state: 'completed', data }
    }

    // Crit check
    const critRoll = rng.next() * 100
    const critThreshold = sureCrit ? 100 : ctx.critRate
    ctx.crit = critRoll < critThreshold

    await this.effectPipeline.fire(world, EffectTrigger.BeforeMultiHit, {
      trigger: EffectTrigger.BeforeMultiHit,
      sourceEntityId: ctx.petId,
      context: ctx,
    })

    // Multihit loop
    for (ctx.currentHitCount = 1; ctx.currentHitCount <= hitCount; ctx.currentHitCount++) {
      // Check target still alive
      if (!this.petSystem.isAlive(world, ctx.actualTargetId)) {
        break
      }

      await this.effectPipeline.fire(world, EffectTrigger.BeforeHit, {
        trigger: EffectTrigger.BeforeHit,
        sourceEntityId: ctx.petId,
        context: ctx,
      })

      if (ctx.category !== Category.Status) {
        // Random factor (85-100%)
        ctx.randomFactor = 0.85 + rng.next() * 0.15

        // Power can be modified by effect pipeline (e.g. first/last turn multipliers).
        // Keep using context power instead of re-reading static skill config.
        const power = typeof ctx.power === 'number' ? ctx.power : this.skillSystem.getPower(world, ctx.skillId)
        const level = pet.level

        // Climax category: compare atk vs spa to decide physical/special
        let atkStat: number
        let defStat: number
        if (ctx.category === Category.Climax) {
          const atk = this.getStatValueWithStrategy(world, ctx.petId, 'atk', ctx.ignoreStageStrategy)
          const spa = this.getStatValueWithStrategy(world, ctx.petId, 'spa', ctx.ignoreStageStrategy)
          if (atk >= spa) {
            atkStat = atk
            defStat = this.getStatValueWithStrategy(world, ctx.actualTargetId, 'def', ctx.ignoreStageStrategy)
          } else {
            atkStat = spa
            defStat = this.getStatValueWithStrategy(world, ctx.actualTargetId, 'spd', ctx.ignoreStageStrategy)
          }
        } else if (ctx.category === Category.Physical) {
          atkStat = this.getStatValueWithStrategy(world, ctx.petId, 'atk', ctx.ignoreStageStrategy)
          defStat = this.getStatValueWithStrategy(world, ctx.actualTargetId, 'def', ctx.ignoreStageStrategy)
        } else {
          // Special
          atkStat = this.getStatValueWithStrategy(world, ctx.petId, 'spa', ctx.ignoreStageStrategy)
          defStat = this.getStatValueWithStrategy(world, ctx.actualTargetId, 'spd', ctx.ignoreStageStrategy)
        }

        // Base damage formula
        ctx.baseDamage = Math.floor(
          ((2 * level / 5 + 2) * power * atkStat / defStat) / 50 + 2,
        ) * ctx.typeMultiplier * ctx.stabMultiplier * (ctx.crit ? ctx.critMultiplier : 1)

        ctx.baseDamage = Math.floor(ctx.baseDamage * ctx.randomFactor)

        // Build damage context
        const damageCtx: DamageContextData = {
          type: 'damage',
          parentId: phase.id,
          sourceId: ctx.petId,
          targetId: ctx.actualTargetId,
          baseDamage: ctx.baseDamage,
          damageType: ctx.damageType,
          crit: ctx.crit,
          effectiveness: ctx.typeMultiplier,
          ignoreShield: ctx.ignoreShield,
          randomFactor: ctx.randomFactor,
          modified: [0, 0],
          minThreshold: 0,
          maxThreshold: Number.MAX_SAFE_INTEGER,
          damageResult: 0,
          available: true,
          element: ctx.element,
        }

        if (ctx.crit) {
          await this.effectPipeline.fire(world, EffectTrigger.OnCritPreDamage, {
            trigger: EffectTrigger.OnCritPreDamage,
            sourceEntityId: ctx.petId,
            context: ctx,
            damageContext: damageCtx,
          })
        }

        await this.effectPipeline.fire(world, EffectTrigger.PreDamage, {
          trigger: EffectTrigger.PreDamage,
          sourceEntityId: ctx.petId,
          context: ctx,
          damageContext: damageCtx,
        })

        await this.phaseManager.execute(world, 'damage', bus, { context: damageCtx })

        // Rage from taking damage (49 * damage / maxHp)
        if (damageCtx.available && damageCtx.damageResult > 0) {
          const maxHp = this.petSystem.getStatValue(world, ctx.actualTargetId, 'maxHp')
          const gainedRage = Math.floor((damageCtx.damageResult * 49) / maxHp)
          if (gainedRage > 0) {
            const targetOwnerId = this.petSystem.getOwner(world, ctx.actualTargetId)
            await this.phaseManager.execute(world, 'rage', bus, {
              context: {
                type: 'rage',
                parentId: phase.id,
                targetPlayerId: targetOwnerId,
                reason: 'damage',
                modifiedType: 'add',
                value: gainedRage,
                ignoreRageObtainEfficiency: false,
                modified: [0, 0],
                rageChangeResult: 0,
                available: true,
              },
            })
          }
        }

      }

      await this.effectPipeline.fire(world, EffectTrigger.OnHit, {
        trigger: EffectTrigger.OnHit,
        sourceEntityId: ctx.petId,
        context: ctx,
      })
    }

    // Hit reward rage (15 rage for attacker on hit, non-status only)
    if (ctx.hitResult && ctx.category !== Category.Status) {
      await this.phaseManager.execute(world, 'rage', bus, {
        context: {
          type: 'rage',
          parentId: phase.id,
          targetPlayerId: ctx.originPlayerId,
          reason: 'skillHit',
          modifiedType: 'add',
          value: 15,
          ignoreRageObtainEfficiency: false,
          modified: [0, 0],
          rageChangeResult: 0,
          available: true,
        },
      })
    }

    // v1 order: defeat is checked after hit loop, so killing hits still trigger OnHit.
    await this.applyDefeatIfNeeded(world, bus, ctx)

    await this.effectPipeline.fire(world, EffectTrigger.SkillUseEnd, {
      trigger: EffectTrigger.SkillUseEnd,
      sourceEntityId: ctx.petId,
      context: ctx,
    })

    bus.emit(world, 'skillUseEnd', { petId: ctx.petId })

    return { success: true, state: 'completed', data }
  }
}
