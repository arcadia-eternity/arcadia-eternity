import { BattleMessageType, EffectTrigger, type DamageResult } from '@arcadia-eternity/const'
import { DamageContext, HealContext, type AllContext } from './context'
import { damagePoints, freezeDamageRecord, type DamageRule } from './damageResolution'
import { runDamageEvaluation } from './damageEvaluation'
import { settleDamageState } from './damageState'
import { notifyHeal, prepareHeal } from './phase/heal'

function damageAncestors(event: DamageContext): DamageContext[] {
  const ancestors: DamageContext[] = []
  for (let parent: AllContext | null = event.parent; parent; parent = parent.parent) {
    if (parent instanceof DamageContext) ancestors.push(parent)
  }
  return ancestors
}

type HealReplacement = { event: HealContext; hp: number }

class EventResolver {
  private modifiedDamage = 0
  private shieldAbsorbed = 0
  private heal?: HealReplacement
  private failure?: DamageResult['reason']
  private directRules: DamageRule[] = []

  constructor(private readonly event: DamageContext) {}

  resolve(): DamageResult {
    const event = this.event
    const { battle, resolution, origin } = event
    if (resolution.intent) throw new Error('Damage proposal already submitted')
    const ancestors = damageAncestors(event)
    const id = battle.allocateEventId('damage')
    const causeId = origin.causeId ?? ancestors[0]?.resolution.intent?.id
    resolution.intent = freezeDamageRecord({
      id,
      targetId: event.target.id,
      baseDamage: event.baseDamage,
      randomFactor: event.randomFactor,
      crit: event.crit,
      effectiveness: event.effectiveness,
      damageType: event.damageType,
      element: event.element,
      origin,
      policy: event.policy,
    })

    if (
      origin.effectId &&
      ancestors.some(
        parent => parent.origin.effectId === origin.effectId && parent.origin.executorId === origin.executorId,
      )
    ) {
      this.failure = 'reaction-cycle'
    } else if (event.target.currentHp <= 0 || !event.target.isAlive) {
      this.failure = 'target-defeated'
    } else {
      runDamageEvaluation(battle, event, () => this.evaluate())
    }
    if (!event.available) this.failure = 'disabled'
    if (!this.failure && !resolution.payments.validate()) this.failure = 'payment-unavailable'

    const result = this.commit(causeId)
    this.publish(result)
    return result
  }

  private commit(causeId?: string): DamageResult {
    const event = this.event
    const { resolution, origin } = event
    const intent = resolution.intent!
    const hpBefore = event.target.currentHp
    const status =
      this.failure === 'disabled' ? 'cancelled' : this.failure ? 'failed' : this.heal ? 'replaced' : 'committed'
    const hpLoss = status === 'committed' ? Math.min(hpBefore, resolution.remaining!) : 0
    const hpAfter = !this.failure && this.heal ? this.heal.hp : hpBefore - hpLoss
    const result: DamageResult = freezeDamageRecord({
      id: intent.id,
      causeId,
      intent,
      origin,
      status,
      reason: this.failure,
      targetId: event.target.id,
      originalDamage: damagePoints(intent.baseDamage * intent.randomFactor),
      modifiedDamage: this.modifiedDamage,
      preventedDamage: this.failure ? 0 : this.modifiedDamage - resolution.remaining!,
      shieldAbsorbed: this.failure ? 0 : this.shieldAbsorbed,
      hpBefore,
      hpAfter,
      hpLoss,
      trace: Object.freeze([...resolution.trace]),
      payments: this.failure ? Object.freeze([]) : resolution.payments.receipts(),
    })
    if (!this.failure) {
      resolution.payments.commit()
      event.target.attributeSystem.setCurrentHp(hpAfter)
    } else {
      resolution.payments.clear()
    }
    resolution.result = result
    Object.freeze(resolution)
    Object.freeze(event)

    return result
  }

