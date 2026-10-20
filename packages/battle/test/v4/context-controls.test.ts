import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedContextControls,
  BaseMark,
  EffectContext,
  effectAuthoring,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  DamageContext,
  SkillPhase,
  Category,
  AttackTargetOpinion,
  IgnoreStageStrategy,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
type Id = keyof typeof generatedContextControls
const ids = Object.keys(generatedContextControls) as Id[]
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/context-controls-candidates.json', import.meta.url), 'utf8'),
)
function normalize(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(normalize)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
        )
      : v
}
const oracles = new Map(
  ids.map(id => {
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    const d = parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
      Number(r.sourcePath.slice(1))
    ]
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    if (d.apply.type !== 'preventDamage') {
      expect(() => EffectParser.parse(d)).not.toThrow()
      expect(d.apply.target).toBe('useSkillContext')
      d.apply.target = 'usingSkillContext'
      expect(r.recipe.repairedPaths).toEqual(['/apply/target'])
    } else expect(r.recipe.repairedPaths).toEqual([])
    return [id, EffectParser.parse(d)]
  }),
)
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
  for (const b of battles.splice(0)) await b.cleanup()
  expect(errors.splice(0)).toEqual([])
})
function setup(id: Id, native: boolean, kind: 'mark' | 'skill') {
  const f = makeScenario(3001)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) for (const skill of p.skills) skill.effects.splice(0)
  const pet = f.a.activePet,
    opponent = f.b.activePet,
    skill = pet.skills[0]
  const mark = new BaseMark('fixture/control' as baseMarkId, [], { ...f.debuff.config, duration: -1 }).createInstance()
  mark.setOwner(pet, f.battle.emitter)
  pet.marks.push(mark)
  const source = kind === 'mark' ? mark : skill
  const effect = native ? generatedContextControls[id] : oracles.get(id)!
  source.effects.push(effect)
  const use = new UseSkillContext(new TurnContext(f.battle), f.a, pet, AttackTargetOpinion.opponent, skill)
  use.updateActualTarget()
  const seed = new BaseMark('mark_kuihuazhongzi' as baseMarkId, [], {
    ...f.debuff.config,
    duration: -1,
  }).createInstance()
  seed.setOwner(opponent, f.battle.emitter)
  opponent.marks.push(seed)
  return { ...f, pet, opponent, source, use, effect, seed, mark }
}
const variants = [
  'normal',
  'wrong-owner',
  'missing-mark',
  'quarter',
  'above-quarter',
  'below-quarter',
  'late-owner',
  'repeat',
] as const
function run(id: Id, native: boolean, kind: 'mark' | 'skill', variant: (typeof variants)[number], amount: number) {
  const f = setup(id, native, kind)
  if (variant === 'wrong-owner') f.source.setOwner(f.opponent, f.battle.emitter)
  if (variant === 'missing-mark') f.opponent.marks.splice(f.opponent.marks.indexOf(f.seed), 1)
  const boundary = Math.floor(f.pet.stat.maxHp * 0.25)
  if (variant.includes('quarter'))
    f.pet.currentHp = boundary + (variant === 'above-quarter' ? 1 : variant === 'below-quarter' ? -1 : 0)
  const damage = new DamageContext(f.use, f.opponent, f.pet, amount)
  damage.damageResult = amount
  const fire = () => {
    if (id === 'effect_mark_prevent_damage')
      f.battle.applyEffects(damage, EffectTrigger.OnBeforeCalculateDamage, f.source)
    else if (id === 'effect_block_damage_under_60') f.battle.applyEffects(damage, EffectTrigger.OnDamage, f.source)
    else if (id === 'effect_mark_confuse') f.battle.applyEffects(f.use, EffectTrigger.AfterUseSkillCheck, f.source)
    else f.battle.applyEffects(f.use, EffectTrigger.BeforeHit, f.source)
  }
  const read = () => [damage.available, f.use.actualTarget === f.pet ? 'self' : 'opponent', f.use.ignoreStageStrategy]
  fire()
  const trace = [read()]
  if (variant === 'late-owner') {
    f.source.setOwner(f.opponent, f.battle.emitter)
    f.use.actualTarget = f.opponent
    f.use.ignoreStageStrategy = IgnoreStageStrategy.none
    damage.available = true
    fire()
    trace.push(read())
  }
  if (variant === 'repeat') {
    fire()
    trace.push(read())
  }
  return trace
}
for (const id of ids)
  for (const kind of ['mark', 'skill'] as const)
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => {
        for (const amount of [59, 60, 61])
          expect(run(id, true, kind, variant, amount)).toEqual(run(id, false, kind, variant, amount))
      })
