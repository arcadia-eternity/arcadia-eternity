import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  AddMarkContext,
  BaseMark,
  BaseSkill,
  BattleMessageType,
  BattleTimer,
  Category,
  ConfigModifier,
  ConfigDurationType,
  ConfigModifierType,
  DamageContext,
  DamageType,
  DurationType,
  Effect,
  EffectContext,
  EffectHandlingStrategy,
  EffectTrigger,
  Element,
  HealContext,
  Modifier,
  PhaseState,
  RemoveMarkContext,
  SkillPhase,
  StackStrategy,
  SwitchPetPhase,
  TurnContext,
  executeTurnOperation,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type baseSkillId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const fixtures: ReturnType<typeof makeScenario>[] = []
function fixture() {
  const f = makeScenario()
  fixtures.push(f)
  return f
}
function context(battle: Battle) {
  return new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, battle.playerA.activePet.skills[0])
}
function noFailedPhases(battle: Battle) {
  expect(battle.phaseManager.getPhasesByState(PhaseState.Failed).map(p => p.result?.error)).toEqual([])
}
function mark(id: string, config: Partial<BaseMark['config']> = {}) {
  return new BaseMark(id as baseMarkId, [], {
    ...new BaseMark('defaults' as baseMarkId, []).config,
    persistent: false,
    duration: 3,
    ...config,
  })
}
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.battle.cleanup()
  vi.useRealTimers()
})

