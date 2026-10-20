import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AddMarkContext,
  BaseMark,
  DamageContext,
  HealContext,
  RageContext,
  Signal,
  GameRng,
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
  SwitchPetContext,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '../../v4'
import { makeScenario } from '../../test/v4/scenario'
import {
  compileEffect,
  selectFrom,
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

it('opponent mark queries follow the direct skill target and requery after target changes', () => {
  const f = fixture()
  const marks = [f.owner, f.b.activePet, f.b.team[1]].map((pet, index) => {
    const mark = new BaseMark(`target-${index}` as baseMarkId, []).createInstance({ stack: index + 1 })
    mark.owner = pet
    pet.marks.push(mark)
    return mark
  })
  const amounts = targets.opponentMarks.select(mark => mark.stack).all()
  const results: (readonly number[])[] = []
  const effect = compileEffect(
    defineEffect({
      id: 'test/opponent-mark-target',
      on: ['BeforeHit', 'BeforeEffect'],
      execute(ctx) {
        results.push(ctx.read(amounts))
        f.use.actualTarget = f.b.team[1]
        marks[2].stack = 5
        results.push(ctx.read(amounts))
      },
    }),
  )
  f.use.actualTarget = f.owner
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(results).toEqual([[1], [5]])
  const nested = new EffectContext(f.ctx, EffectTrigger.BeforeEffect, f.skill)
  results.length = 0
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(nested))
  expect(results).toEqual([[2], [2]])
})

it('skill-order and periodic conditions keep direct ancestry, queue order and ownership', () => {
  const f = fixture()
  const turn = f.use.parent
  const other = new UseSkillContext(turn, f.b, f.b.activePet, AttackTargetOpinion.opponent, f.b.activePet.skills[0])
  const answers: boolean[][] = []
  const everySecond = conditions.everyNthUse(2)
  const effect = compileEffect(
    defineEffect({
      id: 'test/skill-admission',
      on: ['BeforeHit', 'BeforeEffect'],
      execute(ctx) {
        answers.push([conditions.firstSkillThisTurn(ctx), conditions.lastSkillThisTurn(ctx), everySecond(ctx)])
      },
    }),
  )
  const read = (ctx = f.ctx) => f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(ctx))
  f.owner.lastSkillUsedTimes = 2
  read()
  turn.appledContexts.push(f.use, other)
  turn.contexts.push(other, f.use)
  read()
  turn.appledContexts.reverse()
  turn.contexts.reverse()
  f.owner.lastSkillUsedTimes = 3
  read()
  f.battle.executionBudget.run(f.battle.currentTurn, () =>
    effect.innerApply(new EffectContext(f.ctx, EffectTrigger.BeforeEffect, f.skill)),
  )
  f.owner.lastSkillUsedTimes = 0
  read()
  expect(answers).toEqual([
    [false, false, true],
    [true, false, true],
    [false, true, false],
    [false, false, false],
    [false, true, true],
  ])
  for (const invalid of [0, -1, 0.5, NaN, Infinity]) expect(() => conditions.everyNthUse(invalid)).toThrow()
})

