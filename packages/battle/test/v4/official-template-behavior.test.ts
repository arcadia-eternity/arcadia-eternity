import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import {
  BattleMessageType,
  DamageContext,
  DamageType,
  EffectTrigger,
  MarkUpdatePhase,
  RemoveMarkContext,
  SkillPhase,
  SwitchPetContext,
  StatLevelMarkInstanceImpl,
  setGlobalLogger,
  type Battle,
  type BehaviorUse,
} from '@arcadia-eternity/battle/v4'
import { templateData, templateFixture, useTemplate } from './official-template-fixture'

const battles: Battle[] = [],
  errors: unknown[][] = []
beforeAll(() =>
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      errors.push(args)
    },
  }),
)
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
  expect(errors.splice(0)).toEqual([])
})
function setup(skill: BehaviorUse[] = [], mark: BehaviorUse[] = []) {
  const f = templateFixture(templateData(skill, mark))
  battles.push(f.battle)
  f.battle.registerListener(message => {
    if (([BattleMessageType.EffectApplyFail, BattleMessageType.Error] as BattleMessageType[]).includes(message.type))
      errors.push([message])
  })
  return f
}
function executeSkill(f: ReturnType<typeof setup>, side = 0) {
  const use = f.skillUse(side)
  const phase = new SkillPhase(f.battle, use.origin, use.pet, use.selectTarget, use.skill, use.parent, use)
  f.battle.phaseManager.registerPhase(phase)
  f.battle.phaseManager.executePhase(phase.id)
  return use
}

it('combines two independently configured applications of a user mark and cleans its live attribute binding', () => {
  const f = setup(
    [
      useTemplate('apply-mark-on-hit', { mark: 'ugc/source', target: 'opponent', stacks: 1 }, 'first'),
      useTemplate('apply-mark-on-hit', { mark: 'ugc/source', target: 'opponent', stacks: 2 }, 'second'),
    ],
    [useTemplate('mark-attribute-per-stack', { attribute: 'spe', amount: -10 })],
  )
  const before = f.b.activePet.stat.spe
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  const mark = f.b.activePet.marks.find(mark => mark.baseId === 'ugc/source')!
  expect(mark.stack).toBe(3)
  expect(f.b.activePet.stat.spe).toBe(before - 30)
  expect(f.a.activePet.marks).toHaveLength(0)
  mark.stack = 5
  expect(f.b.activePet.stat.spe).toBe(before - 50)
  mark.isSuppressed = true
  expect(f.b.activePet.stat.spe).toBe(before)
  mark.isSuppressed = false
  expect(f.b.activePet.stat.spe).toBe(before - 50)
  f.battle.removeMark(new RemoveMarkContext(f.turn(), mark))
  expect(f.b.activePet.stat.spe).toBe(before)
})

it.each(['delta', 'percent'])(
  'applies and removes %s attribute contributions without touching other sources',
  operation => {
    const f = setup([], [useTemplate('mark-attribute', { attribute: 'atk', operation, amount: 20 })])
    const before = f.a.activePet.stat.atk
    const mark = f.addMark()
    expect(f.a.activePet.stat.atk).toBe(operation === 'delta' ? before + 20 : before * 1.2)
    f.battle.removeMark(new RemoveMarkContext(f.turn(), mark))
    expect(f.a.activePet.stat.atk).toBe(before)
  },
)

it('uses actual skill phases for multi-hit applications and never applies a hit template on a miss', () => {
  const f = setup([
    useTemplate('multihit-set', { amount: 3 }),
    useTemplate('apply-mark-on-hit', { mark: 'ugc/state', target: 'opponent' }, 'mark'),
  ])
  f.a.activePet.skills[0].sureHit = true
  const use = executeSkill(f)
  expect(use.multihitResult).toBe(3)
  expect(f.b.activePet.marks.find(mark => mark.baseId === 'ugc/state')?.stack).toBe(3)
  const miss = setup([useTemplate('apply-mark-on-hit', { mark: 'ugc/state', target: 'opponent' })])
  miss.a.activePet.skills[0].accuracy = 0
  executeSkill(miss)
  expect(miss.b.activePet.marks).toHaveLength(0)
})

it.each([0, 100])('probability %s needs no battle RNG draw for the template', chance => {
  const f = setup([useTemplate('apply-mark-on-hit', { mark: 'ugc/state', target: 'opponent', chance })])
  const untouched = setup()
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  expect(f.b.activePet.marks).toHaveLength(chance === 100 ? 1 : 0)
  expect(f.battle.random()).toBe(untouched.battle.random())
})

