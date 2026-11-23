import { BattleMessageType, EffectTrigger, type DamagePayment } from '@arcadia-eternity/const'
import { ConsumeStackContext, type DamageContext, RemoveMarkContext } from './context'
import { type MarkInstance, StatLevelMarkInstanceImpl } from './mark'
import { Pet } from './pet'

type PaymentGroup = Exclude<ConsumeStackContext['reason'], 'effect'>

/** Stack costs stay local to one damage proposal until its HP change is ready to commit. */
export class DamagePayments {
  private reservations: ConsumeStackContext[] = []
  private state: 'pending' | 'committed' | 'notified' = 'pending'

  constructor(private readonly damage: DamageContext) {}

  private belongsToBattle(mark: MarkInstance): boolean {
    const owner = mark.owner
    return (
      !!owner &&
      owner.marks.includes(mark) &&
      (owner === this.damage.battle || (owner instanceof Pet && this.damage.battle.petMap.get(owner.id) === owner))
    )
  }

  available(mark: MarkInstance): number {
    if (!mark.isActive || mark.isSuppressed || !this.belongsToBattle(mark)) return 0
    let stacks = mark.stack
    for (const payment of this.reservations) {
      if (payment.mark === mark) stacks -= payment.actualAmount
    }
    return Math.max(0, Math.floor(stacks))
  }

  reserve(mark: MarkInstance, stacks: number | 'all', partial = false, group: PaymentGroup = 'rule'): number {
    if (this.state !== 'pending') throw new Error('Damage costs already committed')
    const available = this.available(mark)
    const requested = stacks === 'all' ? available : stacks
    if (!Number.isSafeInteger(requested) || requested <= 0 || available <= 0) return 0
    if (!partial && available < requested) return 0

    const payment = new ConsumeStackContext(this.damage, mark, requested, Math.min(available, requested), group)
    this.damage.battle.applyEffects(payment, EffectTrigger.OnBeforeConsumeStack)
    if (!payment.available) return 0
    const actual = Math.min(payment.actualAmount, requested, this.available(mark))
    if (!Number.isSafeInteger(actual) || actual <= 0 || (!partial && actual !== requested)) return 0
    // Store a fresh record. A before-consumption effect can retain its own proposal.
    this.reservations.push(Object.freeze(new ConsumeStackContext(this.damage, mark, requested, actual, group)))
    return actual
  }

  savepoint(): () => void {
    const previous = this.reservations.slice()
    return () => {
      if (this.state !== 'pending') throw new Error('Cannot restore committed damage costs')
      this.reservations = previous.slice()
    }
  }

  clear(): void {
    if (this.state !== 'pending') throw new Error('Cannot clear committed damage costs')
    this.reservations = []
  }

  private totals(): Map<MarkInstance, number> {
    const totals = new Map<MarkInstance, number>()
    for (const { mark, actualAmount } of this.reservations) {
      totals.set(mark, (totals.get(mark) ?? 0) + actualAmount)
    }
    return totals
  }

  validate(): boolean {
    return (
      this.state === 'pending' &&
      Array.from(this.totals()).every(
        ([mark, amount]) => this.belongsToBattle(mark) && mark.isActive && !mark.isSuppressed && mark.stack >= amount,
      )
    )
  }

  receipts(): readonly DamagePayment[] {
    return Object.freeze(
      this.reservations.map(({ mark, actualAmount, reason }) => {
        if (reason === 'effect') throw new Error('Unexpected effect cost in a damage reservation')
        return Object.freeze({ markId: mark.id, stacks: actualAmount, reason })
      }),
    )
  }

  commit(): void {
    if (!this.validate()) throw new Error('Damage stack costs are no longer available')
    for (const [mark, amount] of this.totals()) {
      if (mark instanceof StatLevelMarkInstanceImpl) mark.level = Math.sign(mark.level) * (mark.stack - amount)
      else mark.stack -= amount
    }
    this.state = 'committed'
  }

  /** HP and every debit have already been published when payment reactions can run. */
  notify(): void {
    if (this.state !== 'committed') throw new Error('Damage costs require one commit before notification')
    this.state = 'notified'
    const battle = this.damage.battle
    const marks = this.totals()
    for (const mark of marks.keys()) {
      battle.emitMessage(BattleMessageType.MarkUpdate, {
        target: mark.owner instanceof Pet ? mark.owner.id : 'battle',
        mark: mark.toMessage(),
      })
    }
    for (const payment of this.reservations) battle.applyEffects(payment, EffectTrigger.OnConsumeStack)
    for (const mark of marks.keys()) {
      if (mark.stack <= 0 && mark.isActive && this.belongsToBattle(mark))
        battle.removeMark(new RemoveMarkContext(this.damage, mark))
    }
  }
}
