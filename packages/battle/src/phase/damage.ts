import { EffectTrigger, BattleMessageType, DamageType, Element } from '@arcadia-eternity/const'
import { SynchronousPhase } from './base'
import { DamageContext } from '../context'
import type { Battle } from '../battle'
import { Pet } from '../pet'
import type { MarkInstance } from '../mark'
import type { SkillInstance } from '../skill'

/**
 * DamagePhase handles damage dealing operations
 * Corresponds to DamageContext and replaces damage calculation logic
 */
export class DamagePhase extends SynchronousPhase<DamageContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: any, // UseSkillContext or EffectContext
    private readonly source: MarkInstance | SkillInstance,
    private readonly target: Pet,
    private readonly baseDamage: number,
    private readonly damageType: DamageType = DamageType.Effect,
    private readonly crit: boolean = false,
    private readonly effectiveness: number = 1,
    private readonly ignoreShield: boolean = false,
    private readonly randomFactor: number = 1,
    private readonly modified: [number, number] = [0, 0],
    private readonly minThreshold: number = 0,
    private readonly maxThreshold: number = Number.MAX_SAFE_INTEGER,
    private readonly element?: Element,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): DamageContext {
    return new DamageContext(
      this.parentContext,
      this.source,
      this.target,
      this.baseDamage,
      this.damageType,
      this.crit,
      this.effectiveness,
      this.ignoreShield,
      this.randomFactor,
      this.modified,
      this.minThreshold,
      this.maxThreshold,
      this.element,
    )
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the damage operation logic (extracted from Pet.damage)
    executeDamageOperation(context, this.battle)
  }
}

/**
 * Extracted damage operation logic from Pet.damage
 * This function contains the core damage calculation and application logic
 */
export function executeDamageOperation(context: DamageContext, battle: Battle): void {
  // Handle damage from pets (skills) vs other sources differently
  if ([DamageType.Physical, DamageType.Special].includes(context.damageType)) {
    battle.applyEffects(context, EffectTrigger.OnBeforeCalculateDamage)
    context.updateDamageResult()

    if (!context.available) {
      battle.emitMessage(BattleMessageType.DamageFail, {
        source: context.source.id,
        target: context.target.id,
        reason: 'disabled',
      })
      return
    }

    // Apply shield effects if not ignoring shields
    if (!context.ignoreShield) {
      battle.applyEffects(context, EffectTrigger.Shield)
      const shields = context.target.getShieldMark()
      shields.forEach(s => {
        context.damageResult -= s.consumeStack(context, context.damageResult)
      })
    }
  } else {
    // For non-pet sources (marks, effects), just calculate damage
    context.updateDamageResult()
  }

  // Apply damage to target
  const newHp = Math.max(0, context.target.currentHp - context.damageResult)
  context.target.currentHp = newHp
  battle.applyEffects(context, EffectTrigger.OnDamage)

  // Emit damage message
  battle.emitMessage(BattleMessageType.Damage, {
    currentHp: context.target.currentHp,
    maxHp: context.target.stat.maxHp!,
    source: context.source.id,
    target: context.target.id,
    damage: context.damageResult,
    isCrit: context.crit,
    effectiveness: context.effectiveness,
    damageType: context.damageType,
  })

  // Apply post-damage effects for pet sources
  if ([DamageType.Physical, DamageType.Special].includes(context.damageType)) {
    battle.applyEffects(context, EffectTrigger.PostDamage)
    if (context.crit) {
      battle.applyEffects(context, EffectTrigger.OnCritPostDamage) // Trigger crit post-damage effects
    }
  }

  // Update alive status
  if (context.target.currentHp === 0) {
    context.target.isAlive = false
  }
}