it('probabilistic templates consume exactly one draw and repeat under the same seed', () => {
  const use = useTemplate('apply-mark-on-hit', { mark: 'ugc/state', target: 'opponent', chance: 40 })
  const first = setup([use]),
    second = setup([use]),
    reference = setup()
  const outcomes: boolean[] = []
  for (const f of [first, second]) {
    f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
    outcomes.push(f.b.activePet.marks.length > 0)
  }
  expect(outcomes[0]).toBe(outcomes[1])
  reference.battle.random()
  expect(first.battle.random()).toBe(reference.battle.random())
})

it('changes the selected ability stage rather than applying an ordinary attribute delta', () => {
  const f = setup([useTemplate('change-stat-stage', { target: 'opponent', stat: 'def', amount: -2 })])
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  const mark = f.b.activePet.marks.find(
    (mark): mark is StatLevelMarkInstanceImpl => mark instanceof StatLevelMarkInstanceImpl,
  )
  expect(mark?.statType).toBe('def')
  expect(mark?.level).toBe(-2)
})

it.each([
  ['heal-fixed', { amount: 27 }, 27],
  ['heal-consecutive', { normal: 17, repeated: 39 }, 17],
] as const)('heals through %s with the configured amount', (id, params, expected) => {
  const f = setup([useTemplate(id, params)])
  f.a.activePet.currentHp = 10
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  expect(f.a.activePet.currentHp).toBe(10 + expected)
  if (id === 'heal-consecutive') {
    f.a.activePet.lastSkillUsedTimes = 2
    f.a.activePet.currentHp = 10
    f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
    expect(f.a.activePet.currentHp).toBe(49)
  }
})

it('floors fractional healing before the heal phase', () => {
  const f = setup([useTemplate('heal-fraction', { numerator: 1, denominator: 3 })])
  f.a.activePet.currentHp = 1
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  expect(f.a.activePet.currentHp).toBe(1 + Math.floor(f.a.activePet.stat.maxHp / 3))
})

it('consumes only the chosen opposing mark even when the skill event targets the user', () => {
  const f = setup([useTemplate('consume-mark-on-hit', { mark: 'ugc/state', target: 'opponent', stacks: 2 })])
  const own = f.addMark('ugc/state', 0, 4),
    opposing = f.addMark('ugc/state', 1, 4)
  const use = f.skillUse()
  use.actualTarget = f.a.activePet
  f.battle.applyEffects(use, EffectTrigger.OnHit)
  expect(own.stack).toBe(4)
  expect(opposing.stack).toBe(2)
})

it('clears a status category through normal removal and leaves the other player alone', () => {
  const f = setup([useTemplate('clear-status-on-hit', { target: 'self', category: 'status' })])
  f.addMark('ugc/state', 0)
  f.addMark('ugc/state', 1)
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  expect(f.a.activePet.marks).toHaveLength(0)
  expect(f.b.activePet.marks).toHaveLength(1)
})

it.each(['switch-in', 'battle-start'] as const)('applies entry marks only to the owning active pet on %s', event => {
  const f = setup([], [useTemplate(`apply-mark-on-${event}`, { mark: 'ugc/state', stacks: 2 })])
  f.addMark()
  if (event === 'switch-in') {
    f.battle.applyEffects(new SwitchPetContext(f.turn(), f.b, f.b.activePet), EffectTrigger.OnSwitchIn)
    expect(f.a.activePet.marks).toHaveLength(1)
    f.battle.applyEffects(new SwitchPetContext(f.turn(), f.a, f.a.activePet), EffectTrigger.OnSwitchIn)
  } else f.battle.applyEffects(f.battle, EffectTrigger.OnBattleStart)
  expect(f.a.activePet.marks.find(mark => mark.baseId === 'ugc/state')?.stack).toBe(2)
  expect(f.b.activePet.marks).toHaveLength(0)
})

it('reacts to damage of the holder and applies its mark to the configured opponent', () => {
  const f = setup([], [useTemplate('apply-mark-when-damaged', { mark: 'ugc/state', target: 'opponent' })])
  f.addMark('ugc/source', 1)
  f.b.activePet.damage(new DamageContext(f.skillUse(), f.a.activePet.skills[0], f.b.activePet, 30, DamageType.Physical))
  expect(f.a.activePet.marks.some(mark => mark.baseId === 'ugc/state')).toBe(true)
  expect(f.b.activePet.marks.some(mark => mark.baseId === 'ugc/state')).toBe(false)
})