  private publish(result: DamageResult): void {
    const event = this.event
    const { battle, resolution } = event
    const { status, hpLoss, hpAfter } = result
    if (status === 'committed') {
      battle.emitMessage(BattleMessageType.Damage, {
        currentHp: hpAfter,
        maxHp: event.target.stat.maxHp,
        source: event.source.id,
        target: event.target.id,
        damage: hpLoss,
        isCrit: event.crit,
        effectiveness: event.effectiveness,
        damageType: event.damageType,
        result,
      })
    } else {
      battle.emitMessage(BattleMessageType.DamageFail, {
        source: event.source.id,
        target: event.target.id,
        reason: this.failure ?? 'replaced',
        result,
      })
    }
    if (this.failure) return
    resolution.payments.notify()
    if (this.heal) notifyHeal(this.heal.event, battle)
    if (hpLoss > 0) {
      battle.applyEffects(event, EffectTrigger.OnDamage)
      if (event.policy.skillReactions) {
        battle.applyEffects(event, EffectTrigger.PostDamage)
        if (event.crit) battle.applyEffects(event, EffectTrigger.OnCritPostDamage)
      }
      settleDamageState(event, battle)
    }
  }

  private evaluate(): void {
    const event = this.event
    const { battle, resolution } = event
    if (event.policy.skillModifiers) battle.applyEffects(event, EffectTrigger.OnBeforeCalculateDamage)
    this.modifiedDamage = resolution.evaluate()
    resolution.remaining = this.modifiedDamage
    this.directRules = [...resolution.candidates.values()]
    if (!event.available || !resolution.remaining) return

    const attemptedShields = new Set<string>()
    while (event.available && !this.failure && !this.heal && resolution.remaining > 0) {
      battle.executionBudget.chargeComputation()
      resolution.candidates.clear()
      for (const rule of this.directRules) resolution.addRule(rule)
      battle.applyEffects(event, EffectTrigger.OnDamageReplacement)
      if (!event.available) break
      if (event.policy.shields) battle.applyEffects(event, EffectTrigger.Shield)
      if (!event.available) break
      const candidates = [...resolution.candidates.values()].filter(rule => rule.target === event.target)
      // Stable sort preserves container/declaration order for ties on every peer.
      candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      if (this.applyFirst(candidates.filter(r => r.change.kind === 'redirect' || r.change.kind === 'heal'))) continue
      if (this.applyFirst(candidates.filter(r => r.change.kind === 'prevent'))) continue

      if (event.policy.shields) {
        const shield = event.target.getShieldMark().find(mark => !attemptedShields.has(mark.id))
        if (shield) {
          attemptedShields.add(shield.id)
          const before = resolution.remaining
          const absorbed = resolution.payments.reserve(shield, before, true, 'shield')
          if (absorbed) {
            this.shieldAbsorbed += absorbed
            resolution.remaining -= absorbed
            resolution.record('shield', shield.id, before, resolution.remaining)
          }
          continue
        }
      }
      if (!this.applyFirst(candidates.filter(r => r.change.kind === 'survive'))) break
    }
  }

  private applyFirst(rules: DamageRule[]): boolean {
    const event = this.event
    const { resolution, battle } = event
    for (const rule of rules) {
      const before = resolution.remaining!
      const change = rule.change
      let after = before
      switch (change.kind) {
        case 'redirect':
          if (
            change.target === event.target ||
            battle.petMap.get(change.target.id) !== change.target ||
            !change.target.isAlive ||
            change.target.currentHp <= 0
          )
            continue
          break
        case 'heal':
          if (change.source.battle !== battle || !Number.isFinite(change.fraction ?? 1) || (change.fraction ?? 1) < 0)
            continue
          break
        case 'prevent':
          after -= Math.min(before, damagePoints(change.amount ?? before * (change.fraction ?? 1)))
          break
        case 'survive':
          if (before < event.target.currentHp) continue
          after = Math.min(before, Math.max(0, event.target.currentHp - damagePoints(change.hp)))
          break
      }
      if ((change.kind === 'prevent' || change.kind === 'survive') && before === after) continue
      if (rule.cost && !resolution.payments.reserve(rule.cost.mark, rule.cost.stacks)) continue
      resolution.applied.add(rule.id)
      if (change.kind === 'redirect') event.target = change.target
      if (change.kind === 'heal') {
        const heal = new HealContext(
          change.source,
          change.source.source,
          event.target,
          damagePoints(before * (change.fraction ?? 1)),
        )
        const hp = prepareHeal(heal, battle)
        if (hp === undefined) this.failure = 'heal-failed'
        else this.heal = { event: heal, hp }
        after = 0
      }
      if (change.kind !== 'heal') resolution.remaining = after
      resolution.record(change.kind, rule.id, before, after)
      return true
    }
    return false
  }
}

export function resolveDamage(event: DamageContext): DamageResult {
  return new EventResolver(event).resolve()
}
