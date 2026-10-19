import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AddMarkContext,
  BaseMark,
  DamageContext,
  HealContext,
  Signal,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  parameterAddress,
  Effect,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  SwitchPetPhase,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '../../v4'
import { makeScenario } from '../../test/v4/scenario'
import {
  compileEffect,
  effectParameters,
  numberParam,
  booleanParam,
  defineEffect,
  targets,
  contexts,
  actions,
  conditions,
  ops,
  values,
  type BindingValue,
  type Presence,
} from './api'
import { consumeFantasyForDefense } from './examples/fantasy-defense'
import { damageBoostByHp } from './examples/damage-by-hp'
import { timeRebirth } from './examples/time-rebirth'
import {
  weaknessSpeedPenalty,
  capturedInstancePenalty,
  followingInstancePenalty,
  entryStackPenalty,
} from './examples/weakness-speed'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  const owner = f.a.activePet
  const skill = owner.skills[0]
  const use = new UseSkillContext(new TurnContext(f.battle), f.a, owner, AttackTargetOpinion.opponent, skill)
  const ctx = new EffectContext(use, EffectTrigger.BeforeHit, skill)
  function add(id: string, effects: Effect<EffectTrigger>[] = [], stack = 1) {
    const base = new BaseMark(id as baseMarkId, effects, {
      ...f.debuff.config,
      maxStacks: 10,
      stackable: true,
      keepOnSwitchOut: true,
    })
    f.battle.addMark(new AddMarkContext(ctx, owner, base, stack))
    const mark = owner.marks.find(mark => mark.baseId === id)
    if (!mark) throw new Error(`Mark creation failed: ${id}`)
    return mark
  }
  return { ...f, owner, skill, use, ctx, add }
}
function hook(id: string, trigger: EffectTrigger, apply: (ctx: EffectContext<EffectTrigger>) => void) {
  return new Effect(
    id as effectId,
    [trigger],
    apply,
    0,
    ctx =>
      trigger !== EffectTrigger.BeforeEffect ||
      (ctx.parent instanceof EffectContext && !ctx.parent.effect?.triggers.includes(EffectTrigger.BeforeEffect)),
  )
}
it('runs fantasy consumption and re-queries owner after the removal hook', () => {
  const f = fixture()
  const next = f.a.team[1]
  const initial = f.owner.stat.def
  const nextInitial = next.stat.def
  f.add('mark_huanxiang', [
    hook('move-source', EffectTrigger.OnMarkDestroy, () => {
      f.skill.owner = next
    }),
  ])
  f.skill.effects.splice(0, f.skill.effects.length, compileEffect(consumeFantasyForDefense))
  f.battle.applyEffects(f.use, EffectTrigger.BeforeHit, f.skill)
  expect(f.owner.marks.some(mark => mark.baseId === 'mark_huanxiang')).toBe(false)
  expect(f.owner.stat.def).toBe(initial)
  expect(next.stat.def).toBeGreaterThan(nextInitial)
})
it('reads HP again in execution after admission and preserves lazy branches', () => {
  const f = fixture()
  const source = f.add('damage-source', [compileEffect(damageBoostByHp)])
  f.owner.currentHp = Math.floor(f.owner.stat.maxHp * 0.6)
  let changed = 0
  f.add('before-effect', [
    hook('lower-hp', EffectTrigger.BeforeEffect, ctx => {
      if (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === damageBoostByHp.id) {
        changed++
        f.owner.currentHp = Math.floor(f.owner.stat.maxHp * 0.2)
      }
    }),
  ])
  const damage = new DamageContext(f.use, f.owner, f.b.activePet, 100)
  f.battle.applyEffects(damage, EffectTrigger.OnBeforeCalculateDamage, source)
  expect(changed).toBe(1)
  expect(damage.modified).toEqual([70, 0])
  let unused = 0
  const unusedCondition = targets.ownerPet.condition(() => {
    unused++
    return true
  })
  const chosen = values.choose(() => true, 7, values.choose(unusedCondition, 999, 0))
  let result: number | undefined
  const effect = compileEffect(
    defineEffect({
      id: 'lazy',
      on: 'BeforeHit',
      execute: ctx => {
        result = ctx.read(chosen)
      },
    }),
  )
  f.skill.effects.splice(0, f.skill.effects.length, effect)
  f.battle.applyEffects(f.use, EffectTrigger.BeforeHit, f.skill)
  expect(result).toBe(7)
  expect(unused).toBe(0)
})
it('rebirth assigns current HP from execution-time max HP without heal hooks', () => {
  const f = fixture()
  const source = f.add('rebirth', [compileEffect(timeRebirth)])
  let healing = 0
  f.add('watch', [
    hook('heal-watch', EffectTrigger.OnBeforeHeal, () => {
      healing++
    }),
    hook('resize', EffectTrigger.BeforeEffect, ctx => {
      if (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === timeRebirth.id)
        f.owner.attributeSystem.updateBaseValue('maxHp', 400)
    }),
  ])
  f.owner.currentHp = 0
  const damage = new DamageContext(f.use, f.b.activePet, f.owner, 100)
  f.battle.applyEffects(damage, EffectTrigger.PostDamage, source)
  expect(f.owner.currentHp).toBe(100)
  expect(healing).toBe(0)
})
function penalty(plan: BindingValue<number, Presence>, id = 'penalty') {
  return compileEffect(
    defineEffect({
      id,
      on: 'OnMarkCreated',
      execute: targets.ownerPet.apply(
        ops.bindAttribute({
          key: 'speed',
          attribute: 'spe',
          operation: 'delta',
          value: plan,
          lifetime: 'sourceMark',
          missing: 'detach',
        }),
      ),
    }),
  )
}
it('runs the weakness example on creation, follows stack, changes spe only, and cleans up with source', () => {
  const f = fixture()
  f.owner.attributeSystem.updateBaseValue('spe', 300)
  const spd = f.owner.stat.spd
  const mark = f.add('mark_ruodianjihao', [], 2)
  const source = f.add('speed-source', [compileEffect(weaknessSpeedPenalty)])
  expect(f.owner.stat.spe).toBe(250)
  expect(f.owner.stat.spd).toBe(spd)
  mark.stack = 3
  expect(f.owner.stat.spe).toBe(225)
  source.consumeStack(f.ctx, 1)
  expect(f.owner.stat.spe).toBe(300)
  mark.stack = 4
  expect(f.owner.stat.spe).toBe(300)
})
it.each([
  ['capture instance', capturedInstancePenalty, [250, 225, 225, 200]],
  ['follow instance', followingInstancePenalty, [250, 225, 275, 275]],
  ['capture per entry', entryStackPenalty, [250, 250, 275, 275]],
] as const)('%s separates object selection from stack timing', (name, plan, expected) => {
  const f = fixture()
  f.owner.attributeSystem.updateBaseValue('spe', 300)
  const old = f.add('mark_ruodianjihao', [], 2)
  f.add('speed-source', [penalty(plan)])
  const actual = [f.owner.stat.spe]
  old.stack = 3
  actual.push(f.owner.stat.spe)
  const replacement = old.base.createInstance({ stack: 1 })
  replacement.setOwner(f.owner, f.battle.emitter)
  f.owner.marks.splice(f.owner.marks.indexOf(old), 1, replacement)
  actual.push(f.owner.stat.spe)
  old.stack = 4
  actual.push(f.owner.stat.spe)
  expect(actual).toEqual(expected)
})
it('follow survives absent input and captures a new generation on same-instance re-entry without intermediate reads', () => {
  const f = fixture()
  f.owner.attributeSystem.updateBaseValue('spe', 300)
  f.add('speed-source', [penalty(entryStackPenalty)])
  expect(f.owner.stat.spe).toBe(300)
  const mark = f.add('mark_ruodianjihao', [], 2)
  expect(f.owner.stat.spe).toBe(250)
  f.owner.marks = f.owner.marks.filter(item => item !== mark)
  mark.stack = 4
  f.owner.marks.push(mark)
  expect(f.owner.stat.spe).toBe(200)
  mark.stack = 5
  expect(f.owner.stat.spe).toBe(200)
})
it.each(['capture', 'follow'] as const)('%s handles real removal and subsequent replacement', mode => {
  const f = fixture()
  f.owner.attributeSystem.updateBaseValue('spe', 300)
  const mark = f.add('mark_ruodianjihao', [], 2)
  f.add('speed-source', [penalty(mode === 'capture' ? capturedInstancePenalty : followingInstancePenalty)])
  mark.consumeStack(f.ctx, 2)
  expect(f.owner.stat.spe).toBe(300)
  f.add('mark_ruodianjihao', [], 3)
  expect(f.owner.stat.spe).toBe(mode === 'capture' ? 300 : 225)
})
it.each(['capture', 'follow'] as const)('%s opponent selection across real switch phases', mode => {
  const f = fixture()
  f.b.team[0].attributeSystem.updateBaseValue('def', 40)
  f.b.team[1].attributeSystem.updateBaseValue('def', 80)
  const root = targets.opponentActive.first()
  const selected =
    mode === 'capture' ? root.capture({ key: 'opponent', scope: 'binding' }) : root.follow({ key: 'opponent' })
  f.add('opponent-source', [
    penalty(
      selected
        .attribute('def')
        .follow({ key: 'def' })
        .map(n => -n),
    ),
  ])
  const initial = f.owner.stat.spe
  f.b.team[0].attributeSystem.updateBaseValue('def', 50)
  expect(f.owner.stat.spe).toBe(initial - 10)
  const phase = new SwitchPetPhase(f.battle, f.b, f.b.team[1], new TurnContext(f.battle))
  phase.initialize()
  expect(phase.execute().success).toBe(true)
  expect(f.owner.stat.spe).toBe(initial - (mode === 'capture' ? 10 : 40))
})

