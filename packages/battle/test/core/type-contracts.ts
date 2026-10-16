/** Compile-only negative examples: unused @ts-expect-error directives fail the strict test typecheck. */
import {
  TurnContext,
  UseSkillContext,
  DamageContext,
  EffectContext,
  AddMarkContext,
  TransformContext,
  TransformEndContext,
  EffectPhase,
  SkillPhase,
  DamagePhase,
  EffectTrigger,
  defineEffect,
  type Battle,
  type Player,
  type Pet,
  type Skill,
  type Mark,
  type Species,
  type BaseSkill,
  type Instance,
  type OwnedEntity,
  type BattlePhaseBase,
} from '@arcadia-eternity/battle/core'
import type { petId, skillId } from '@arcadia-eternity/const'

export function compileContracts(
  battle: Battle,
  player: Player,
  pet: Pet,
  skill: Skill,
  mark: Mark,
  species: Species,
  baseSkill: BaseSkill,
) {
  const turn = new TurnContext(battle)
  const use = new UseSkillContext(turn, player, pet, skill.target, skill)
  const damage = new DamageContext(use, pet, pet, 10)
  const hit = defineEffect({ id: 'hit', version: '1', triggers: [EffectTrigger.OnHit], execute(_context) {} })
  const effect = new EffectContext(use, EffectTrigger.OnHit, skill, {}, hit)
  const onDamage = defineEffect({ id: 'damage', version: '1', triggers: [EffectTrigger.OnDamage], execute(_ctx) {} })
  // @ts-expect-error The effect argument must not widen the explicit OnDamage trigger to a union.
  new EffectContext(damage, EffectTrigger.OnDamage, skill, {}, hit)
  // @ts-expect-error EffectPhase must keep its callback bound to the context trigger.
  new EffectPhase(effect, onDamage)
  defineEffect({
    id: 'bad',
    version: '1',
    triggers: [EffectTrigger.OnDamage],
    // @ts-expect-error Trigger inference must not be widened from the wrong callback parameter.
    execute(_ctx: EffectContext<EffectTrigger.OnHit>) {},
  })
  const parent: UseSkillContext = effect.parent
  const root: Battle = parent.parent.parent
  const petInstance: Instance<Species, petId> = pet
  const skillInstance: Instance<BaseSkill, skillId> = skill
  const ownedPet: OwnedEntity<Player> = pet
  const damagePhase: BattlePhaseBase<DamageContext, number> = new DamagePhase(damage)
  void [root, petInstance, skillInstance, ownedPet, damagePhase]
  // @ts-expect-error A use-skill operation belongs to a TurnContext, not Battle.
  new UseSkillContext(battle, player, pet, skill.target, skill)
  // @ts-expect-error OnHit requires UseSkillContext; DamageContext is not interchangeable.
  new EffectContext(damage, EffectTrigger.OnHit, skill, {}, hit)
  // @ts-expect-error OnDamage requires DamageContext, not a skill operation.
  battle.applyEffects(use, EffectTrigger.OnDamage)
  // @ts-expect-error Phase context is part of its type, not an untyped payload.
  const wrongPhase: BattlePhaseBase<DamageContext, number> = new SkillPhase(use)
  // @ts-expect-error Pet instances cannot have skill prototypes.
  const wrongPrototype: Instance<BaseSkill> = pet
  // @ts-expect-error Pets belong to Player, not Battle.
  const wrongOwner: OwnedEntity<Battle> = pet
  // @ts-expect-error Domain instance IDs are not interchangeable.
  const wrongId: skillId = pet.id
  // @ts-expect-error A pet transformation requires a Species prototype.
  new TransformContext(battle, pet, species, baseSkill)
  // @ts-expect-error The convenience operation must not widen Pet to accept a skill prototype.
  battle.transform(pet, baseSkill)
  // @ts-expect-error A skill transformation requires a BaseSkill prototype.
  battle.transform(skill, species)
  const end = new TransformEndContext(battle, pet)
  const endingSpecies: Species = end.toBase
  void endingSpecies
  // @ts-expect-error The ending context keeps its target-to-prototype relation.
  end.toBase = baseSkill
  // @ts-expect-error OnTransformEnd has a dedicated ending context.
  battle.applyEffects(new TransformContext(battle, pet, species, species), EffectTrigger.OnTransformEnd)
  // @ts-expect-error Only MarkOwner entities can receive marks.
  new AddMarkContext(effect, skill, mark.base)
  void [wrongPhase, wrongPrototype, wrongOwner, wrongId]
  defineEffect({
    id: 'typed-damage',
    version: '1',
    triggers: [EffectTrigger.OnDamage],
    execute(ctx) {
      const exact: DamageContext = ctx.parent
      exact.addModified(10, 0)
      // @ts-expect-error Damage callbacks cannot access a UseSkillContext field directly.
      void ctx.parent.skill
    },
  })
}

// Value systems retain the key/value and modifier-operation relationships at the public API.
import {
  Modifier,
  DurationType,
  ConfigSystem,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
} from '@arcadia-eternity/battle/core'
export function compileValueContracts(battle: Battle, pet: Pet) {
  const config = new ConfigSystem<{ count: number; label: string; enabled: boolean }>(battle)
  config.registerConfig('count', 10)
  const count: number | undefined = config.get('count')
  void count
  // @ts-expect-error Unknown typed config key.
  config.get('missing')
  // @ts-expect-error A numeric config cannot take a string base value.
  config.set('count', 'ten')
  // @ts-expect-error Attribute keys are tied to the entity's actual attribute set.
  pet.attributeSystem.addModifier('unknown', new Modifier(DurationType.instant, 'bad', 1, 'delta'))
  // @ts-expect-error A numeric attribute cannot be overridden with a boolean modifier.
  pet.attributeSystem.addModifier('atk', new Modifier<boolean>(DurationType.instant, 'bad', true, 'override'))
  // @ts-expect-error Boolean modifiers do not support numeric percent operations.
  new Modifier<boolean>(DurationType.instant, 'bad', true, 'percent')
  // @ts-expect-error A boolean config modifier cannot use a string append operation.
  new ConfigModifier<boolean>(ConfigDurationType.instant, 'bad', true, ConfigModifierType.append)
  config.addConfigModifier(
    'count',
    // @ts-expect-error A string config modifier cannot target a numeric config.
    new ConfigModifier<string>(ConfigDurationType.instant, 'bad', 'x', ConfigModifierType.append),
  )
  pet.attributeSystem.addModifier(
    'atk',
    // @ts-expect-error A boolean live attribute reference cannot supply a numeric modifier.
    new Modifier<number>(DurationType.instant, 'bad', pet.skills[0].attributeSystem.reference('appeared'), 'delta'),
  )
}