it.each(['expiry', 'destroy'] as const)('runs the source mark successor exactly once on %s', event => {
  const f = setup([], [useTemplate(`apply-mark-on-${event}`, { mark: 'ugc/state', stacks: 2 })])
  const mark = f.addMark()
  if (event === 'expiry') {
    mark.duration = 1
    const phase = new MarkUpdatePhase(f.battle, f.turn(), mark)
    f.battle.phaseManager.registerPhase(phase)
    f.battle.phaseManager.executePhase(phase.id)
  } else f.battle.removeMark(new RemoveMarkContext(f.turn(), mark))
  expect(mark.isActive).toBe(false)
  expect(f.a.activePet.marks).toHaveLength(1)
  expect(f.a.activePet.marks[0].baseId).toBe('ugc/state')
  expect(f.a.activePet.marks[0].stack).toBe(2)
})

it('grows at turn end, caps stacks, and consumes through a different fixed event', () => {
  const f = setup(
    [],
    [
      useTemplate('grow-mark-on-turn-end', { stacks: 4 }, 'grow'),
      useTemplate('consume-mark-after-skill', { stacks: 2 }, 'spend'),
    ],
  )
  const mark = f.addMark('ugc/source', 0, 8)
  f.battle.applyEffects(f.turn(), EffectTrigger.TurnEnd)
  expect(mark.stack).toBe(10)
  f.battle.applyEffects(f.skillUse(), EffectTrigger.SkillUseEnd)
  expect(mark.stack).toBe(8)
})

it.each(['all', 'element', 'tag', 'skill'] as const)(
  'scopes skill attribute contributions by %s and removes them with the mark',
  scope => {
    const params = {
      attribute: 'power',
      operation: 'delta',
      amount: 15,
      ...(scope === 'element'
        ? { element: 'Normal' }
        : scope === 'tag'
          ? { tag: 'test' }
          : scope === 'skill'
            ? { skill: 'ugc/other' }
            : {}),
    }
    const f = setup([], [useTemplate(`mark-skill-attribute-${scope}`, params)])
    const before = f.a.activePet.skills.map(skill => skill.power)
    const mark = f.addMark()
    expect(f.a.activePet.skills.map(skill => skill.power)).toEqual(
      before.map((power, index) => power + (scope !== 'skill' || index === 1 ? 15 : 0)),
    )
    f.battle.removeMark(new RemoveMarkContext(f.turn(), mark))
    expect(f.a.activePet.skills.map(skill => skill.power)).toEqual(before)
  },
)

it.each(['all', 'element', 'tag', 'skill'] as const)('changes only matching skill-use power with scope %s', scope => {
  const params = {
    operation: 'multiply',
    amount: 2,
    ...(scope === 'element'
      ? { element: 'Normal' }
      : scope === 'tag'
        ? { tag: 'test' }
        : scope === 'skill'
          ? { skill: 'ugc/other' }
          : {}),
  }
  const f = setup([], [useTemplate(`skill-power-${scope}`, params)])
  f.addMark()
  const use = f.skillUse(0, scope === 'skill' ? 1 : 0)
  const before = use.power
  f.battle.applyEffects(use, EffectTrigger.AfterUseSkillCheck)
  expect(use.power).toBe(before * 2)
  const wrong = f.skillUse(1)
  f.battle.applyEffects(wrong, EffectTrigger.AfterUseSkillCheck)
  expect(wrong.power).toBe(before)
})

it.each(['dealt', 'taken'] as const)('modifies %s physical damage using a live source stack', direction => {
  const f = setup(
    [],
    [useTemplate(`modify-damage-${direction}-per-stack`, { percent: direction === 'dealt' ? 10 : -10, delta: 0 })],
  )
  f.addMark('ugc/source', direction === 'dealt' ? 0 : 1, 2)
  const damage = new DamageContext(f.skillUse(), f.a.activePet.skills[0], f.b.activePet, 100, DamageType.Physical)
  f.b.activePet.damage(damage)
  expect(damage.damageResult).toBe(direction === 'dealt' ? 120 : 80)
})

it.each(['accuracy', 'critRate', 'sureHit', 'sureCrit'] as const)('changes the current use result %s', result => {
  const f = setup([
    useTemplate(`skill-result-${result}`, result === 'accuracy' || result === 'critRate' ? { amount: -10 } : {}),
  ])
  const use = f.skillUse()
  const before = result === 'accuracy' ? use.accuracy : use.critRate
  f.battle.applyEffects(
    use,
    result === 'accuracy' || result === 'sureHit'
      ? EffectTrigger.BeforeUseSkillCheck
      : EffectTrigger.AfterUseSkillCheck,
  )
  if (result === 'accuracy') expect(use.accuracy).toBe(before - 10)
  else if (result === 'critRate') expect(use.critRate).toBe(Math.max(0, before - 10))
  else if (result === 'sureHit') {
    use.updateHitResult()
    expect(use.hitResult).toBe(true)
  } else {
    use.updateCritResult()
    expect(use.crit).toBe(true)
  }
})