it('reads a numeric operand once for all targets in one operation', () => {
  const f = fixture()
  const first = f.add('counter/first', [], 3)
  const second = f.add('counter/second', [], 3)
  let reads = 0
  const amount = targets.ownerPet.first().map(() => {
    reads++
    return 1
  })
  const effect = compileEffect(
    defineEffect({
      id: 'consume-two',
      on: 'BeforeHit',
      execute: targets.ownerMarks.where(mark => mark.baseId.startsWith('counter/')).apply(ops.consumeStacks(amount)),
    }),
  )
  f.skill.effects.splice(0, f.skill.effects.length, effect)
  f.battle.applyEffects(f.use, EffectTrigger.BeforeHit, f.skill)
  expect(reads).toBe(1)
  expect([first.stack, second.stack]).toEqual([2, 2])
})

it('captures an absent selection once instead of silently turning capture into follow', () => {
  const f = fixture()
  f.owner.attributeSystem.updateBaseValue('spe', 300)
  f.add('speed-source', [penalty(capturedInstancePenalty)])
  f.add('mark_ruodianjihao', [], 3)
  expect(f.owner.stat.spe).toBe(300)
})

it('keeps a binding-scope captured attribute fixed across attribute and slot changes', () => {
  const f = fixture()
  f.owner.attributeSystem.updateBaseValue('spe', 300)
  f.b.team[0].attributeSystem.updateBaseValue('def', 40)
  f.b.team[1].attributeSystem.updateBaseValue('def', 80)
  const plan = targets.opponentActive
    .first()
    .follow({ key: 'slot' })
    .attribute('def')
    .capture({ key: 'initial-defense', scope: 'binding' })
    .map(n => -n)
  f.add('captured-attribute', [penalty(plan)])
  f.b.team[0].attributeSystem.updateBaseValue('def', 60)
  f.b.activePet = f.b.team[1]
  expect(f.owner.stat.spe).toBe(260)
})