describe('V1 inherited mechanisms', () => {
  it('retains EV/IV/nature calculation, instance ownership and initial rage', () => {
    const { a, battle } = fixture()
    expect(a.currentRage).toBe(20)
    expect(a.team[0].currentHp).toBe(260)
    expect(a.team[0].stat.atk).toBe(55)
    expect(a.team[0].skills[0].owner).toBe(a.team[0])
    expect(battle.getPetByID(a.team[1].id)).toBe(a.team[1])
    expect(new BaseSkill.Builder().withID('builder').withPower(15).withMultihit(2).build().power).toBe(15)
  })
  it('uses V1 floor(rage * .8) on switch (#201 difference 01)', () => {
    const { a, battle } = fixture()
    a.currentRage = 21
    const phase = new SwitchPetPhase(battle, a, a.team[1], new TurnContext(battle))
    phase.initialize()
    expect(phase.execute().success).toBe(true)
    expect(a.currentRage).toBe(16)
  })
  it('refreshes the target after a faster switch (#201 difference 02)', () => {
    const { a, b, battle } = fixture()
    a.selection = { type: 'switch-pet', player: a.id, pet: a.team[1].id }
    b.selection = {
      type: 'use-skill',
      player: b.id,
      skill: b.activePet.skills[0].id,
      target: b.activePet.skills[0].target,
    }
    const hp = a.team[0].currentHp
    executeTurnOperation(new TurnContext(battle), battle)
    noFailedPhases(battle)
    expect(a.team[0].currentHp).toBe(hp)
    expect(a.team[1].currentHp).toBeLessThan(hp)
  })
  it('grants turn rage even to the fainted active pet owner (#201 difference 03)', () => {
    const { a, b, battle } = fixture()
    b.activePet.currentHp = 0
    a.selection = { type: 'do-nothing', player: a.id }
    b.selection = { type: 'do-nothing', player: b.id }
    executeTurnOperation(new TurnContext(battle), battle)
    noFailedPhases(battle)
    expect(b.currentRage).toBe(35)
  })
  it.each([
    [StackStrategy.stack, 5, 5],
    [StackStrategy.refresh, 2, 5],
    [StackStrategy.extend, 5, 8],
    [StackStrategy.max, 3, 5],
    [StackStrategy.replace, 3, 5],
    [StackStrategy.none, 2, 3],
  ])('retains mark stacking strategy %s', (strategy, stack, duration) => {
    const { a, battle } = fixture()
    const ctx = context(battle)
    const base = mark('stack', { maxStacks: 8, stackable: true, stackStrategy: strategy })
    battle.addMark(new AddMarkContext(ctx, a.activePet, base, 2, 3))
    battle.addMark(new AddMarkContext(ctx, a.activePet, base, 3, 5))
    noFailedPhases(battle)
    expect(a.activePet.marks[0].stack).toBe(stack)
    expect(a.activePet.marks[0].duration).toBe(duration)
  })
  it('removes mutex marks and cleans bound modifiers on destruction', () => {
    const { a, battle } = fixture()
    const ctx = context(battle)
    battle.addMark(new AddMarkContext(ctx, a.activePet, mark('first', { mutexGroup: 'g' })))
    const source = a.activePet.marks[0]
    a.activePet.attributeSystem.addModifier('atk', new Modifier(DurationType.binding, 'attack', 10, 'delta', 0, source))
    expect(a.activePet.stat.atk).toBe(65)
    battle.addMark(new AddMarkContext(ctx, a.activePet, mark('second', { mutexGroup: 'g' })))
    noFailedPhases(battle)
    expect(a.activePet.stat.atk).toBe(55)
    expect(a.activePet.marks.map(m => m.baseId)).toEqual(['second'])
    expect(source.isActive).toBe(false)
    expect(source.owner).toBeNull()
  })
  it('transfers a mark on switch while retaining marked owner references', () => {
    const { a, battle } = fixture()
    const ctx = context(battle)
    battle.addMark(new AddMarkContext(ctx, a.activePet, mark('transfer', { transferOnSwitch: true })))
    const source = a.activePet.marks[0]
    const phase = new SwitchPetPhase(battle, a, a.team[1], new TurnContext(battle))
    phase.initialize()
    phase.execute()
    noFailedPhases(battle)
    expect(a.team[0].marks).toHaveLength(0)
    expect(a.team[1].marks).toEqual([source])
    expect(source.owner).toBe(a.team[1])
  })
  it('absorbs damage with a real shield and destroys depleted stacks', () => {
    const { a, b, battle } = fixture()
    const ctx = context(battle)
    battle.addMark(new AddMarkContext(ctx, b.activePet, mark('shield', { isShield: true, maxStacks: 100 }), 20))
    const hp = b.activePet.currentHp
    b.activePet.damage(new DamageContext(ctx, a.activePet, b.activePet, 30, DamageType.Physical))
    noFailedPhases(battle)
    expect(b.activePet.currentHp).toBe(hp - 10)
    expect(b.activePet.marks).toHaveLength(0)
  })
  it('heals and clamps HP through the original HealPhase', () => {
    const { a, battle } = fixture()
    const ctx = context(battle)
    a.activePet.currentHp = 10
    a.activePet.heal(new HealContext(ctx, a.activePet.skills[0], a.activePet, 500))
    noFailedPhases(battle)
    expect(a.activePet.currentHp).toBe(260)
  })
  it('executes multihit and effect priority/conditions in the real skill phase', () => {
    const { a, b, battle } = fixture()
    const order: number[] = []
    const effects = [1, 3, 2].map(
      priority =>
        new Effect<EffectTrigger>(
          `order/${priority}` as effectId,
          [EffectTrigger.OnHit],
          () => {
            order.push(priority)
          },
          priority,
          ctx => ctx.source.owner === b.activePet,
        ),
    )
    const base = new BaseSkill(
      'multihit' as baseSkillId,
      Category.Physical,
      Element.Normal,
      1,
      100,
      0,
      0,
      undefined,
      3,
      true,
      false,
      false,
      undefined,
      [],
      effects,
    )
    b.activePet.skills[0].effects.push(...effects)
    // V1 exposes multihit as readonly; use its real transformation mechanism to change the skill.
    battle.transformationSystem.applyTransformation(
      b.activePet.skills[0],
      base,
      'permanent',
      0,
      undefined,
      undefined,
      EffectHandlingStrategy.Override,
    )
    const damage: number[] = []
    battle.registerListener(m => {
      if (m.type === BattleMessageType.Damage) damage.push(m.data.damage)
    })
    const phase = new SkillPhase(
      battle,
      b,
      b.activePet,
      b.activePet.skills[0].target,
      b.activePet.skills[0],
      new TurnContext(battle),
    )
    battle.phaseManager.registerPhase(phase)
    expect(battle.phaseManager.executePhase(phase.id).success).toBe(true)
    noFailedPhases(battle)
    expect(damage).toHaveLength(3)
    expect(order).toEqual([3, 2, 1, 3, 2, 1, 3, 2, 1])
    expect(a.currentRage).toBeGreaterThanOrEqual(20)
  })
  it('reverts a temporary skill transformation when its mark source is destroyed', () => {
    const { a, battle } = fixture()
    const ctx = context(battle)
    battle.addMark(new AddMarkContext(ctx, a.activePet, mark('form-source')))
    const source = a.activePet.marks[0],
      skill = a.activePet.skills[0],
      original = skill.base
    const replacement = new BaseSkill('replacement' as baseSkillId, Category.Special, Element.Water, 90, 80, 12)
    expect(battle.transformationSystem.applyTransformation(skill, replacement, 'temporary', 3, source)).toBe(true)
    expect(skill.power).toBe(90)
    expect(skill.category).toBe(Category.Special)
    battle.removeMark(new RemoveMarkContext(ctx, source))
    noFailedPhases(battle)
    expect(skill.base).toBe(original)
    expect(skill.power).toBe(original.power)
    expect(battle.transformationSystem.getTransformationState(skill).isTransformed).toBe(false)
  })
  it('retains scoped config tags and reactive attribute modifiers', () => {
    const { a, b, battle } = fixture()
    const config = battle.configSystem
    config.registerTaggedConfig('value', 10, ['fixture'])
    config.set('value', 20, a)
    const cleanup = config.addScopedConfigModifier(
      'value',
      new ConfigModifier(ConfigDurationType.binding, 'scope', 3, ConfigModifierType.delta, 0),
      a,
    )
    expect(config.get('value', a.activePet)).toBe(23)
    expect(config.get('value', b.activePet)).toBe(10)
    expect(config.getConfigKeysByTag('fixture')).toEqual(['value'])
    cleanup()
    expect(config.get('value', a.activePet)).toBe(20)
  })
  it('retains working timers without a server or database', () => {
    vi.useFakeTimers()
    const { battle } = fixture()
    const timer = new BattleTimer(battle.playerA.id, {
      ...battle.getTimerConfig(),
      enabled: true,
      turnTimeLimit: 2,
      totalTimeLimit: 10,
    })
    try {
      timer.startTurn()
      vi.advanceTimersByTime(1000)
      expect(timer.getState().remainingTurnTime).toBe(1)
      timer.pause()
      vi.advanceTimersByTime(2000)
      expect(timer.getState().remainingTurnTime).toBe(1)
      timer.resume()
      vi.advanceTimersByTime(1000)
      expect(timer.getState().state).toBe('timeout')
    } finally {
      timer.cleanup()
    }
  })
})
