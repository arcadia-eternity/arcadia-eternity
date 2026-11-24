import { BattleMessageType, EffectTrigger, type DamageResult, type DamagePayment } from '@arcadia-eternity/const'
import {
  ConsumeStackContext,
  DamageContext,
  DefeatContext,
  HealContext,
  RageContext,
  RemoveMarkContext,
  UseSkillContext,
  type AllContext,
  type DamageRule,
  type EffectContext,
} from '../context'
import { ContextPhase } from './base'
import { type MarkInstance, StatLevelMarkInstanceImpl } from '../mark'
import { Pet } from '../pet'
import { evaluateEventMagnitude } from '../modifierMath'
import { RagePhase } from './rage'
import type { Battle, BattleRng } from '../battle'
import { SkillInstance } from '../skill'
import { notifyHeal, prepareHeal } from './heal'

function damageAncestors(event: DamageContext): DamageContext[] {
  const ancestors: DamageContext[] = []
  for (let parent: AllContext | null = event.parent; parent; parent = parent.parent) {
    if (parent instanceof DamageContext) ancestors.push(parent)
  }
  return ancestors
}

type HealReplacement = { event: HealContext; hp: number }

/** A single execution/cleanup scope, including all synchronous result reactions. */
export class DamagePhase extends ContextPhase<DamageContext> {
  private readonly debits = new Map<MarkInstance, number>()
  private modifiedDamage = 0
  private shieldAbsorbed = 0
  private heal?: HealReplacement
  private failure?: DamageResult['reason']

  protected executeOperation(): void {
    const event = this.event
    const { battle, proposal, origin } = event
    if (proposal.intent) throw new Error('Damage proposal already submitted')
    const ancestors = damageAncestors(event)
    const id = battle.allocateEventId('damage')
    const causeId = origin.causeId ?? ancestors[0]?.proposal.intent?.id
    proposal.intent = freezeDamageRecord({
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
      const previous = evaluation
      evaluation = event
      try {
        this.evaluate()
      } finally {
        evaluation = previous
      }
    }
    if (!event.available) this.failure = 'disabled'
    if (!this.failure) {
      for (const { mark, actualAmount } of proposal.payments) {
        this.debits.set(mark, (this.debits.get(mark) ?? 0) + actualAmount)
      }
      for (const [mark, amount] of this.debits) {
        if (!canSpendStacks(event, mark) || !(mark.stack >= amount)) {
          this.failure = 'payment-unavailable'
          break
        }
      }
    }

    const result = this.commit(causeId)
    this.publish(result)
  }

  private evaluate(): void {
    const event = this.event
    const { battle, proposal } = event
    if (event.policy.skillModifiers) battle.applyEffects(event, EffectTrigger.OnBeforeCalculateDamage)
    this.modifiedDamage = calculateDamageMagnitude(event)
    proposal.remaining = this.modifiedDamage
    if (!event.available || !proposal.remaining) return
    const directRules = [...proposal.candidates.values()]

    const attemptedShields = new Set<string>()
    while (event.available && !this.failure && !this.heal && proposal.remaining > 0) {
      battle.executionBudget.chargeComputation()
      proposal.candidates.clear()
      for (const rule of directRules) event.addRule(rule)
      battle.applyEffects(event, EffectTrigger.OnDamageReplacement)
      if (!event.available) break
      if (event.policy.shields) battle.applyEffects(event, EffectTrigger.Shield)
      if (!event.available) break
      const candidates = [...proposal.candidates.values()].filter(rule => rule.target === event.target)
      // Stable sort preserves container/declaration order for ties on every peer.
      candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      if (this.applyFirst(candidates.filter(r => r.change.kind === 'redirect' || r.change.kind === 'heal'))) continue
      if (this.applyFirst(candidates.filter(r => r.change.kind === 'prevent'))) continue

      if (event.policy.shields) {
        const shield = event.target.marks.find(
          mark => mark.config.isShield && mark.isActive && !mark.isSuppressed && !attemptedShields.has(mark.id),
        )
        if (shield) {
          attemptedShields.add(shield.id)
          const before = proposal.remaining
          const absorbed = reserveDamageStacks(event, shield, before, 'shield')
          if (absorbed) {
            this.shieldAbsorbed += absorbed
            proposal.remaining -= absorbed
            proposal.trace.push(
              Object.freeze({
                kind: 'shield',
                id: shield.id,
                targetId: event.target.id,
                before,
                after: proposal.remaining,
              }),
            )
          }
          continue
        }
      }
      if (!this.applyFirst(candidates.filter(r => r.change.kind === 'survive'))) break
    }
  }

  private applyFirst(rules: DamageRule[]): boolean {
    const event = this.event
    const { proposal, battle } = event
    for (const rule of rules) {
      const before = proposal.remaining!
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
      if (rule.cost && !reserveDamageStacks(event, rule.cost.mark, rule.cost.stacks, 'rule')) continue
      proposal.applied.add(rule.id)
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
      if (change.kind !== 'heal') proposal.remaining = after
      proposal.trace.push(Object.freeze({ kind: change.kind, id: rule.id, targetId: event.target.id, before, after }))
      return true
    }
    return false
  }

  private commit(causeId?: string): DamageResult {
    const event = this.event
    const { proposal, origin } = event
    const intent = proposal.intent!
    const hpBefore = event.target.currentHp
    const status =
      this.failure === 'disabled' ? 'cancelled' : this.failure ? 'failed' : this.heal ? 'replaced' : 'committed'
    const dealtDamage = status === 'committed' ? proposal.remaining! : 0
    const hpLoss = Math.min(hpBefore, dealtDamage)
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
      preventedDamage: this.failure ? 0 : this.modifiedDamage - proposal.remaining!,
      shieldAbsorbed: this.failure ? 0 : this.shieldAbsorbed,
      dealtDamage,
      hpBefore,
      hpAfter,
      hpLoss,
      trace: Object.freeze([...proposal.trace]),
      payments: Object.freeze(
        this.failure
          ? []
          : proposal.payments.map(({ mark, actualAmount, reason }) =>
              Object.freeze({ markId: mark.id, stacks: actualAmount, reason }),
            ),
      ),
    })
    if (!this.failure) {
      for (const [mark, amount] of this.debits) {
        if (mark instanceof StatLevelMarkInstanceImpl) mark.level = Math.sign(mark.level) * (mark.stack - amount)
        else mark.stack -= amount
      }
      event.target.currentHp = hpAfter
    } else {
      proposal.payments.length = 0
    }
    proposal.result = result
    Object.freeze(proposal.payments)
    Object.freeze(proposal)
    Object.freeze(event)

