import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  SkillPhase,
  AttackTargetOpinion,
  PhaseType,
  SynchronousPhase,
  GameRng,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import {
  createRandomTemporaryEffect,
  randomTemporaryEffectDependencies,
  createGeneratedMarkApplications,
  createGeneratedCompoundActions,
  generatedSkillNumericReferences,
} from '@arcadia-eternity/data-pack-base/native'

const load = (name: string) =>
  parse(readFileSync(new URL(`../../../../packs/base/data/${name}.yaml`, import.meta.url), 'utf8'), { merge: true })
const definitions = load('effect_skill') as { id: string }[]
const id = 'effect_skill_random_xifa_effect'
const original = definitions.find(d => d.id === id)!
const markDefs = ['mark', 'mark_global', 'mark_ability', 'mark_emblem'].flatMap(load) as { id: string }[]
const marks = new Map(markDefs.map(d => [d.id, MarkParser.parse({ ...d, effect: [] })]))
const nativeEffects = {
  ...createGeneratedMarkApplications(marks),
  ...createGeneratedCompoundActions(marks),
  ...generatedSkillNumericReferences,
}
const dependencies = new Map(
  randomTemporaryEffectDependencies.map(id => [id, nativeEffects[id as keyof typeof nativeEffects]]),
)
const factoryInput = new Map(dependencies)
const candidate = createRandomTemporaryEffect(factoryInput)
factoryInput.clear() // The candidate retains its validated choices, not this mutable registry.
const oracle = EffectParser.parse(original)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
class TestTurn extends SynchronousPhase<TurnContext> {
  phaseType = PhaseType.Turn
  constructor(
    battle: Battle,
    private run: () => void,
  ) {
    super(battle)
  }
  protected createContext() {
    return new TurnContext(this.battle)
  }
  protected executeOperation() {
    this.run()
  }
}
const seeds = [0, 1, 2, 3].map(choice => {
  for (let seed = 1; seed < 1000; seed++) if (new GameRng(seed).shuffle([0, 1, 2, 3])[0] === choice) return seed
  throw new Error('Missing seed')
})
const variants = ['normal', 'repeat', 'healthy', 'other-actor', 'no-phase', 'cancel', 'redispatch'] as const
function run(native: boolean, kind: 'skill' | 'mark', seed: number, variant: (typeof variants)[number]) {
  const f = makeScenario(seed),
    { battle, a, b, debuff } = f
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    p.marks.splice(0)
    for (const s of p.skills) s.effects.splice(0)
  }
  if (native)
    for (const effect of dependencies.values()) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  const skill = a.activePet.skills[0]
  let source: typeof skill | (typeof a.activePet.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/xifa-source' as baseMarkId, [], debuff.config).createInstance()
    source.owner = a.activePet
    a.activePet.marks.push(source)
  }
  source.effects.push(native ? candidate : oracle)
  if (variant !== 'healthy') a.activePet.currentHp = Math.max(1, Math.floor(a.activePet.stat.maxHp / 8))
  const repo = DataRepository.getInstance()
  const previousEffects = randomTemporaryEffectDependencies.map(id => repo.effects.get(id))
  const previousMarks = [...marks.keys()].map(id => repo.marks.get(id))
  for (const [key, mark] of marks) repo.marks.set(key, mark)
  for (const key of randomTemporaryEffectDependencies)
    repo.effects.set(key, native ? dependencies.get(key)! : EffectParser.parse(definitions.find(d => d.id === key)!))
  if (variant === 'cancel')
    b.activePet.skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/xifa-cancel' as effectId,
        triggers: [EffectTrigger.BeforeEffect],
        when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
        apply: ctx => {
          if (ctx.parent instanceof EffectContext) ctx.parent.available = false
        },
      }),
    )
  const observations: { selected: string[]; priority: number; marks: { pet: number; id: string; stack: number }[] }[] =
    []
  try {
    for (let turn = 0; turn < (variant === 'repeat' ? 2 : 1); turn++) {
      const action = () => {
        const use = new UseSkillContext(
          new TurnContext(battle),
          a,
          variant === 'other-actor' ? a.team[1] : a.activePet,
          AttackTargetOpinion.opponent,
          skill,
        )
        use.updateActualTarget()
        const priority = use.priority
        battle.applyEffects(use, EffectTrigger.BeforeSort, source)
        const selected = [...skill.getEffects(EffectTrigger.OnHit), ...skill.getEffects(EffectTrigger.BeforeSort)]
          .filter(e => e.id !== id)
          .map(e => e.id)
        expect(use.priority).toBe(priority)
        if (variant === 'redispatch') battle.applyEffects(use, EffectTrigger.BeforeSort, source)
        if (variant !== 'other-actor') {
          a.currentRage = a.maxRage
          use.hitOverrides.push({ willHit: true, priority: 1000 })
          use.critOverrides.push({ willCrit: false, priority: 1000 })
          const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, use.parent, use)
          battle.phaseManager.registerPhase(phase)
          battle.phaseManager.executePhase(phase.id)
        }
        observations.push({
          selected,
          priority: use.priority - priority,
          marks: [...a.team, ...b.team].flatMap((pet, i) =>
            pet.marks
              .filter(m => m.baseId !== 'fixture/xifa-source')
              .map(m => ({ pet: i, id: m.baseId, stack: m.stack })),
          ),
        })
      }
      if (variant === 'no-phase') action()
      else {
        const phase = new TestTurn(battle, action)
        battle.phaseManager.registerPhase(phase)
        battle.phaseManager.executePhase(phase.id)
      }
      expect(skill.getEffects(EffectTrigger.OnHit)).toEqual([])
      expect(skill.getEffects(EffectTrigger.BeforeSort)).toEqual(kind === 'skill' ? [native ? candidate : oracle] : [])
    }
    return { observations, next: battle.random() }
  } finally {
    randomTemporaryEffectDependencies.forEach((id, i) => {
      const value = previousEffects[i]
      if (value) repo.effects.set(id, value)
      else repo.effects.delete(id)
    })
    ;[...marks.keys()].forEach((id, i) => {
      const value = previousMarks[i]
      if (value) repo.marks.set(id, value)
      else repo.marks.delete(id)
    })
  }
}
for (const [choice, seed] of seeds.entries())
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`xifa choice=${choice} ${kind} ${variant}`, () => {
        const actual = run(true, kind, seed, variant)
        expect(actual).toEqual(run(false, kind, seed, variant))
        if (variant === 'normal' && kind === 'skill') {
          expect(actual.observations[0].selected).toEqual([randomTemporaryEffectDependencies[choice]])
          expect(actual.observations[0].priority).toBe(0)
          const expected = [
            [{ pet: 0, id: 'mark_shanbi', stack: 1 }],
            [
              { pet: 0, id: 'mark_shanghaizengjia', stack: 50 },
              { pet: 2, id: 'mark_shanghaizengjia', stack: 50 },
            ],
            [{ pet: 2, id: 'mark_mingzhongxiajiang', stack: 15 }],
            [],
          ][choice]
          expect(actual.observations[0].marks).toEqual(expected)
        }
      })