it('duplicate temporal keys and self-dependent attributes are rejected, not treated as missing input', () => {
  const f = fixture()
  f.add('mark_ruodianjihao', [], 2)
  const source = f.add('binding-source')
  const plans = [
    targets.ownerPet.first().follow({ key: 'same' }).attribute('def').follow({ key: 'same' }),
    targets.ownerPet.first().follow({ key: 'pet' }).attribute('spe').follow({ key: 'speed' }),
  ]
  const initial = f.owner.stat.spe
  for (const plan of plans) {
    const effect = penalty(plan)
    const context = new EffectContext(
      new AddMarkContext(f.ctx, f.owner, source.base),
      EffectTrigger.OnMarkCreated,
      source,
      effect,
    )
    expect(() => f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(context))).toThrow()
  }
  expect(f.owner.stat.spe).toBe(initial)
})

it('observes a marks handle retained before the first persistent selector runs', () => {
  const f = fixture()
  const marks = f.owner.marks
  f.owner.attributeSystem.updateBaseValue('spe', 300)
  const mark = f.add('mark_ruodianjihao', [], 2)
  f.add('speed-source', [penalty(entryStackPenalty)])
  expect(f.owner.stat.spe).toBe(250)
  marks.splice(marks.indexOf(mark), 1)
  mark.stack = 4
  marks.push(mark)
  expect(f.owner.stat.spe).toBe(200)
})