it('independently checks strict HP and inclusive damage thresholds and self redirection', () => {
  expect(run('effect_block_damage_under_60', true, 'mark', 'normal', 60)[0][0]).toBe(false)
  expect(run('effect_block_damage_under_60', true, 'mark', 'normal', 61)[0][0]).toBe(true)
  expect(run('effect_mark_confuse', true, 'mark', 'normal', 60)[0][1]).toBe('self')
  const id = 'effect_skill_ignore_opponent_stat_if_hp_above_quarter'
  expect(run(id, true, 'skill', 'quarter', 60)[0][2]).toBe('none')
  expect(run(id, true, 'skill', 'above-quarter', 60)[0][2]).toBe('positive')
})
it.each([Category.Physical, Category.Special])(
  'stage-ignore changes subsequent damage calculation for %s',
  category => {
    const run = (native: boolean) => {
      const f = setup('effect_skill_ignore_stat_opponent_has_mark_kuihuazhongzi', native, 'skill')
      f.use.category = category
      f.use.power = 100
      f.opponent.attributeSystem.updateBaseValue('def', 999)
      f.opponent.attributeSystem.updateBaseValue('spd', 777)
      f.use.updateDamageResult()
      const before = f.use.baseDamage
      f.battle.applyEffects(f.use, EffectTrigger.BeforeHit, f.source)
      f.use.updateDamageResult()
      expect(f.use.baseDamage).toBeGreaterThan(before)
      return [before, f.use.baseDamage]
    }
    expect(run(true)).toEqual(run(false))
  },
)

it('reads redirection once for all selected contexts and requeries after a position changes', () => {
  const f = setup('effect_mark_confuse', true, 'mark')
  const second = new UseSkillContext(
    new TurnContext(f.battle),
    f.a,
    f.pet,
    AttackTargetOpinion.opponent,
    f.pet.skills[0],
  )
  second.updateActualTarget()
  const { compileEffect, defineEffect, selectFrom, targets, ops } = effectAuthoring
  let reads = 0
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/control-read',
      on: 'BeforeHit',
      execute: selectFrom([f.use, second]).apply(
        ops.setActualTarget(
          targets.opponentActive.first().map(pet => {
            reads++
            return pet
          }),
        ),
      ),
    }),
  )
  const fire = () =>
    f.battle.executionBudget.run(0, () =>
      effect.innerApply(new EffectContext(f.use, EffectTrigger.BeforeHit, f.source)),
    )
  fire()
  expect(reads).toBe(1)
  expect(f.use.actualTarget).toBe(f.opponent)
  expect(second.actualTarget).toBe(f.opponent)
  f.b.activePet = f.b.team[1]
  fire()
  expect(reads).toBe(2)
  expect(f.use.actualTarget).toBe(f.b.team[1])
  expect(second.actualTarget).toBe(f.b.team[1])
})
it('rejects foreign skill contexts before reads and foreign target pets before writes', () => {
  const f = setup('effect_mark_confuse', true, 'mark'),
    other = setup('effect_mark_confuse', true, 'mark')
  const { compileEffect, defineEffect, selectFrom, targets, ops } = effectAuthoring
  let reads = 0
  const effect = compileEffect(
    defineEffect({
      id: 'fixture/control-context-guard',
      on: 'BeforeHit',
      execute: selectFrom([f.use, other.use]).apply(
        ops.setActualTarget(
          targets.ownerPet.first().map(pet => {
            reads++
            return pet
          }),
        ),
      ),
    }),
  )
  const fire = (e: typeof effect) =>
    f.battle.executionBudget.run(0, () => e.innerApply(new EffectContext(f.use, EffectTrigger.BeforeHit, f.source)))
  expect(() => fire(effect)).toThrow('Cross-battle skill context')
  expect(reads).toBe(0)
  const foreign = compileEffect(
    defineEffect({
      id: 'fixture/control-target-guard',
      on: 'BeforeHit',
      execute: selectFrom([f.use]).apply(ops.setActualTarget(selectFrom([other.pet]).first())),
    }),
  )
  expect(() => fire(foreign)).toThrow('Cross-battle or unowned write target')
  expect(f.use.actualTarget).toBe(f.opponent)
})

for (const id of ids)
  for (const category of [Category.Physical, Category.Special])
    it(`runs ${id} through the skill phase (${category})`, () => {
      const run = (native: boolean) => {
        const f = setup(id, native, 'mark')
        const defensive = id === 'effect_mark_prevent_damage' || id === 'effect_block_damage_under_60'
        if (defensive) {
          f.pet.marks.splice(f.pet.marks.indexOf(f.mark), 1)
          f.source.setOwner(f.opponent, f.battle.emitter)
          f.opponent.marks.push(f.mark)
        }
        f.use.category = category
        f.use.power = 20
        f.use.accuracy = 100
        f.a.currentRage = 100
        const before = [f.pet.currentHp, f.opponent.currentHp]
        const phase = new SkillPhase(
          f.battle,
          f.a,
          f.pet,
          AttackTargetOpinion.opponent,
          f.use.skill,
          new TurnContext(f.battle),
          f.use,
        )
        phase.initialize()
        phase.execute()
        const losses = [before[0] - f.pet.currentHp, before[1] - f.opponent.currentHp]
        if (id === 'effect_mark_prevent_damage') expect(losses).toEqual([0, 0])
        else if (id === 'effect_block_damage_under_60') {
          // OnDamage runs after HP mutation; unavailable does not roll the loss back.
          expect(losses[0]).toBe(0)
          expect(losses[1]).toBeGreaterThan(0)
          expect(losses[1]).toBeLessThanOrEqual(60)
        } else if (id === 'effect_mark_confuse') {
          expect(losses[0]).toBeGreaterThan(0)
          expect(losses[1]).toBe(0)
        } else {
          expect(losses[0]).toBe(0)
          expect(losses[1]).toBeGreaterThan(0)
          expect(f.use.ignoreStageStrategy).toBe('positive')
        }
        return [losses, f.use.ignoreStageStrategy, f.use.currentHitCount]
      }
      expect(run(true)).toEqual(run(false))
    })