it.each(['power', 'sureHit', 'sureCrit'] as const)(
  'consumes a next-attack mark and still applies its %s result',
  result => {
    const f = setup([], [useTemplate(`next-attack-${result}`, result === 'power' ? { multiplier: 2 } : {})])
    const mark = f.addMark()
    const use = f.skillUse(),
      power = use.power
    f.battle.applyEffects(use, EffectTrigger.AfterUseSkillCheck)
    expect(mark.isActive).toBe(false)
    if (result === 'power') expect(use.power).toBe(power * 2)
    else if (result === 'sureHit') {
      use.updateHitResult()
      expect(use.hitResult).toBe(true)
    } else {
      use.updateCritResult()
      expect(use.crit).toBe(true)
    }
  },
)

it('adds multihits only when the skill already has multiple hits', () => {
  const f = setup([useTemplate('multihit-add', { amount: 2 })])
  const use = f.skillUse()
  use.multihitResult = 1
  f.battle.applyEffects(use, EffectTrigger.BeforeMultiHit)
  expect(use.multihitResult).toBe(1)
  use.multihitResult = 3
  f.battle.applyEffects(use, EffectTrigger.BeforeMultiHit)
  expect(use.multihitResult).toBe(5)
})

it('uses damageResult for healing, threshold rewards and crit rewards through real damage phases', () => {
  const f = setup([
    useTemplate('heal-from-damage', { ratio: 0.25 }, 'heal'),
    useTemplate('rage-after-damage', { threshold: 100, amount: 13 }, 'rage'),
    useTemplate('rage-after-crit', { amount: 7 }, 'crit'),
  ])
  f.a.activePet.currentHp = 10
  f.a.currentRage = 0
  const damage = new DamageContext(f.skillUse(), f.a.activePet.skills[0], f.b.activePet, 120, DamageType.Physical, true)
  f.b.activePet.damage(damage)
  expect(f.a.activePet.currentHp).toBe(40)
  expect(f.a.currentRage).toBe(20)
})

it.each(['heal', 'damage', 'rage'] as const)('runs periodic %s only while the source owner is active', resource => {
  const f = setup([], [useTemplate(`turn-end-${resource}`, { target: 'self', amount: 10 })])
  f.a.activePet.currentHp = 100
  f.a.currentRage = 30
  f.addMark()
  f.battle.applyEffects(f.turn(), EffectTrigger.TurnEnd)
  expect(resource === 'rage' ? f.a.currentRage : f.a.activePet.currentHp).toBe(
    resource === 'rage' ? 40 : resource === 'heal' ? 110 : 90,
  )
  const previous = f.a.activePet
  f.a.activePet = f.a.team[1]
  f.battle.applyEffects(f.turn(), EffectTrigger.TurnEnd)
  expect(resource === 'rage' ? f.a.currentRage : previous.currentHp).toBe(
    resource === 'rage' ? 40 : resource === 'heal' ? 110 : 90,
  )
})

it('uses rage-loss hooks when a template reduces opposing rage', () => {
  const f = setup([useTemplate('rage-on-hit', { target: 'opponent', operation: 'reduce', amount: 17 })])
  f.b.currentRage = 50
  const apply = vi.spyOn(f.battle, 'applyEffects')
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  expect(f.b.currentRage).toBe(33)
  expect(apply.mock.calls.some(call => call[1] === EffectTrigger.BeforeRageLoss)).toBe(true)
})

it.each(['duration', 'maxStacks'] as const)(
  'modifies one matching mark application %s without changing its prototype',
  setting => {
    const f = setup(
      [useTemplate('apply-mark-on-hit', { mark: 'ugc/state' })],
      [useTemplate(`modify-mark-${setting}`, { mark: 'ugc/state', amount: 5 })],
    )
    f.addMark()
    const original = f.catalog.getMark('ugc/state' as never).config[setting]
    f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
    const mark = f.a.activePet.marks.find(mark => mark.baseId === 'ugc/state')!
    expect(setting === 'duration' ? mark.duration : mark.config.maxStacks).toBe(5)
    expect(f.catalog.getMark('ugc/state' as never).config[setting]).toBe(original)
  },
)