it('takes ownership of assigned membership instead of retaining an unobservable raw array alias', () => {
  const f = fixture()
  f.owner.attributeSystem.updateBaseValue('spe', 300)
  const mark = f.add('mark_ruodianjihao', [], 2)
  const input = [...f.owner.marks]
  f.owner.marks = input
  f.add('speed-source', [penalty(entryStackPenalty)])
  input.splice(input.indexOf(mark), 1)
  expect(f.owner.marks).toContain(mark)
  expect(f.owner.stat.spe).toBe(250)
  const current = f.owner.marks
  current.splice(current.indexOf(mark), 1)
  mark.stack = 4
  current.push(mark)
  expect(f.owner.stat.spe).toBe(200)
})

it('re-queries the nearest damage context between actions and reads percent then delta once each', () => {
  const f = fixture()
  const first = new DamageContext(f.use, f.owner, f.b.activePet, 100)
  const second = new DamageContext(f.use, f.owner, f.b.activePet, 100)
  const nested = new EffectContext(first, EffectTrigger.OnDamage, f.skill)
  const reads: string[] = []
  const amount = (name: string, n: number) =>
    targets.ownerPet.first().map(() => {
      reads.push(name)
      return n
    })
  const apply = contexts.damage.apply(ops.modifyDamage({ percent: amount('percent', 10), delta: amount('delta', 3) }))
  const effect = compileEffect(
    defineEffect({
      id: 'nested-damage',
      on: 'BeforeEffect',
      execute: actions.sequence(
        apply,
        () => {
          Reflect.set(nested, 'parent', second)
        },
        apply,
      ),
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () =>
    effect.innerApply(new EffectContext(nested, EffectTrigger.BeforeEffect, f.skill, effect)),
  )
  expect(first.modified).toEqual([10, 3])
  expect(second.modified).toEqual([10, 3])
  expect(reads).toEqual(['percent', 'delta', 'percent', 'delta'])
})
it('skips missing damage inputs and rejects foreign contexts before writing', () => {
  const f = fixture(),
    other = fixture()
  const damage = new DamageContext(f.use, f.owner, f.b.activePet, 100)
  let deltaReads = 0
  const missing = targets.ownerMarks
    .where(() => false)
    .select(mark => mark.stack)
    .first()
  const delta = targets.ownerPet.first().map(() => {
    deltaReads++
    return 5
  })
  const effect = compileEffect(
    defineEffect({
      id: 'missing-damage',
      on: 'OnDamage',
      execute: contexts.damage.apply(ops.modifyDamage({ percent: missing, delta })),
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () =>
    effect.innerApply(new EffectContext(damage, EffectTrigger.OnDamage, f.skill, effect)),
  )
  expect(damage.modified).toEqual([0, 0])
  expect(deltaReads).toBe(1)
  const foreign = new DamageContext(other.use, other.owner, other.b.activePet, 100)
  const cross = compileEffect(
    defineEffect({
      id: 'foreign-damage',
      on: 'OnDamage',
      execute: contexts.damage.select(() => foreign).apply(ops.modifyDamage({ percent: 10, delta: 5 })),
    }),
  )
  expect(() =>
    f.battle.executionBudget.run(f.battle.currentTurn, () =>
      cross.innerApply(new EffectContext(damage, EffectTrigger.OnDamage, f.skill, cross)),
    ),
  ).toThrow('Cross-battle')
  expect(foreign.modified).toEqual([0, 0])
})
it('composes condition predicates in order with short-circuiting', () => {
  const f = fixture(),
    trace: string[] = []
  const yes = () => {
      trace.push('yes')
      return true
    },
    no = () => {
      trace.push('no')
      return false
    }
  const effect = compileEffect(
    defineEffect({
      id: 'condition-order',
      on: 'BeforeHit',
      when: conditions.all(yes, conditions.not(no), conditions.any(yes, no), no, yes),
      execute: () => {
        throw new Error('must not execute')
      },
    }),
  )
  f.skill.effects.splice(0, f.skill.effects.length, effect)
  f.battle.applyEffects(f.use, EffectTrigger.BeforeHit, f.skill)
  expect(trace).toEqual(['yes', 'no', 'yes', 'no'])
})

it('reads declared parameters from the current source scope on each action', () => {
  const f = fixture()
  const observed: unknown[] = []
  const amount = numberParam({ default: 15, legacyAliases: ['test.amount'] })
  const enabled = booleanParam({ default: true })
  const effect = compileEffect(
    defineEffect({
      id: 'test/parameters',
      on: 'BeforeHit',
      parameters: { amount, enabled },
      execute(ctx, p) {
        observed.push([ctx.read(p.amount), ctx.read(p.enabled)])
      },
    }),
  )
  const catalog = effectParameters(effect)
  catalog.install(f.battle.configSystem)
  const run = (source = f.skill) =>
    f.battle.executionBudget.run(f.battle.currentTurn, () =>
      effect.innerApply(new EffectContext(f.use, EffectTrigger.BeforeHit, source, effect)),
    )
  run()
  const amountSignal = new Signal(7)
  const modifier = new ConfigModifier(
    ConfigDurationType.binding,
    'test/amount',
    amountSignal,
    ConfigModifierType.override,
    0,
  )
  const remove = catalog.modify(f.battle.configSystem, 'test.amount', modifier, f.skill)
  run()
  amountSignal.next(9)
  run()
  run(f.a.team[1].skills[0])
  catalog.modify(
    f.battle.configSystem,
    parameterAddress(effect.id, 'parameters', 'enabled'),
    new ConfigModifier(ConfigDurationType.binding, 'test/enabled', false, ConfigModifierType.override, 0),
    f.skill,
  )
  remove()
  run()
  expect(observed).toEqual([
    [15, true],
    [7, true],
    [9, true],
    [15, true],
    [15, false],
  ])
})
it('rejects missing installation, undeclared references and ambiguous parameter identities', () => {
  const f = fixture()
  const amount = numberParam({ default: 5 })
  const definition = defineEffect({
    id: 'test/missing-parameter',
    on: 'BeforeHit',
    parameters: { amount },
    execute(ctx) {
      ctx.read(amount)
    },
  })
  const effect = compileEffect(definition)
  const run = () => f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(run).toThrow('Invalid effective parameter')
  effectParameters(effect).install(f.battle.configSystem)
  expect(run).not.toThrow()
  const undeclared = compileEffect(
    defineEffect({
      id: 'test/undeclared',
      on: 'BeforeHit',
      execute(ctx) {
        ctx.read(amount)
      },
    }),
  )
  expect(() => f.battle.executionBudget.run(f.battle.currentTurn, () => undeclared.innerApply(f.ctx))).toThrow(
    'not declared',
  )
  expect(() =>
    compileEffect(
      defineEffect({ id: definition.id, on: 'BeforeHit', parameters: { first: amount, second: amount }, execute() {} }),
    ),
  ).toThrow('multiple names')
})
it('owns parameter metadata and isolates a shared declaration between effects and battles', () => {
  const f = fixture(),
    other = fixture()
  const options = { default: 4, tags: ['original'], legacyAliases: ['original.alias'] }
  const amount = numberParam(options)
  options.default = 100
  options.tags.push('changed')
  options.legacyAliases[0] = 'changed.alias'
  const observed: number[] = []
  const make = (id: string) =>
    compileEffect(
      defineEffect({
        id,
        on: 'BeforeHit',
        parameters: { amount },
        execute(ctx) {
          observed.push(ctx.read(amount))
        },
      }),
    )
  const first = make('parameter/a'),
    second = make('parameter/b')
  effectParameters(first).install(f.battle.configSystem)
  effectParameters(second).install(other.battle.configSystem)
  effectParameters(second).install(f.battle.configSystem)
  effectParameters(first).modify(
    f.battle.configSystem,
    'original.alias',
    new ConfigModifier(ConfigDurationType.binding, 'change', 2, ConfigModifierType.delta, 0),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => first.innerApply(f.ctx))
  other.battle.executionBudget.run(other.battle.currentTurn, () => second.innerApply(other.ctx))
  f.battle.executionBudget.run(f.battle.currentTurn, () => second.innerApply(f.ctx))
  expect(observed).toEqual([6, 4, 4])
  expect(() =>
    effectParameters(first).modify(
      f.battle.configSystem,
      'changed.alias',
      new ConfigModifier(ConfigDurationType.binding, 'bad', 1, ConfigModifierType.delta, 0),
    ),
  ).toThrow('Unknown parameter')
})

it('combines values left-to-right once and reads the right input even when the left is absent', () => {
  const f = fixture(),
    trace: string[] = [],
    results: unknown[] = []
  let missing = false
  const left = targets.ownerPet
    .select(() => {
      trace.push('left')
      return missing ? undefined : 5
    })
    .first()
  const right = targets.ownerPet
    .select(() => {
      trace.push('right')
      return 2
    })
    .first()
  const combined = values.combine(left, right, (a, b) => {
    trace.push('project')
    return a! + b
  })
  const effect = compileEffect(
    defineEffect({
      id: 'test/combine',
      on: 'BeforeHit',
      execute(ctx) {
        results.push(ctx.read(combined))
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  missing = true
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(results).toEqual([7, undefined])
  expect(trace).toEqual(['left', 'right', 'project', 'left', 'right'])
})

it('uses engine-owned consumption before action reads and still executes after the last stack', () => {
  const f = fixture(),
    observed: number[] = []
  const tags = ['authored']
  const effect = compileEffect(
    defineEffect({
      id: 'test/auto-consume',
      on: 'OnBeforeCalculateDamage',
      consumesStacks: 1,
      tags,
      execute(ctx) {
        observed.push(ctx.read(targets.sourceMark.select(m => m.stack).first())!)
        contexts.damage.apply(ops.modifyDamage({ percent: 5, delta: 0 }))(ctx)
      },
    }),
  )
  tags.push('external')
  expect(effect.tags).toEqual(['authored'])
  const source = f.add('consume-source', [effect], 3)
  const first = new DamageContext(f.use, f.owner, f.b.activePet, 100)
  f.battle.applyEffects(first, EffectTrigger.OnBeforeCalculateDamage, source)
  expect(source.stack).toBe(2)
  source.stack = 1
  const last = new DamageContext(f.use, f.owner, f.b.activePet, 100)
  f.battle.applyEffects(last, EffectTrigger.OnBeforeCalculateDamage, source)
  expect(source.isActive).toBe(false)
  expect(f.owner.marks).not.toContain(source)
  expect(observed).toEqual([2, 0])
  expect(first.modified).toEqual([5, 0])
  expect(last.modified).toEqual([5, 0])
  f.battle.applyEffects(last, EffectTrigger.OnBeforeCalculateDamage, source)
  expect(observed).toEqual([2, 0])
})

it('queries nested heal contexts per action and reads both modifier inputs even when percent is missing', () => {
  const f = fixture(),
    trace: string[] = []
  let missing = false
  const percent = targets.ownerPet
    .where(() => {
      trace.push('percent')
      return !missing
    })
    .select(() => 20)
    .first()
  const delta = targets.ownerPet
    .select(() => {
      trace.push('delta')
      return 3
    })
    .first()
  const heal = new HealContext(f.ctx, f.skill, f.owner, 83)
  const nested = new EffectContext(heal, EffectTrigger.OnBeforeHeal, f.skill)
  const effect = compileEffect(
    defineEffect({
      id: 'test/heal-query',
      on: 'BeforeEffect',
      execute: contexts.heal.apply(ops.modifyHeal({ percent, delta })),
    }),
  )
  const ctx = new EffectContext(nested, EffectTrigger.BeforeEffect, f.skill)
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(ctx))
  missing = true
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(ctx))
  expect(heal.modified).toEqual([20, 3])
  expect(trace).toEqual(['percent', 'delta', 'percent', 'delta'])
})
it('probability conditions use one ordered battle draw, including certain outcomes, and short-circuit', () => {
  const f = fixture(),
    control = fixture(),
    observed: boolean[] = []
  const effect = compileEffect(
    defineEffect({
      id: 'test/probability',
      on: 'BeforeHit',
      execute(ctx) {
        observed.push(conditions.chance(0)(ctx), conditions.chance(100)(ctx))
        observed.push(conditions.all(() => false, conditions.chance(50))(ctx))
        observed.push(conditions.any(() => true, conditions.chance(50))(ctx))
      },
    }),
  )
  effect.innerApply(f.ctx)
  control.battle.random()
  control.battle.random()
  expect(f.battle.random()).toBe(control.battle.random())
  expect(observed).toEqual([false, true, false, true])
  expect(() => conditions.chance(NaN)).toThrow('finite probability')
})

it('rechecks damage and healing ownership after value callbacks mutate the selected array', () => {
  const f = fixture(),
    foreign = fixture()
  const ownDamage = new DamageContext(f.use, f.owner, f.b.activePet, 100)
  const otherDamage = new DamageContext(foreign.use, foreign.owner, foreign.b.activePet, 100)
  const ownHeal = new HealContext(f.ctx, f.skill, f.owner, 100)
  const otherHeal = new HealContext(foreign.ctx, foreign.skill, foreign.owner, 100)
  const damageTargets = [ownDamage],
    healTargets = [ownHeal]
  const damagePercent = targets.ownerPet
    .select(() => {
      damageTargets.push(otherDamage)
      return 25
    })
    .first()
  const healPercent = targets.ownerPet
    .select(() => {
      healTargets.push(otherHeal)
      return 25
    })
    .first()
  const effect = compileEffect(
    defineEffect({
      id: 'test/mutated-contexts',
      on: 'BeforeHit',
      execute(ctx) {
        expect(() => ops.modifyDamage({ percent: damagePercent, delta: 0 })(ctx, damageTargets)).toThrow(
          'Cross-battle damage context',
        )
        expect(() => ops.modifyHeal({ percent: healPercent, delta: 0 })(ctx, healTargets)).toThrow(
          'Cross-battle heal context',
        )
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(ownDamage.modified).toEqual([25, 0])
  expect(ownHeal.modified).toEqual([25, 0])
  expect(otherDamage.modified).toEqual([0, 0])
  expect(otherHeal.modified).toEqual([0, 0])
})

it('power operations read complete lists again for each target and preserve fractions and order', () => {
  const f = fixture()
  const other = new UseSkillContext(new TurnContext(f.battle), f.a, f.owner, AttackTargetOpinion.opponent, f.skill)
  let reads = 0
  const first = f.add('power-a', [], 2),
    second = f.add('power-b', [], 3)
  const amounts = targets.ownerMarks
    .where(mark => mark === first || mark === second)
    .select(mark => {
      if (mark === first) reads++
      return mark.stack + reads / 10
    })
    .all()
  f.use.power = 10
  other.power = 20
  const effect = compileEffect(
    defineEffect({
      id: 'test/power-values',
      on: 'BeforeHit',
      execute(ctx) {
        ops.addPower(amounts)(ctx, [f.use, other])
        ops.amplifyPower(1.25)(ctx, [f.use, other])
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(reads).toBe(2)
  expect(f.use.power).toBeCloseTo((10 + 2.1 + 3.1) * 1.25)
  expect(other.power).toBeCloseTo((20 + 2.2 + 3.2) * 1.25)
})
it('skill context queries resolve ancestry afresh while owner admission stays direct', () => {
  const f = fixture(),
    results: boolean[] = []
  const nested = new EffectContext(f.use, EffectTrigger.BeforeHit, f.skill)
  const effect = compileEffect(
    defineEffect({
      id: 'test/skill-context',
      on: 'BeforeEffect',
      execute(ctx) {
        results.push(conditions.ownerUsesSkill(ctx), conditions.selfUsesSkill(ctx))
        contexts.skillUse.apply(ops.addPower(4))(ctx)
      },
    }),
  )
  const ctx = new EffectContext(nested, EffectTrigger.BeforeEffect, f.skill)
  const initial = f.use.power
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(ctx))
  expect(results).toEqual([false, true])
  expect(f.use.power).toBe(initial + 4)
})