it('player queries use the direct skill actor, requery ownership, then fall back in nested contexts', () => {
  const f = fixture()
  f.skill.setOwner(f.b.activePet)
  const players = targets.selfPlayer.first()
  const rounds = contexts.battle.select(battle => battle.currentTurn).first()
  const seen: unknown[] = []
  const effect = compileEffect(
    defineEffect({
      id: 'test/player-and-battle-queries',
      on: ['BeforeHit', 'BeforeEffect'],
      execute(ctx) {
        seen.push(ctx.read(players)?.id, ctx.read(rounds))
        f.owner.owner = f.b
        f.battle.currentTurn = 7
        seen.push(ctx.read(players)?.id, ctx.read(rounds))
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(seen).toEqual([f.a.id, 0, f.b.id, 7])
  seen.length = 0
  f.owner.owner = f.a
  f.battle.executionBudget.run(f.battle.currentTurn, () =>
    effect.innerApply(new EffectContext(f.ctx, EffectTrigger.BeforeEffect, f.skill)),
  )
  expect(seen).toEqual([f.b.id, 7, f.b.id, 7])
})

it('conditional power lists distinguish no branch from zero and read only the selected branch per action', () => {
  const f = fixture()
  let high = true
  let low = true
  const reads: string[] = []
  const writes: number[] = []
  const addPower = f.use.addPower.bind(f.use)
  f.use.addPower = amount => {
    writes.push(amount)
    addPower(amount)
  }
  const branch = (name: string, amount: number) =>
    targets.ownerPet
      .select(() => {
        reads.push(name)
        return amount
      })
      .all()
  const selected = values.choose(
    () => high,
    branch('high', 150),
    values.choose(
      () => {
        reads.push('low-condition')
        return low
      },
      branch('low', 50),
      [],
    ),
  )
  const effect = compileEffect(
    defineEffect({
      id: 'test/conditional-power-lists',
      on: 'BeforeHit',
      execute(ctx) {
        const apply = contexts.skillUse.apply(ops.addPower(selected))
        apply(ctx)
        high = false
        apply(ctx)
        low = false
        apply(ctx)
        contexts.skillUse.apply(ops.addPower(values.choose(() => true, [0], [])))(ctx)
      },
    }),
  )
  f.use.power = 83
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(reads).toEqual(['high', 'low-condition', 'low', 'low-condition'])
  expect(writes).toEqual([150, 50, 0])
  expect(f.use.power).toBe(283)
})

it('parameterized probability rereads at admission and keeps one draw for zero and certainty', () => {
  const f = fixture()
  const percent = numberParam({ default: 10, tags: ['skill_effect_probability'] })
  const outcomes: boolean[] = []
  let draws = 0
  f.battle.random = () => {
    draws++
    return 0.5
  }
  const effect = compileEffect(
    defineEffect({
      id: 'test/parameter-probability',
      on: 'BeforeHit',
      parameters: { percent },
      execute(ctx) {
        const chance = conditions.chance(percent)
        outcomes.push(chance(ctx))
        f.battle.configSystem.set(parameterAddress('test/parameter-probability', 'parameters', 'percent'), 100)
        outcomes.push(chance(ctx))
        f.battle.configSystem.set(parameterAddress('test/parameter-probability', 'parameters', 'percent'), 0)
        outcomes.push(chance(ctx))
        expect(() => conditions.chance(percent.map(() => Infinity))(ctx)).toThrow('finite probability')
      },
    }),
  )
  effectParameters(effect).install(f.battle.configSystem)
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(outcomes).toEqual([false, true, false])
  expect(draws).toBe(3)
})

it('mark application reads ordered inputs once per action and shares them across selected targets', () => {
  const f = fixture()
  const base = new BaseMark('test/ordered-mark' as baseMarkId, [], { ...f.debuff.config, maxStacks: 10 })
  let stack = 2
  let duration = 3
  const reads: string[] = []
  const markValue = targets.ownerPet
    .select(() => {
      reads.push('mark')
      return base
    })
    .first()
  const options = {
    stack: targets.ownerPet
      .select(() => {
        reads.push('stack')
        return stack
      })
      .first(),
    duration: targets.ownerPet
      .select(() => {
        reads.push('duration')
        return duration
      })
      .first(),
  }
  const apply = ops.addMark(markValue, options)
  options.stack = targets.ownerPet.select(() => 999).first()
  const effect = compileEffect(
    defineEffect({
      id: 'test/mark-read-order',
      on: 'BeforeHit',
      execute(ctx) {
        apply(ctx, [f.owner, f.b.activePet])
        stack = 4
        duration = 5
        apply(ctx, [f.a.team[1]])
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(reads).toEqual(['mark', 'stack', 'duration', 'mark', 'stack', 'duration'])
  expect(
    [f.owner, f.b.activePet, f.a.team[1]].map(pet => {
      const mark = pet.marks.find(mark => mark.base === base)!
      return [mark.stack, mark.duration]
    }),
  ).toEqual([
    [2, 3],
    [2, 3],
    [4, 5],
  ])
})

it('missing marks skip option reads; missing options use base defaults while explicit zero stays zero', () => {
  const f = fixture()
  const base = new BaseMark('test/default-mark' as baseMarkId, [], { ...f.debuff.config, maxStacks: 5, duration: 7 })
  const absent = targets.ownerMarks.where(() => false)
  const missingMark = absent.select(mark => mark.base).first()
  const missingNumber = absent.select(mark => mark.stack).first()
  const inputs: number[][] = []
  const add = f.owner.addMark.bind(f.owner)
  f.owner.addMark = context => {
    inputs.push([context.stack, context.duration])
    return add(context)
  }
  const effect = compileEffect(
    defineEffect({
      id: 'test/mark-defaults',
      on: 'BeforeHit',
      execute(ctx) {
        targets.ownerPet.apply(
          ops.addMark(missingMark, {
            stack: targets.ownerPet
              .select(() => {
                throw new Error('unselected option')
              })
              .first(),
          }),
        )(ctx)
        targets.ownerPet.apply(ops.addMark(base, { stack: missingNumber, duration: missingNumber }))(ctx)
        targets.ownerPet.apply(ops.addMark(base, { stack: 0, duration: 0 }))(ctx)
        contexts.battle.apply(ops.addMark(base))(ctx)
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(inputs).toEqual([
    [5, 7],
    [0, 0],
  ])
  expect(f.battle.marks.some(mark => mark.base === base)).toBe(true)
})

it('mark application rejects foreign targets before writes and rechecks ownership after value callbacks', () => {
  const f = fixture(),
    foreign = fixture()
  const base = new BaseMark('test/guarded-mark' as baseMarkId, [], f.debuff.config)
  let reads = 0
  const value = targets.ownerPet
    .select(() => {
      reads++
      return 2
    })
    .first()
  const effect = compileEffect(
    defineEffect({
      id: 'test/mark-ownership',
      on: 'BeforeHit',
      execute(ctx) {
        expect(() => ops.addMark(base, { stack: value })(ctx, [f.owner, foreign.owner])).toThrow('Cross-battle')
        expect(reads).toBe(0)
        const move = targets.ownerPet
          .select(() => {
            f.owner.owner = foreign.a
            return 2
          })
          .first()
        try {
          expect(() => ops.addMark(base, { stack: move })(ctx, [f.owner])).toThrow('Cross-battle')
        } finally {
          f.owner.owner = f.a
        }
        expect(() => ops.addMark(base, { duration: Infinity })(ctx, [f.owner])).toThrow('finite numeric')
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(f.owner.marks.some(mark => mark.base === base)).toBe(false)
  expect(foreign.owner.marks.some(mark => mark.base === base)).toBe(false)
})

it('later mark actions requery owner and numeric sources after a creation hook moves the effect source', () => {
  const f = fixture()
  f.owner.currentHp = 3
  f.a.team[1].currentHp = 5
  const first = new BaseMark(
    'test/first-requery-mark' as baseMarkId,
    [
      new Effect<EffectTrigger>(
        'test/move-mark-source' as effectId,
        [EffectTrigger.OnMarkCreated],
        () => {
          f.skill.owner = f.a.team[1]
        },
        0,
      ),
    ],
    { ...f.debuff.config, maxStacks: 10 },
  )
  const second = new BaseMark('test/second-requery-mark' as baseMarkId, [], { ...f.debuff.config, maxStacks: 10 })
  const stack = targets.ownerPet.select(pet => pet.currentHp).first()
  const effect = compileEffect(
    defineEffect({
      id: 'test/mark-requery',
      on: 'BeforeHit',
      execute: actions.sequence(
        targets.ownerPet.apply(ops.addMark(first, { stack })),
        targets.ownerPet.apply(ops.addMark(second, { stack })),
      ),
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(f.owner.marks.find(mark => mark.base === first)?.stack).toBe(3)
  expect(f.owner.marks.some(mark => mark.base === second)).toBe(false)
  expect(f.a.team[1].marks.find(mark => mark.base === second)?.stack).toBe(5)
})

it('mark creation hooks cannot move a later selected target into another battle before its write', () => {
  const f = fixture(),
    foreign = fixture()
  const later = f.b.activePet
  const base = new BaseMark(
    'test/mark-hook-guard' as baseMarkId,
    [
      new Effect<EffectTrigger>(
        'test/move-later-owner' as effectId,
        [EffectTrigger.OnMarkCreated],
        () => {
          later.owner = foreign.a
        },
        0,
      ),
    ],
    f.debuff.config,
  )
  const effect = compileEffect(
    defineEffect({
      id: 'test/mark-hook-ownership',
      on: 'BeforeHit',
      execute(ctx) {
        try {
          expect(() => ops.addMark(base)(ctx, [f.owner, later])).toThrow('Cross-battle')
        } finally {
          later.owner = f.b
        }
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(f.owner.marks.some(mark => mark.base === base)).toBe(true)
  expect(later.marks.some(mark => mark.base === base)).toBe(false)
})

it('flatMap requeries membership and preserves ordered snapshots through later operations', () => {
  const f = fixture()
  const first = new BaseMark('test/field-first' as baseMarkId, []).createInstance({ stack: 2 })
  const second = new BaseMark('test/field-second' as baseMarkId, []).createInstance({ stack: 7 })
  first.owner = f.battle
  second.owner = f.battle
  f.battle.marks.push(first, second)
  const members = contexts.battle.flatMap(battle => battle.marks)
  const stacks = members
    .where(mark => mark.stack > 1)
    .flatMap(mark => [mark.stack, mark.stack + 1])
    .all()
  const results: (readonly number[])[] = []
  const effect = compileEffect(
    defineEffect({
      id: 'test/flatten-field-members',
      on: 'BeforeHit',
      execute(ctx) {
        results.push(ctx.read(stacks))
        f.battle.marks.splice(0, 1)
        second.stack = 11
        results.push(ctx.read(stacks))
        f.battle.marks.splice(0)
        results.push(ctx.read(stacks))
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(results).toEqual([[2, 3, 7, 8], [11, 12], []])
})

it('entry predicates distinguish the direct incoming pet from the current active position', () => {
  const f = fixture()
  const incoming = f.a.team[1]
  const switchContext = new SwitchPetContext(new TurnContext(f.battle), f.a, incoming)
  const skill = incoming.skills[0]
  const direct = new EffectContext(switchContext, EffectTrigger.OnSwitchIn, skill)
  const nested = new EffectContext(direct, EffectTrigger.BeforeEffect, skill)
  const entry = compileEffect(
    defineEffect({
      id: 'test/direct-entry',
      on: ['OnSwitchIn', 'BeforeEffect'],
      when: conditions.ownerSwitchesIn,
      execute() {},
    }),
  )
  expect(entry.condition!(direct)).toBe(true)
  expect(entry.condition!(nested)).toBe(false)
  const active = compileEffect(
    defineEffect({ id: 'test/current-active', on: 'OnSwitchIn', when: conditions.ownerIsActive, execute() {} }),
  )
  expect(active.condition!(direct)).toBe(false)
  f.a.activePet = incoming
  expect(active.condition!(direct)).toBe(true)
  skill.owner = f.b.activePet
  expect(entry.condition!(direct)).toBe(false)
  expect(active.condition!(direct)).toBe(true)
})

it('target admission uses the direct skill actual target and follows it between evaluations', () => {
  const f = fixture()
  const effect = compileEffect(
    defineEffect({
      id: 'test/target-admission',
      on: ['OnMiss', 'BeforeEffect'],
      when: conditions.ownerIsSkillTarget,
      execute() {},
    }),
  )
  const direct = new EffectContext(f.use, EffectTrigger.OnMiss, f.skill)
  f.use.actualTarget = f.owner
  expect(effect.condition!(direct)).toBe(true)
  expect(effect.condition!(new EffectContext(direct, EffectTrigger.BeforeEffect, f.skill))).toBe(false)
  f.use.actualTarget = f.b.activePet
  expect(effect.condition!(direct)).toBe(false)
  f.skill.owner = f.b.activePet
  expect(effect.condition!(direct)).toBe(true)
})

it('target admission rejects non-pet sources when the actual target is missing', () => {
  const f = fixture()
  const mark = new BaseMark('test/non-pet-target-source' as baseMarkId, []).createInstance()
  const effect = compileEffect(
    defineEffect({ id: 'test/missing-actual-target', on: 'OnMiss', when: conditions.ownerIsSkillTarget, execute() {} }),
  )
  f.use.actualTarget = undefined
  for (const owner of [f.battle, null, f.owner]) {
    mark.owner = owner
    expect(effect.condition!(new EffectContext(f.use, EffectTrigger.OnMiss, mark))).toBe(false)
  }
  f.skill.owner = null
  expect(effect.condition!(new EffectContext(f.use, EffectTrigger.OnMiss, f.skill))).toBe(false)
})

it('random selectors fully shuffle on every use and preserve fixed membership and input order', () => {
  const f = fixture()
  const input = [1, 2, 3, 4]
  const query = selectFrom(input).shuffled()
  input.push(5)
  const expected = new GameRng(201)
  const results: unknown[] = []
  const effect = compileEffect(
    defineEffect({
      id: 'test/random-selector',
      on: 'BeforeHit',
      execute(ctx) {
        results.push(ctx.read(query.all()))
        results.push(ctx.read(query.where(n => n > 2).first()))
        results.push(ctx.read(selectFrom<number>([]).shuffled().first()))
        results.push(ctx.read(selectFrom([9]).shuffled().first()))
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(results).toEqual([
    expected.shuffle([1, 2, 3, 4]),
    expected.shuffle([1, 2, 3, 4]).find(n => n > 2),
    undefined,
    9,
  ])
  expect(input).toEqual([1, 2, 3, 4, 5])
  expect(f.battle.random()).toBe(expected.next())
})

it('random selectors requery dynamic membership before shuffling', () => {
  const f = fixture()
  const query = targets.ownerMarks
    .shuffled()
    .select(mark => mark.baseId)
    .all()
  const first = f.add('test/random-first')
  const results: unknown[] = []
  const expected = new GameRng(201)
  const effect = compileEffect(
    defineEffect({
      id: 'test/random-membership',
      on: 'BeforeHit',
      execute(ctx) {
        results.push(ctx.read(query))
        f.add('test/random-second')
        results.push(ctx.read(query))
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  expect(results).toEqual([[first.baseId], expected.shuffle(['test/random-first', 'test/random-second'])])
  expect(f.battle.random()).toBe(expected.next())
})

it.each(['capture', 'follow'] as const)(
  'random queries reject persistent %s evaluation without consuming RNG',
  mode => {
    const f = fixture()
    const mark = f.add('test/random-binding')
    const speed = f.owner.stat.spe
    const query = selectFrom([1, 2, 3]).shuffled().first()
    const plan =
      mode === 'capture' ? query.capture({ key: 'random', scope: 'binding' }) : query.follow({ key: 'random' })
    const effect = penalty(plan, `test/random-${mode}`)
    const ctx = new EffectContext(new AddMarkContext(f.ctx, f.owner, mark.base), EffectTrigger.OnMarkCreated, mark)
    expect(() => f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(ctx))).toThrow(
      'Persistent queries',
    )
    expect(f.owner.stat.spe).toBe(speed)
    expect(f.battle.random()).toBe(new GameRng(201).next())
  },
)

it('switch queries requery nearest context while the outgoing predicate requires the direct event', () => {
  const f = fixture()
  const event = new SwitchPetContext(new TurnContext(f.battle), f.a, f.a.team[1])
  const direct = new EffectContext(event, EffectTrigger.OnSwitchOut, f.skill)
  const nested = new EffectContext(direct, EffectTrigger.BeforeEffect, f.skill)
  const predicate = compileEffect(
    defineEffect({
      id: 'test/outgoing',
      on: ['OnSwitchOut', 'BeforeEffect'],
      when: conditions.ownerSwitchesOut,
      execute() {},
    }),
  )
  expect(predicate.condition!(direct)).toBe(true)
  expect(predicate.condition!(nested)).toBe(false)
  event.switchOutPet = null
  expect(predicate.condition!(direct)).toBe(false)
  const results: unknown[] = []
  const target = contexts.switchPet.select(ctx => ctx.switchInPet).first()
  const effect = compileEffect(
    defineEffect({
      id: 'test/switch-target-query',
      on: 'BeforeEffect',
      execute(ctx) {
        results.push(ctx.read(target)?.id)
        event.switchInPet = f.owner
        results.push(ctx.read(target)?.id)
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(nested))
  expect(results).toEqual(['A/reserve', 'A/lead'])
})

it('opponent player requery uses the direct target and source fallback in nested contexts', () => {
  const f = fixture()
  f.use.updateActualTarget()
  const query = targets.opponentPlayer.first()
  const seen: unknown[] = []
  const effect = compileEffect(
    defineEffect({
      id: 'test/opponent-player-query',
      on: ['BeforeHit', 'BeforeEffect'],
      execute(ctx) {
        seen.push(ctx.read(query)?.id)
        f.use.actualTarget = f.a.activePet
        seen.push(ctx.read(query)?.id)
        f.skill.setOwner(f.b.activePet)
        seen.push(ctx.read(query)?.id)
      },
    }),
  )
  f.battle.executionBudget.run(0, () => effect.innerApply(f.ctx))
  expect(seen).toEqual([f.b.id, f.a.id, f.a.id])
  seen.length = 0
  f.use.actualTarget = f.b.activePet
  f.battle.executionBudget.run(0, () =>
    effect.innerApply(new EffectContext(f.ctx, EffectTrigger.BeforeEffect, f.skill)),
  )
  expect(seen).toEqual([f.a.id, f.a.id, f.a.id])
})

it.each(['capture', 'follow'] as const)('%s opponent rage keeps the explicit timing policy', mode => {
  const f = fixture()
  f.b.currentRage = 80
  const query = targets.opponentPlayer.select(player => player.currentRage).first()
  const plan =
    mode === 'capture'
      ? query.capture({ key: 'opponent-rage', scope: 'binding' })
      : query.follow({ key: 'opponent-rage' })
  const initial = f.owner.stat.spe
  f.add('test/rage-speed', [penalty(plan.map(n => -n))])
  expect(f.owner.stat.spe).toBe(initial - 80)
  f.b.currentRage = 30
  expect(f.owner.stat.spe).toBe(initial - (mode === 'capture' ? 80 : 30))
})

it('persistent self-player and opponent-mark queries use source identity without a trigger event', () => {
  const f = fixture()
  f.a.currentRage = 20
  const ownRage = targets.selfPlayer
    .select(player => player.currentRage)
    .first()
    .follow({ key: 'own-rage' })
  f.add('test/own-rage-speed', [
    penalty(
      ownRage.map(n => -n),
      'own-rage-penalty',
    ),
  ])
  const initial = f.owner.stat.spe
  f.a.currentRage = 30
  expect(f.owner.stat.spe).toBe(initial - 10)
  const count = targets.opponentMarks
    .all()
    .map(marks => marks.length)
    .follow({ key: 'opponent-mark-count' })
  const before = f.owner.stat.spe
  f.add('test/opponent-mark-count', [
    penalty(
      count.map(n => -n),
      'mark-count-penalty',
    ),
  ])
  const base = new BaseMark('test/opponent-support' as baseMarkId, [], f.debuff.config)
  f.battle.addMark(new AddMarkContext(f.ctx, f.b.activePet, base))
  expect(f.owner.stat.spe).toBe(before - 1)
})

it.each([false, true])('conditional checkSelf uses the direct event subject, nested=%s', nested => {
  const f = fixture()
  f.use.updateActualTarget()
  const answers: number[] = []
  const effect = compileEffect(
    defineEffect({
      id: 'test/conditional-event-owner',
      on: ['PostDamage', 'BeforeEffect'],
      execute(ctx) {
        answers.push(ctx.read(values.choose(conditions.sourceOwnsEvent, 10, 20)))
      },
    }),
  )
  for (const matches of [false, true]) {
    const damage = new DamageContext(f.use, f.owner, matches ? f.owner : f.b.activePet, 100)
    const event = nested
      ? new EffectContext(
          new EffectContext(damage, EffectTrigger.OnDamage, matches ? f.skill : f.b.activePet.skills[0]),
          EffectTrigger.BeforeEffect,
          f.skill,
        )
      : new EffectContext(damage, EffectTrigger.PostDamage, f.skill)
    f.battle.executionBudget.run(0, () => effect.innerApply(event))
  }
  expect(answers).toEqual([20, 10])
})

it('inclusive random values read afresh, include both endpoints and consume one draw even for a singleton', () => {
  const f = fixture(),
    expected = new GameRng(201)
  const query = values.randomInt(30, 70),
    samples: number[] = []
  const effect = compileEffect(
    defineEffect({
      id: 'test/random-int',
      on: 'BeforeHit',
      execute(ctx) {
        for (let i = 0; i < 400; i++) samples.push(ctx.read(query))
        samples.push(ctx.read(values.randomInt(7, 7)))
      },
    }),
  )
  f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(f.ctx))
  const independent = Array.from({ length: 400 }, () => Math.floor(expected.next() * 41) + 30)
  expected.next()
  expect(samples).toEqual([...independent, 7])
  expect(samples).toContain(30)
  expect(samples).toContain(70)
  expect(f.battle.random()).toBe(expected.next())
})
for (const [min, max] of [
  [NaN, 2],
  [0, Infinity],
  [0.5, 2],
  [3, 2],
  [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
])
  it(`random values reject invalid bounds ${min}/${max} at declaration`, () => {
    expect(() => values.randomInt(min, max)).toThrow('Invalid random integer range')
  })
it.each(['capture', 'follow'] as const)('random integer values reject persistent %s without consuming RNG', mode => {
  const f = fixture(),
    mark = f.add('test/random-integer-binding'),
    speed = f.owner.stat.spe
  const query = values.randomInt(30, 70)
  const plan =
    mode === 'capture' ? query.capture({ key: 'random-int', scope: 'binding' }) : query.follow({ key: 'random-int' })
  const effect = penalty(plan, `test/random-int-${mode}`)
  const ctx = new EffectContext(new AddMarkContext(f.ctx, f.owner, mark.base), EffectTrigger.OnMarkCreated, mark)
  expect(() => f.battle.executionBudget.run(f.battle.currentTurn, () => effect.innerApply(ctx))).toThrow(
    'Persistent queries',
  )
  expect(f.owner.stat.spe).toBe(speed)
  expect(f.battle.random()).toBe(new GameRng(201).next())
})

it('rage modifiers query ancestry afresh and read both inputs in order even when one is missing', () => {
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
  const rage = new RageContext(f.use, f.a, 'damage', 'add', 19)
  const nested = new EffectContext(rage, EffectTrigger.OnRageGain, f.skill)
  const effect = compileEffect(
    defineEffect({
      id: 'test/rage-query',
      on: 'BeforeEffect',
      execute: contexts.rage.apply(ops.modifyRage({ percent, delta })),
    }),
  )
  const ctx = new EffectContext(nested, EffectTrigger.BeforeEffect, f.skill)
  f.battle.executionBudget.run(0, () => effect.innerApply(ctx))
  missing = true
  f.battle.executionBudget.run(0, () => effect.innerApply(ctx))
  expect(rage.modified).toEqual([20, 3])
  expect(trace).toEqual(['percent', 'delta', 'percent', 'delta'])
})
it('rage modifiers reject foreign contexts before reading either amount', () => {
  const f = fixture(),
    other = fixture()
  let reads = 0
  const amount = targets.ownerPet
    .select(() => {
      reads++
      return 5
    })
    .first()
  const foreign = new RageContext(other.use, other.a, 'damage', 'add', 19)
  const effect = compileEffect(
    defineEffect({
      id: 'test/rage-cross-battle',
      on: 'BeforeHit',
      execute: selectFrom([foreign]).apply(ops.modifyRage({ percent: amount, delta: amount })),
    }),
  )
  expect(() => f.battle.executionBudget.run(0, () => effect.innerApply(f.ctx))).toThrow('Cross-battle rage context')
  expect(reads).toBe(0)
  expect(foreign.modified).toEqual([0, 0])
})
it('skill instance flags read once per application, can clear, and skip missing values', () => {
  const f = fixture()
  const bases = f.owner.skills.map(s => s.base.sureHit)
  let reads = 0
  let flag: boolean | undefined = true
  const input = targets.ownerPet
    .where(() => {
      reads++
      return flag !== undefined
    })
    .select(() => flag ?? false)
    .first()
  const effect = compileEffect(
    defineEffect({
      id: 'test/skill-flags',
      on: 'BeforeHit',
      execute: targets.selfSkills.apply(ops.setSkillSureHit(input)),
    }),
  )
  const apply = () => f.battle.executionBudget.run(0, () => effect.innerApply(f.ctx))
  apply()
  expect(reads).toBe(1)
  expect(f.owner.skills.every(s => s.sureHit)).toBe(true)
  flag = undefined
  apply()
  expect(f.owner.skills.every(s => s.sureHit)).toBe(true)
  flag = false
  apply()
  expect(reads).toBe(3)
  expect(f.owner.skills.every(s => !s.sureHit)).toBe(true)
  expect(f.owner.skills.map(s => s.base.sureHit)).toEqual(bases)
})
it('skill instance assignments reject foreign targets before reads and recheck after reads', () => {
  const f = fixture(),
    other = fixture()
  let reads = 0
  f.skill.sureHit = false
  const input = targets.ownerPet
    .select(() => {
      reads++
      f.skill.setOwner(other.owner)
      return true
    })
    .first()
  const make = (skill: typeof f.skill) =>
    compileEffect(
      defineEffect({
        id: 'test/skill-flags-boundary',
        on: 'BeforeHit',
        execute: selectFrom([skill]).apply(ops.setSkillSureHit(input)),
      }),
    )
  expect(() => f.battle.executionBudget.run(0, () => make(other.skill).innerApply(f.ctx))).toThrow()
  expect(reads).toBe(0)
  expect(() => f.battle.executionBudget.run(0, () => make(f.skill).innerApply(f.ctx))).toThrow()
  expect(reads).toBe(1)
  expect(f.skill.sureHit).toBe(false)
})