it.each(['immune-mark', 'immune-status-category'] as const)(
  'blocks new matching marks through %s but retains existing marks',
  id => {
    const f = setup([], [useTemplate(id, id === 'immune-mark' ? { mark: 'ugc/state' } : { category: 'status' })])
    const existing = f.addMark('ugc/state', 0, 2)
    f.addMark()
    f.addMark('ugc/state', 0, 3)
    expect(existing.stack).toBe(2)
    expect(existing.isActive).toBe(true)
  },
)

it('transfers a matching state with its stacks and duration instead of copying it', () => {
  const f = setup([useTemplate('transfer-status-on-hit', { category: 'status' })])
  const mark = f.addMark('ugc/state', 0, 4)
  mark.duration = 7
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  expect(f.a.activePet.marks).toHaveLength(0)
  expect(f.b.activePet.marks).toHaveLength(1)
  expect(f.b.activePet.marks[0].stack).toBe(4)
  expect(f.b.activePet.marks[0].duration).toBe(7)
})

it.each([false, true])('moves all owner contributions with a user mark (merge=%s)', merge => {
  const f = setup(
    [useTemplate('transfer-status-on-hit', { category: 'status' })],
    [
      useTemplate('mark-attribute', { attribute: 'def', amount: 12 }, 'fixed'),
      useTemplate('mark-attribute-per-stack', { attribute: 'spe', amount: -10 }, 'stack'),
      useTemplate('mark-skill-attribute-all', { attribute: 'power', amount: 7 }, 'skills'),
    ],
  )
  const a = f.a.activePet,
    b = f.b.activePet
  const base = { def: a.stat.def, spe: a.stat.spe, power: a.skills[0].power }
  if (merge) f.addMark('ugc/source', 1, 1)
  const source = f.addMark('ugc/source', 0, 2)
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  expect(a.marks).toHaveLength(0)
  expect([a.stat.def, a.stat.spe, a.skills[0].power]).toEqual([base.def, base.spe, base.power])
  const moved = b.marks.find(mark => mark.baseId === 'ugc/source')!
  expect(moved.stack).toBe(merge ? 3 : 2)
  expect([b.stat.def, b.stat.spe, b.skills[0].power]).toEqual([
    base.def + 12,
    base.spe - moved.stack * 10,
    base.power + 7,
  ])
  source.stack = 8
  if (merge) expect(b.stat.spe).toBe(base.spe - 30)
  moved.isSuppressed = true
  expect([b.stat.def, b.stat.spe, b.skills[0].power]).toEqual([base.def, base.spe, base.power])
  moved.isSuppressed = false
  f.battle.removeMark(new RemoveMarkContext(f.turn(), moved))
  expect([b.stat.def, b.stat.spe, b.skills[0].power]).toEqual([base.def, base.spe, base.power])
})

it('rebinds a suppressed mark on transfer and activates its contributions only when suppression ends', () => {
  const f = setup(
    [useTemplate('transfer-status-on-hit')],
    [useTemplate('mark-attribute-per-stack', { attribute: 'spe', amount: -10 })],
  )
  const before = f.b.activePet.stat.spe
  const mark = f.addMark('ugc/source', 0, 2)
  mark.isSuppressed = true
  f.battle.applyEffects(f.skillUse(), EffectTrigger.OnHit)
  expect(mark.owner).toBe(f.b.activePet)
  expect(f.b.activePet.stat.spe).toBe(before)
  mark.isSuppressed = false
  expect(f.b.activePet.stat.spe).toBe(before - 20)
})

it.each(['power', 'sureHit', 'sureCrit'] as const)(
  'retains next-attack %s on failed skill checks and consumes it on an attempted attack',
  result => {
    for (const failure of ['disabled', 'rage']) {
      const f = setup([], [useTemplate(`next-attack-${result}`)])
      const mark = f.addMark()
      const use = f.skillUse()
      if (failure === 'disabled') use.available = false
      else {
        f.a.currentRage = 0
        use.rage = 100
      }
      const phase = new SkillPhase(f.battle, use.origin, use.pet, use.selectTarget, use.skill, use.parent, use)
      f.battle.phaseManager.registerPhase(phase)
      f.battle.phaseManager.executePhase(phase.id)
      expect(mark.isActive).toBe(true)
      expect(mark.stack).toBe(1)
      f.a.currentRage = 100
      f.a.activePet.skills[0].accuracy = 0
      const attempted = executeSkill(f)
      expect(mark.isActive).toBe(false)
      expect(attempted.hitResult).toBe(result === 'sureHit')
    }
  },
)
