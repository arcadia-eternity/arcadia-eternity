import { afterEach, describe, expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  BaseMark,
  BattleMessageType,
  Category,
  DamageContext,
  DamageType,
  EffectTrigger,
  RageContext,
  SkillPhase,
  defineNativeEffect,
  TurnContext,
  UseSkillContext,
  effectAuthoring,
  type Battle,
  type Pet,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/engine'
import { compileEffect, ops, targets } from '@arcadia-eternity/battle/authoring'
import { timeRebirth } from '../../../../packs/base/src/effects/authored/time-rebirth'
import { generatedContextControls } from '../../../../packs/base/src/effects/context-controls.generated.effect'
import { officialDamageBenefitEffects } from '../../../../packs/base/src/effects/damage-benefits.effect'
import { generatedDamageModifierEffects } from '../../../../packs/base/src/effects/damage-modifiers.generated.effect'
import { generatedDamageSequences } from '../../../../packs/base/src/effects/damage-sequences.generated.effect'
import { generatedDamageThresholds } from '../../../../packs/base/src/effects/damage-thresholds.generated.effect'
import { LastStandEffects } from '../../../../packs/base/src/effects/last-stand.effect'
import { generatedVitalActions } from '../../../../packs/base/src/effects/vital-actions.generated.effect'
import { generatedVitalSequences } from '../../../../packs/base/src/effects/vital-sequences.generated.effect'
import { advanceDeferredTurn, makeDeferredScenario } from './deferred-scenario'
import { makeScenario } from './scenario'

const battles: Battle[] = []

afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function fixture() {
  const { battle, a, b, debuff } = makeScenario()
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const attacker = a.activePet
  const defender = b.activePet
  const skill = attacker.skills[0]
  const use = new UseSkillContext(new TurnContext(battle), a, attacker, AttackTargetOpinion.opponent, skill)
  function mark(owner: Pet, id: string, effects: BaseMark['effects'], stack = 1, isShield = false) {
    for (const effect of effects) effectAuthoring.effectParameters(effect).install(battle.configSystem)
    const definition = new BaseMark(id as baseMarkId, effects, {
      ...debuff.config,
      maxStacks: Math.max(5, stack),
      stackable: true,
      isShield,
    })
    const instance = definition.createInstance({ stack })
    instance.setOwner(owner, battle.emitter)
    owner.marks.push(instance)
    return instance
  }
  function damage(amount: number, type = DamageType.Physical) {
    const event = new DamageContext(use, skill, defender, amount, type)
    defender.damage(event)
    return event
  }
  return { battle, attacker, defender, skill, use, mark, damage }
}

describe('official damage rules', () => {
  it.each([
    { seeded: false, healing: 10 },
    { seeded: true, healing: 20 },
  ])('replaces 40 incoming damage with $healing healing (seeded=$seeded)', ({ seeded, healing }) => {
    const { attacker, defender, mark, damage } = fixture()
    defender.currentHp = 1
    if (seeded) mark(attacker, 'mark_kuihuazhongzi', [])
    const absorb = mark(defender, 'fixture/absorb', [generatedVitalSequences.effect_mark_absorb_damage_to_heal], 2)
    damage(40)
    expect(defender.currentHp).toBe(1 + healing)
    expect(absorb.stack).toBe(1)
    expect(defender.isAlive).toBe(true)
  })

  it('only consumes the last-stand charge when a lethal blow would resolve', () => {
    const { defender, mark, damage } = fixture()
    defender.currentHp = 25
    const charge = mark(defender, 'fixture/last-stand', [
      LastStandEffects.build().effect_mark_set_health_to_1_on_damage,
    ])
    damage(5)
    expect(defender.currentHp).toBe(20)
    expect(charge.stack).toBe(1)
    damage(70)
    expect(defender.currentHp).toBe(1)
    expect(defender.isAlive).toBe(true)
    expect(charge.isActive).toBe(false)
    damage(1)
    expect(defender.isAlive).toBe(false)
  })

  it('pays one stack for each half-prevented skill hit and leaves fixed damage alone', () => {
    const { defender, mark, damage } = fixture()
    const guard = mark(
      defender,
      'fixture/halve',
      [generatedDamageModifierEffects.effect_mark_reduce_next_skill_damage_50_percent],
      2,
    )
    const hp = defender.currentHp
    damage(10, DamageType.Effect)
    expect(defender.currentHp).toBe(hp - 10)
    expect(guard.stack).toBe(2)
    const hit = damage(20, DamageType.Special)
    expect(hit.result).toMatchObject({ modifiedDamage: 20, preventedDamage: 10, hpLoss: 10 })
    expect(guard.stack).toBe(1)
  })

  it('preserves a one-shot modifier through cancellation, then spends it on commit', () => {
    const { defender, skill, mark, damage } = fixture()
    const oneShot = mark(
      defender,
      'fixture/one-shot',
      [generatedDamageSequences.effect_mark_add_damage_taken_with_stack],
      3,
    )
    const cancel = defineNativeEffect({
      id: 'fixture/cancel-after-modifier' as effectId,
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: -100,
      apply({ parent }) {
        parent.available = false
      },
    })
    skill.effects.push(cancel)
    const before = defender.currentHp
    expect(damage(40).result?.status).toBe('cancelled')
    expect(defender.currentHp).toBe(before)
    expect(oneShot.stack).toBe(3)
    skill.effects.splice(skill.effects.indexOf(cancel), 1)
    damage(40)
    expect(defender.currentHp).toBe(before - 41)
    expect(oneShot.isActive).toBe(false)
  })

  it('does not spend the same mark on both a one-shot modifier and prevention', () => {
    const { defender, mark, damage } = fixture()
    const shared = mark(
      defender,
      'fixture/shared',
      [
        generatedDamageSequences.effect_mark_add_damage_taken_with_stack,
        generatedDamageModifierEffects.effect_mark_reduce_next_skill_damage_50_percent,
      ],
      3,
    )
    const before = defender.currentHp
    damage(40)
    expect(defender.currentHp).toBe(before - 41)
    expect(shared.isActive).toBe(false)
  })

  it('pays for the numeric modifier used to determine the replacement heal', () => {
    const { attacker, defender, mark, damage } = fixture()
    const bonus = mark(
      attacker,
      'fixture/bonus',
      [generatedDamageSequences.effect_mark_add_damage_with_stack_and_consume],
      12,
    )
    const absorb = mark(defender, 'fixture/convert', [generatedVitalSequences.effect_mark_absorb_damage_to_heal], 2)
    defender.currentHp = 10
    expect(damage(40).result?.status).toBe('replaced')
    expect(defender.currentHp).toBe(23)
    expect(bonus.isActive).toBe(false)
    expect(absorb.stack).toBe(1)
  })

  it('lets time rebirth respond to lethal fixed mark damage before declaring defeat', () => {
    const { battle, attacker, defender, mark } = fixture()
    mark(defender, 'fixture/time-rebirth', [compileEffect(timeRebirth)])
    const source = mark(attacker, 'fixture/mark-damage', [
      compileEffect({
        id: 'fixture/fixed-mark-damage',
        triggers: [EffectTrigger.TurnEnd],
        apply: targets.opponentActive.apply(ops.dealDamage(40)),
      }),
    ])
    defender.currentHp = 5
    const published: BattleMessageType[] = []
    battle.registerListener(message => {
      if (message.type === BattleMessageType.Damage) {
        expect(message.data.currentHp).toBe(0)
        expect(message.data.damage).toBe(40)
        expect(message.data.source).toBe(source.id)
      }
      published.push(message.type)
    })
    battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd)
    expect(defender.currentHp).toBe(Math.floor(defender.stat.maxHp / 4))
    expect(defender.isAlive).toBe(true)
    expect(published).toContain(BattleMessageType.Damage)
    expect(published).not.toContain(BattleMessageType.PetDefeated)
    expect(published).not.toContain(BattleMessageType.Heal)
  })

  it('spares a target with 1 HP when the attacking skill specifies a nonlethal hit', () => {
    const { defender, skill, damage } = fixture()
    skill.effects.push(generatedDamageThresholds.effect_skill_save_hp_to_1)
    defender.currentHp = 15
    damage(100)
    expect(defender.currentHp).toBe(1)
    damage(100)
    expect(defender.currentHp).toBe(1)
    expect(defender.isAlive).toBe(true)
  })

  it('tests the low-damage threshold before HP is lost', () => {
    const { defender, mark, damage } = fixture()
    mark(defender, 'fixture/block-small', [generatedContextControls.effect_block_damage_under_60])
    const initial = defender.currentHp
    damage(60)
    expect(defender.currentHp).toBe(initial)
    damage(61)
    expect(defender.currentHp).toBe(initial - 61)
  })

  it('reduces physical damage before commit and permits special damage through', () => {
    const { defender, mark, damage } = fixture()
    mark(defender, 'fixture/resist', [generatedDamageModifierEffects.effect_ability_reduce_physical_damage_30_percent])
    const initial = defender.currentHp
    damage(20)
    expect(defender.currentHp).toBe(initial - 14)
    damage(20, DamageType.Special)
    expect(defender.currentHp).toBe(initial - 34)
  })

  it.each([false, true])('heals the opponent by committed turn-end drain (prevented=%s)', prevented => {
    const { battle, attacker, defender, mark } = fixture()
    mark(attacker, 'fixture/drain', [generatedVitalSequences.effect_mark_absorb_hp_to_opponent])
    if (prevented) mark(attacker, 'fixture/block-small', [generatedContextControls.effect_block_damage_under_60])
    attacker.currentHp = 64
    defender.currentHp = 10
    battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnEnd)
    expect(attacker.currentHp).toBe(prevented ? 64 : 56)
    expect(defender.currentHp).toBe(prevented ? 10 : 18)
  })

  it('lifesteal reads the 12 HP actually lost on a 100 damage hit', () => {
    const { attacker, defender, skill, damage } = fixture()
    skill.effects.push(officialDamageBenefitEffects.effect_skill_heal_25_percent_damage_dealt)
    attacker.currentHp = 30
    defender.currentHp = 12
    damage(100)
    expect(attacker.currentHp).toBe(33)
    expect(defender.currentHp).toBe(0)
  })

  it('attributes lifesteal to the outgoing hit while the opposing mark reflects damage', () => {
    const { attacker, defender, skill, mark, damage } = fixture()
    skill.effects.push(officialDamageBenefitEffects.effect_skill_heal_25_percent_damage_dealt)
    mark(defender, 'fixture/reflect', [generatedVitalSequences.effect_mark_reflect_damage_1_4])
    attacker.currentHp = 30
    const hp = defender.currentHp
    damage(20)
    expect(defender.currentHp).toBe(hp - 20)
    // The skill heals 5 HP and the opponent reflects 5. Reflection cannot grant the caster another 1 HP.
    expect(attacker.currentHp).toBe(30)
  })

  it('reflects a deferred strike back to the original caster after a switch', () => {
    const { battle, a, b, debuff } = makeDeferredScenario()
    battles.push(battle)
    const caster = a.activePet
    const target = b.activePet
    const reflect = new BaseMark(
      'fixture/reflect' as baseMarkId,
      [generatedVitalSequences.effect_mark_reflect_damage_1_4],
      {
        ...debuff.config,
        persistent: true,
        duration: -1,
      },
    ).createInstance()
    reflect.setOwner(target, battle.emitter)
    target.marks.push(reflect)
    advanceDeferredTurn(battle, 'cast')
    advanceDeferredTurn(battle, 'switch')
    const newOccupant = a.activePet
    const occupantHp = newOccupant.currentHp
    const casterHp = caster.currentHp
    const targetHp = target.currentHp
    advanceDeferredTurn(battle)
    const reflected = Math.floor((targetHp - target.currentHp) / 4)
    expect(reflected).toBeGreaterThan(0)
    expect(caster.currentHp).toBe(casterHp - reflected)
    expect(newOccupant.currentHp).toBe(occupantHp)
  })

  it.each([
    { amount: 15, type: DamageType.Special, kept: 0, hpLost: 5, reflected: 10 },
    { amount: 4, type: DamageType.Special, kept: 6, hpLost: 0, reflected: 4 },
    { amount: 15, type: DamageType.Physical, kept: 0, hpLost: 5, reflected: 0 },
  ])(
    'reflecting shell absorbs $amount $type damage and returns $reflected',
    ({ amount, type, kept, hpLost, reflected }) => {
      const { attacker, defender, mark, damage } = fixture()
      const shell = mark(
        defender,
        'fixture/reflecting-shell',
        [generatedVitalActions.effect_mark_reflect_special_damage_max_with_stack],
        10,
        true,
      )
      const attackerHp = attacker.currentHp
      const defenderHp = defender.currentHp
      damage(amount, type)
      expect(shell.stack).toBe(kept)
      expect(shell.isActive).toBe(kept > 0)
      expect(defender.currentHp).toBe(defenderHp - hpLost)
      expect(attacker.currentHp).toBe(attackerHp - reflected)
    },
  )

  it('reflects a quarter of actual HP loss as a second damage event', () => {
    const { battle, attacker, defender, mark, damage } = fixture()
    mark(defender, 'fixture/reflect', [generatedVitalSequences.effect_mark_reflect_damage_1_4])
    attacker.currentHp = 30
    defender.currentHp = 12
    const hits: number[] = []
    battle.registerListener(message => {
      if (message.type === BattleMessageType.Damage) hits.push(message.data.damage)
    })
    damage(100)
    expect(hits).toEqual([100, 3])
    expect(attacker.currentHp).toBe(27)
    expect(defender.currentHp).toBe(0)
  })
})