it('validates dependency identity', () => {
  expect(() => createRandomTemporaryEffect(new Map())).toThrow('Missing or mismatched')
  const wrong = new Map(dependencies)
  wrong.set(randomTemporaryEffectDependencies[0], dependencies.get(randomTemporaryEffectDependencies[1])!)
  expect(() => createRandomTemporaryEffect(wrong)).toThrow('Missing or mismatched')
})

it('outside any phase the native operator does not draw or add an effect', () => {
  const f = makeScenario(37)
  battles.push(f.battle)
  const skill = f.a.activePet.skills[0]
  const use = new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
  const before = skill.getEffects(EffectTrigger.OnHit)
  f.battle.executionBudget.run(0, () => candidate.innerApply(new EffectContext(use, EffectTrigger.BeforeSort, skill)))
  expect(skill.getEffects(EffectTrigger.OnHit)).toEqual(before)
  expect(f.battle.random()).toBe(new GameRng(37).next())
})
it('validates all native targets before writing any temporary effect', () => {
  const first = makeScenario(37),
    other = makeScenario(38)
  battles.push(first.battle, other.battle)
  const skill = first.a.activePet.skills[0],
    foreign = other.a.activePet.skills[0]
  const effect = effectAuthoring.compileEffect(
    effectAuthoring.defineEffect({
      id: 'fixture/cross-battle-temporary',
      on: 'BeforeHit',
      execute: effectAuthoring
        .selectFrom([skill, foreign])
        .apply(effectAuthoring.ops.addTemporaryEffect(dependencies.get(randomTemporaryEffectDependencies[0])!)),
    }),
  )
  const before = skill.getEffects(EffectTrigger.OnHit)
  const phase = new TestTurn(first.battle, () => {
    const use = new UseSkillContext(
      new TurnContext(first.battle),
      first.a,
      first.a.activePet,
      AttackTargetOpinion.opponent,
      skill,
    )
    expect(() => effect.innerApply(new EffectContext(use, EffectTrigger.BeforeHit, skill))).toThrow('Cross-battle')
    expect(skill.getEffects(EffectTrigger.OnHit)).toEqual(before)
    const literal = effectAuthoring.compileEffect(
      effectAuthoring.defineEffect({
        id: 'fixture/literal-temporary',
        on: 'BeforeHit',
        execute: effectAuthoring.targets.sourceSkill.apply(
          effectAuthoring.ops.addTemporaryEffect(dependencies.get(randomTemporaryEffectDependencies[0])!),
        ),
      }),
    )
    literal.innerApply(new EffectContext(use, EffectTrigger.BeforeHit, skill))
    expect(skill.getEffects(EffectTrigger.OnHit)).toEqual([
      ...before,
      dependencies.get(randomTemporaryEffectDependencies[0])!,
    ])
  })
  first.battle.phaseManager.registerPhase(phase)
  first.battle.phaseManager.executePhase(phase.id)
})