    return result
  }

  private publish(result: DamageResult): void {
    const event = this.event
    const { battle, proposal } = event
    const { status, hpLoss, hpAfter } = result
    if (status === 'committed') {
      battle.emitMessage(BattleMessageType.Damage, {
        currentHp: hpAfter,
        maxHp: event.target.stat.maxHp,
        source: event.source.id,
        target: event.target.id,
        damage: result.dealtDamage,
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
    for (const mark of this.debits.keys()) {
      battle.emitMessage(BattleMessageType.MarkUpdate, {
        target: mark.owner instanceof Pet ? mark.owner.id : 'battle',
        mark: mark.toMessage(),
      })
    }
    for (const { mark, requested, actualAmount, reason } of proposal.payments) {
      const payment = new ConsumeStackContext(event, mark, requested, actualAmount, reason)
      battle.applyEffects(Object.freeze(payment), EffectTrigger.OnConsumeStack)
    }
    for (const mark of this.debits.keys()) {
      if (mark.stack <= 0 && mark.isActive && belongsToBattle(event, mark))
        battle.removeMark(new RemoveMarkContext(event, mark))
    }
    if (this.heal) notifyHeal(this.heal.event, battle)
    if (hpLoss <= 0) return

    battle.applyEffects(event, EffectTrigger.OnDamage)
    if (event.policy.skillReactions) {
      battle.applyEffects(event, EffectTrigger.PostDamage)
      if (event.crit) battle.applyEffects(event, EffectTrigger.OnCritPostDamage)
    }

    const target = battle.petMap.get(result.targetId)
    if (!target) throw new Error('Committed damage target is missing from battle')
    if (event.policy.skillReactions && target.owner) {
      const amount = Math.floor((hpLoss * 49) / target.stat.maxHp)
      battle.phaseManager.run(new RagePhase(new RageContext(event, target.owner, 'damage', 'add', amount)))
    }
    if (hpAfter > 0) return
    const { petId, skillInstanceId } = result.origin
    const killer = petId ? battle.petMap.get(petId) : undefined
    const skill =
      event.source instanceof SkillInstance && event.source.id === skillInstanceId
        ? event.source
        : skillInstanceId
          ? battle.skillMap.get(skillInstanceId)
          : undefined
    confirmDefeat(new DefeatContext(event, target, killer, skill))
  }
}

/** Direct authored HP assignments and executions share the same confirmed-defeat boundary. */
export function setEffectHp(source: EffectContext<EffectTrigger>, target: Pet, hp: number): void {
  if (!target.isAlive) return
  const wasPositive = target.currentHp > 0
  target.currentHp = hp
  if (wasPositive && target.currentHp <= 0) {
    const killer = source.source.owner instanceof Pet ? source.source.owner : undefined
    const skill = source.source instanceof SkillInstance ? source.source : undefined
    confirmDefeat(new DefeatContext(source, target, killer, skill))
  }
}

/** Publish each transition once, after the cause and its damage reactions have settled. */
function confirmDefeat(event: DefeatContext): void {
  const { battle, target, killer, skill } = event
  if (!target.isAlive || target.currentHp > 0) return
  target.isAlive = false
  if (target.isActive()) {
    battle.lastKiller = killer && killer.owner !== target.owner ? (killer.owner ?? undefined) : undefined
  }
  for (let parent: AllContext | null = event.parent; parent; parent = parent.parent) {
    if (parent instanceof UseSkillContext) {
      if (parent.pet === killer && parent.skill === skill) parent.defeated = true
      break
    }
  }
  battle.emitMessage(BattleMessageType.PetDefeated, { pet: target.id, killer: killer?.id })
  battle.applyEffects(event, EffectTrigger.OnDefeat)
}

/** Freeze a newly constructed wire record in the same shape a JSON receiver observes. */
export function freezeDamageRecord<T extends object>(record: T): Readonly<T> {
  for (const key in record) {
    if (record[key] === undefined) delete record[key]
  }
  return Object.freeze(record)
}

function damagePoints(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error('Damage amount must be finite')
  return Math.max(0, Math.floor(amount))
}

export function calculateDamageMagnitude(event: DamageContext): number {
  return damagePoints(evaluateEventMagnitude(event.baseDamage * event.randomFactor, event.proposal.modifiers))
}

function belongsToBattle(event: DamageContext, mark: MarkInstance): boolean {
  const owner = mark.owner
  return (
    !!owner &&
    owner.marks.includes(mark) &&
    (owner === event.battle || (owner instanceof Pet && event.battle.petMap.get(owner.id) === owner))
  )
}

function canSpendStacks(event: DamageContext, mark: MarkInstance): boolean {
  return mark.isActive && !mark.isSuppressed && belongsToBattle(event, mark)
}

function availableStacks(event: DamageContext, mark: MarkInstance): number {
  if (!canSpendStacks(event, mark)) return 0
  let available = mark.stack
  for (const payment of event.proposal.payments) {
    if (payment.mark === mark) available -= payment.actualAmount
  }
  return Math.max(0, Math.floor(available))
}

export function reserveDamageStacks(
  event: DamageContext,
  mark: MarkInstance,
  stacks: number | 'all',
  reason: DamagePayment['reason'],
): number {
  if (event.result) throw new Error('Damage already resolved')
  const available = availableStacks(event, mark)
  const requested = stacks === 'all' ? available : stacks
  if (!Number.isSafeInteger(requested) || requested <= 0 || available <= 0) return 0
  if (reason !== 'shield' && requested > available) return 0
  const payment = new ConsumeStackContext(event, mark, requested, Math.min(available, requested), reason)
  event.battle.applyEffects(payment, EffectTrigger.OnBeforeConsumeStack)
  if (!payment.available) return 0
  const actual = Math.min(payment.actualAmount, requested, availableStacks(event, mark))
  if (!Number.isSafeInteger(actual) || actual <= 0 || (reason !== 'shield' && actual !== requested)) return 0
  // An effect may retain the mutable preflight context. Commit a separate, immutable debit.
  event.proposal.payments.push(Object.freeze({ mark, requested, actualAmount: actual, reason }))
  return actual
}

// Damage evaluation and effect callbacks are synchronous. Keep this capability on the
// host stack so a cached frame, a different battle or a constructed Context cannot grant it.
let evaluation: DamageContext | undefined
let author: EffectContext<EffectTrigger> | undefined

export function getDamageEvaluation(): DamageContext | undefined {
  return evaluation
}

export function runDamageAuthor<T>(context: EffectContext<EffectTrigger> | undefined, run: () => T): T {
  const previous = author
  author = context
  try {
    return run()
  } finally {
    author = previous
  }
}

/** Veto and amount hooks edit their pending sub-event; keep those edits within the same callback boundary. */
export function evaluationSavepoint(damage: DamageContext, parent: AllContext): () => void {
  const { available, baseDamage, target, proposal } = damage
  const { modifiers, trace, candidates, payments } = proposal
  const terms = modifiers.length
  const recorded = trace.length
  const reserved = payments.length
  const rules = new Map(candidates)
  const restoreDamage = () => {
    damage.available = available
    damage.baseDamage = baseDamage
    damage.target = target
    modifiers.length = terms
    trace.length = recorded
    payments.length = reserved
    candidates.clear()
    for (const [id, rule] of rules) candidates.set(id, rule)
  }
  if (parent.type === 'effect' || parent.type === 'consumeStack' || parent.type === 'heal') {
    const pending = parent as ConsumeStackContext | EffectContext<EffectTrigger> | HealContext
    const available = pending.available
    const amount = 'actualAmount' in pending ? pending.actualAmount : undefined
    const heal = 'modified' in pending ? ([...pending.modified] as [number, number]) : undefined
    return () => {
      restoreDamage()
      pending.available = available
      if (amount !== undefined && 'actualAmount' in pending) pending.actualAmount = amount
      if (heal && 'modified' in pending) pending.modified = heal
    }
  }
  return restoreDamage
}

/** During evaluation the SDK may edit only the current proposal, or veto the current nested operation. */
export function assertEvaluationOperation(operation: string, selected: readonly unknown[], context = author): void {
  if (!evaluation) return
  if (context && context === author) {
    if (
      operation === 'disableContext' &&
      (context.trigger === EffectTrigger.BeforeEffect || context.trigger === EffectTrigger.OnBeforeConsumeStack) &&
      selected.every(target => target === context.parent)
    )
      return
    if (
      context.trigger === EffectTrigger.OnBeforeHeal &&
      (operation === 'modifyHeal' || operation === 'disableContext') &&
      selected.every(target => target === context.parent)
    )
      return
    if (context.parent === evaluation) {
      if (operation === 'payDamageStacks' && context.trigger === EffectTrigger.OnBeforeCalculateDamage) return
      if (
        [
          'cancelDamage',
          'modifyDamage',
          'setDamageThreshold',
          'replaceDamageWithHeal',
          'preventDamage',
          'surviveDamage',
          'redirectDamage',
        ].includes(operation) &&
        selected.every(target => target === evaluation)
      )
        return
    }
  }
  throw new Error(`Cannot perform ${operation} during damage evaluation`)
}

/** Each physical source instance gets its own application of an authored rule. */
export function damageRuleId(context: EffectContext<EffectTrigger>): string {
  return JSON.stringify([context.source.id, context.effect?.id])
}

export function isReplacementTrigger(trigger: EffectTrigger): boolean {
  return trigger === EffectTrigger.OnDamageReplacement || trigger === EffectTrigger.Shield
}

interface SamplingScope {
  readonly samples: number[]
  index: number
}

const samplesByDamage = new WeakMap<DamageContext, Map<string, number[]>>()
const active = new WeakMap<Battle, SamplingScope>()

/** Rechecking a candidate after redirection reads the same random draws, while its target and amounts stay live. */
export function runReplacementSample<T>(
  context: EffectContext<EffectTrigger>,
  stage: 'when' | 'before' | 'apply' | 'after',
  run: () => T,
): T {
  if (!isReplacementTrigger(context.trigger) || context.parent.type !== 'damage') return run()
  const damage = context.parent as DamageContext
  let candidates = samplesByDamage.get(damage)
  if (!candidates) samplesByDamage.set(damage, (candidates = new Map()))
  const key = JSON.stringify([context.source.id, context.effect?.id, context.trigger, stage])
  let samples = candidates.get(key)
  if (!samples) candidates.set(key, (samples = []))
  const previous = active.get(context.battle)
  active.set(context.battle, { samples, index: 0 })
  try {
    return run()
  } finally {
    if (previous) active.set(context.battle, previous)
    else active.delete(context.battle)
  }
}

export function sampleBattleRandom(battle: Battle, rng: BattleRng): number {
  const scope = active.get(battle)
  if (!scope) return rng.next()
  if (scope.index === scope.samples.length) scope.samples.push(rng.next())
  return scope.samples[scope.index++]
}

export function sampleBattleInteger(battle: Battle, rng: BattleRng, min: number, max: number): number {
  if (!active.has(battle)) return rng.nextInt(min, max)
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max || !Number.isSafeInteger(max - min + 1))
    throw new Error('Invalid RNG integer range')
  return min + Math.floor(sampleBattleRandom(battle, rng) * (max - min + 1))
}
