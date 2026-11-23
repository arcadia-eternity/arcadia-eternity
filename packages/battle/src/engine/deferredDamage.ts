import { Category, EffectTrigger, IgnoreStageStrategy } from '@arcadia-eternity/const'
import { z } from 'zod'
import { ElementSchema } from './content/schema/element'
import { AddMarkContext, EffectContext, type TurnContext, type UseSkillContext } from './context'
import { BaseMark, BaseStatLevelMark, type MarkInstance } from './mark'
import { calculateSkillDamage, makeSkillDamageContext } from './skillDamage'

const sourcePolicy = z.enum(['any', 'alive', 'active'])
const optionsSchema = z.strictObject({
  afterTurns: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  sourcePolicy: sourcePolicy.optional(),
  capturePower: z.boolean().optional(),
})
export type DeferredDamageOptions = z.input<typeof optionsSchema>

const id = z.string().min(1)
const descriptor = z
  .strictObject({
    kind: z.literal('damage'),
    evaluation: z.literal('on-trigger'),
    timing: z.literal('turn-end-mark-expiry'),
    id,
    origin: z.strictObject({ petId: id, skillId: id, skillInstanceId: id }).readonly(),
    target: z.strictObject({ kind: z.literal('active'), playerId: id }).readonly(),
    formula: z
      .strictObject({
        category: z.enum([Category.Physical, Category.Special, Category.Climax]),
        element: ElementSchema,
        tags: z.array(z.string()).readonly(),
        definitionPower: z.number().nonnegative(),
        capturedPower: z.number().nonnegative().optional(),
        ignoreStageStrategy: z.enum(IgnoreStageStrategy),
        ignoreShield: z.boolean(),
        sureCrit: z.boolean(),
      })
      .readonly(),
    sourcePolicy,
  })
  .readonly()
export type DeferredDamage = z.output<typeof descriptor>
export function readDeferredDamage(value: unknown): DeferredDamage {
  return descriptor.parse(value)
}

/** Ordinary marks and separate field positions can coexist on a battle. */
export function matchesMarkApplication(mark: MarkInstance, base: BaseMark, pending?: DeferredDamage): boolean {
  return mark.baseId === base.id && mark.deferredDamage?.target.playerId === pending?.target.playerId
}

export function deferSkillDamage(
  effect: EffectContext<EffectTrigger>,
  cast: UseSkillContext,
  holder: BaseMark,
  options: DeferredDamageOptions,
): void {
  if (effect.trigger !== EffectTrigger.BeforeHit || effect.parent !== cast || effect.battle !== cast.battle)
    throw new Error('Deferred skill damage requires the current BeforeHit context')
  if (!(holder instanceof BaseMark) || holder instanceof BaseStatLevelMark)
    throw new Error('Deferred damage requires an ordinary mark prototype')
  if (cast.category === Category.Status || !cast.actualTarget?.owner)
    throw new Error('Deferred damage requires a damaging skill with an owned target')
  if (cast.damageDeferred) return
  const { afterTurns, sourcePolicy: policy = 'any', capturePower = false } = optionsSchema.parse(options)
  // The casting turn has its own mark-update step. Thus zero means the end of this turn.
  const duration = afterTurns + 1
  const application = new AddMarkContext(effect, cast.battle, holder, 1, duration, {
    ...holder.config,
    duration,
    persistent: false,
    destroyable: true,
  })
  application.deferredDamage = readDeferredDamage({
    kind: 'damage',
    evaluation: 'on-trigger',
    timing: 'turn-end-mark-expiry',
    id: cast.battle.allocateEventId('deferred'),
    origin: { petId: cast.pet.id, skillId: cast.skill.baseId, skillInstanceId: cast.skill.id },
    target: { kind: 'active', playerId: cast.actualTarget.owner.id },
    formula: {
      category: cast.category,
      element: cast.element,
      tags: cast.skill.tags,
      definitionPower: cast.skill.base.power,
      ...(capturePower ? { capturedPower: cast.power } : {}),
      ignoreStageStrategy: cast.skill.base.ignoreOpponentStageStrategy,
      ignoreShield: cast.skill.ignoreShield,
      sureCrit: cast.skill.sureCrit,
    },
    sourcePolicy: policy,
  })
  // A cancelled mark application also consumes the cast. It cannot fall back to immediate damage.
  cast.damageDeferred = true
  cast.battle.addMark(application)
}

/** Called exactly once from natural expiry. Early removal never enters this path. */
export function resolveDeferredDamage(turn: TurnContext, holder: MarkInstance, pending: DeferredDamage): void {
  if (!holder.isActive || holder.isSuppressed) return
  const battle = turn.battle
  const attacker = battle.petMap.get(pending.origin.petId)
  const skill = battle.skillMap.get(pending.origin.skillInstanceId)
  const side = [battle.playerA, battle.playerB].find(player => player.id === pending.target.playerId)
  if (!attacker || !skill || !side) return
  if (pending.sourcePolicy !== 'any' && (!attacker.isAlive || attacker.currentHp <= 0)) return
  if (pending.sourcePolicy === 'active' && attacker.owner?.activePet !== attacker) return

  const target = side.activePet
  const formula = pending.formula
  const power =
    formula.capturedPower ?? (skill.baseId === pending.origin.skillId ? skill.power : formula.definitionPower)
  const crit = formula.sureCrit || battle.random() * 100 < attacker.stat.critRate
  const hit = calculateSkillDamage(battle, attacker, target, {
    ...formula,
    power,
    crit,
    stabMultiplier: 1.5,
    critMultiplier: 2,
  })
  const expiry = new EffectContext(turn, EffectTrigger.OnMarkDurationEnd, holder)
  const event = makeSkillDamageContext(
    expiry,
    skill,
    target,
    { ...hit, crit, element: formula.element, ignoreShield: formula.ignoreShield },
    {
      ...pending.origin,
      skillCategory: formula.category,
      skillElement: formula.element,
      skillTags: formula.tags,
      hitCount: 1,
      executorId: holder.id,
      holderId: holder.id,
      trigger: 'deferred',
      causeId: pending.id,
    },
  )
  target.damage(event)
}