function rageSkillFixture(hits = 1) {
  const fixtureState = fixture()
  const { battle, attacker, defender, skill, use } = fixtureState
  const player = battle.playerA
  const effect = generatedVitalSequences.effect_skill_clear_rage_add_fixed_damage
  effectAuthoring.effectParameters(effect).install(battle.configSystem)
  skill.effects.push(effect)
  player.currentRage = skill.rage + 40
  use.category = Category.Physical
  use.power = 20
  use.setSureHit()
  use.multihit = hits
  defender.attributeSystem.updateBaseValue('maxHp', 1000)
  defender.currentHp = 500

  const results: NonNullable<DamageContext['result']>[] = []
  battle.registerListener(message => {
    if (
      (message.type === BattleMessageType.Damage || message.type === BattleMessageType.DamageFail) &&
      message.data.result
    ) {
      results.push(message.data.result)
    }
  })
  function execute() {
    const phase = new SkillPhase(battle, player, attacker, AttackTargetOpinion.opponent, skill, use.parent, use)
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
  }
  return { ...fixtureState, player, execute, results }
}

describe('斗战之魂 rage payment', () => {
  it('buys bonus damage for the first hit of a multi-hit skill', () => {
    const { player, execute, results } = rageSkillFixture(3)
    execute()
    expect(results.map(hit => hit.modifiedDamage - hit.originalDamage)).toEqual([40, 0, 0])
    expect(player.currentRage).toBe(15)
  })

  it('uses the debit after BeforeRageLoss and before OnRageLoss refunds rage', () => {
    const { player, skill, execute, results } = rageSkillFixture(2)
    const debits: number[] = []
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/discount-and-refund' as effectId,
        triggers: [EffectTrigger.BeforeRageLoss, EffectTrigger.OnRageLoss],
        when: ctx => ctx.parent.reason === 'effect' && ctx.parent.target === player,
        apply(ctx) {
          if (ctx.trigger === EffectTrigger.BeforeRageLoss) {
            ctx.parent.addModified(-50, 0)
          } else {
            debits.push(ctx.parent.rageSpent)
            player.addRage(new RageContext(ctx, player, 'effect', 'add', 7))
          }
        },
      }),
    )
    execute()
    expect(debits).toEqual([20])
    expect(results.map(hit => hit.modifiedDamage - hit.originalDamage)).toEqual([20, 0])
    expect(player.currentRage).toBe(42)
  })

  it.each(['cancelled', 'replaced'] as const)('retains the declared cost when outgoing damage is %s', status => {
    const { player, skill, defender, mark, results, execute } = rageSkillFixture()
    if (status === 'replaced') {
      mark(defender, 'fixture/convert', [generatedVitalSequences.effect_mark_absorb_damage_to_heal])
    } else {
      skill.effects.push(
        defineNativeEffect({
          id: 'fixture/veto-paid-hit' as effectId,
          triggers: [EffectTrigger.OnBeforeCalculateDamage],
          apply: ctx => {
            ctx.parent.available = false
          },
        }),
      )
    }
    const hp = defender.currentHp
    execute()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ status, hpLoss: 0 })
    expect(player.currentRage).toBe(15)
    expect(defender.currentHp).toBe(status === 'replaced' ? hp + Math.floor(results[0].modifiedDamage / 4) : hp)
  })
})
