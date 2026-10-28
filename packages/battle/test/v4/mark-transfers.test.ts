import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  StatLevelMarkInstanceImpl,
  StatTypeWithoutHp,
  StackStrategy,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createMarkTransfers } from '@arcadia-eternity/data-pack-base/native'

const candidates = createMarkTransfers()
const definitions = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
).concat(
  parse(readFileSync(new URL('./fixtures/effect-regression/effect_mark.yaml', import.meta.url), 'utf8'), {
    merge: true,
  }),
) as { id: string }[]
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'existing',
  'repeat',
  'cancel-effect',
  'cancel-stage',
  'wrong-owner',
  'nested',
  'late-slot',
  'mutate-next-stage',
  'suppressed',
] as const
function run(id: keyof typeof candidates, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const f = makeScenario(241),
    { battle, a, b, debuff } = f
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    p.marks.splice(0)
    for (const s of p.skills) s.effects.splice(0)
  }
  const defensive = id.startsWith('effect_mark'),
    stages = id.includes('debuff_stage')
  const owner = defensive ? b.activePet : a.activePet,
    recipient = defensive ? a : b
  const pets = [...a.team, ...b.team]
  const base = new BaseMark(
    'fixture/status' as baseMarkId,
    [],
    { ...debuff.config, stackable: true, stackStrategy: StackStrategy.stack, maxStacks: 20, duration: 5 },
    ['status'],
  )
  const sourceMark = base.createInstance()
  sourceMark.setOwner(owner, battle.emitter)
  sourceMark.stack = 2
  owner.marks.push(sourceMark)
  const source = kind === 'skill' ? owner.skills[0] : sourceMark
  const skill = a.activePet.skills[0]
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
  use.updateActualTarget()
  const ctx = new EffectContext(use, EffectTrigger.OnHit, source)
  if (stages) {
    owner.addStatStage(ctx, StatTypeWithoutHp.atk, -2)
    owner.addStatStage(ctx, StatTypeWithoutHp.spa, -1)
    owner.addStatStage(ctx, StatTypeWithoutHp.def, 2)
    if (variant === 'existing') recipient.activePet.addStatStage(ctx, StatTypeWithoutHp.atk, 1)
  } else {
    const other = new BaseMark('fixture/other-status' as baseMarkId, [], base.config, ['status']).createInstance()
    other.setOwner(owner, battle.emitter)
    other.stack = 3
    owner.marks.push(other)
    const plain = new BaseMark('fixture/plain' as baseMarkId, [], base.config).createInstance()
    plain.setOwner(owner, battle.emitter)
    owner.marks.push(plain)
    if (variant === 'existing') {
      const existing = base.createInstance()
      existing.setOwner(recipient.activePet, battle.emitter)
      existing.stack = 4
      recipient.activePet.marks.push(existing)
    }
  }
  source.effects.push(native ? candidates[id] : EffectParser.parse(definitions.find(d => d.id === id)!))
  if (variant === 'wrong-owner') {
    if (defensive) use.actualTarget = a.activePet
    else use.pet = a.team[1]
  }
  if (variant === 'suppressed' && kind === 'mark') sourceMark.isSuppressed = true
  const trace: string[] = []
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/transfer-observer' as effectId,
      triggers: [
        EffectTrigger.BeforeEffect,
        EffectTrigger.OnBeforeAddMark,
        EffectTrigger.OnRemoveMark,
        EffectTrigger.OnStackBefore,
      ],
      when: hook =>
        hook.trigger !== EffectTrigger.BeforeEffect ||
        (hook.parent instanceof EffectContext && hook.parent.effect?.id === id),
      apply: hook => {
        if (
          hook.trigger === EffectTrigger.BeforeEffect &&
          hook.parent instanceof EffectContext &&
          hook.parent.effect?.id === id
        ) {
          if (variant === 'cancel-effect') hook.parent.available = false
          if (variant === 'late-slot') recipient.activePet = recipient.team[1]
        }
        if (hook.trigger === EffectTrigger.OnBeforeAddMark) {
          trace.push(`add:${hook.parent.baseMark.id}:${hook.parent.stack}`)
          if (variant === 'cancel-stage') hook.parent.available = false
        }
        if (hook.trigger === EffectTrigger.OnRemoveMark) {
          trace.push(`remove:${hook.parent.mark.baseId}`)
          if (variant === 'mutate-next-stage') {
            const next = owner.marks.find(
              (m): m is StatLevelMarkInstanceImpl =>
                m instanceof StatLevelMarkInstanceImpl && m.statType === StatTypeWithoutHp.spa,
            )
            if (next) next.level = 2
          }
        }
        if (hook.trigger === EffectTrigger.OnStackBefore) trace.push('stack')
      },
    }),
  )
  const parent = variant === 'nested' ? ctx : use
  battle.applyEffects(parent, EffectTrigger.OnHit as EffectTrigger, source)
  if (variant === 'repeat') battle.applyEffects(parent, EffectTrigger.OnHit as EffectTrigger, source)
  return {
    stats: pets.map(p => [p.stat.atk, p.stat.def, p.stat.spa, p.stat.spd, p.stat.spe]),
    marks: pets.map(p =>
      p.marks
        .map(m => ({ id: m.baseId, stack: m.stack, level: m instanceof StatLevelMarkInstanceImpl ? m.level : null }))
        .sort((x, y) => x.id.localeCompare(y.id)),
    ),
    source: {
      owner: pets.indexOf(sourceMark.owner as typeof owner),
      stack: sourceMark.stack,
      active: sourceMark.isActive,
    },
    trace,
    next: battle.random(),
  }
}
for (const id of Object.keys(candidates) as (keyof typeof candidates)[])
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${id} ${kind} ${variant}`, () => {
        const actual = run(id, true, kind, variant)
        expect(actual).toEqual(run(id, false, kind, variant))
        if (variant === 'normal' && id.includes('debuff_stage')) {
          expect(actual.marks[0].filter(m => m.level !== null)).toEqual([
            { id: 'stat_stage_def_up', stack: 2, level: 2 },
          ])
          expect(actual.marks[2].filter(m => m.level !== null)).toEqual([
            { id: 'stat_stage_atk_down', stack: 2, level: -2 },
            { id: 'stat_stage_spa_down', stack: 1, level: -1 },
          ])
        }
        if (variant === 'normal' && id.includes('status_marks')) {
          expect(actual.source.owner).toBe(2)
          expect(actual.marks[2].map(m => m.id)).toEqual(['fixture/other-status', 'fixture/status'])
        }
        if (variant === 'normal' && id.startsWith('effect_mark') && kind === 'mark') {
          expect(actual.source.owner).toBe(0)
          expect(actual.source.stack).toBe(3)
        }
        if (variant === 'existing' && id.startsWith('effect_mark') && kind === 'mark') {
          expect(actual.source.owner).toBe(-1)
          expect(actual.source.stack).toBe(3)
          expect(actual.marks[0].find(m => m.id === 'fixture/status')?.stack).toBe(6)
        }
        if (variant === 'cancel-stage' && id.includes('debuff_stage')) {
          expect(actual.marks[2]).toEqual([])
          expect(actual.marks[0].filter(m => m.level !== null).every(m => m.level! > 0)).toBe(true)
        }
      })

for (const operation of ['marks', 'stages'] as const)
  it(`rejects foreign ${operation} before any transfer`, () => {
    const f = makeScenario(17),
      other = makeScenario(18)
    battles.push(f.battle, other.battle)
    const skill = f.a.activePet.skills[0]
    const use = new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
    const ctx = new EffectContext(use, EffectTrigger.OnHit, skill)
    const local = new BaseMark('fixture/local' as baseMarkId, [], f.debuff.config).createInstance()
    const foreign = new BaseMark('fixture/foreign' as baseMarkId, [], f.debuff.config).createInstance()
    local.setOwner(f.a.activePet, f.battle.emitter)
    f.a.activePet.marks.push(local)
    foreign.setOwner(other.a.activePet, other.battle.emitter)
    other.a.activePet.marks.push(foreign)
    const op =
      operation === 'marks'
        ? effectAuthoring.ops.transferMarks(effectAuthoring.selectFrom([local, foreign]).all())
        : effectAuthoring.ops.transferStatStages(effectAuthoring.selectFrom([other.a.activePet]).first())
    const effect = effectAuthoring.compileEffect(
      effectAuthoring.defineEffect({
        id: 'fixture/foreign-transfer',
        triggers: [EffectTrigger.OnHit],
        apply: effectAuthoring.targets.opponentActive.apply(op),
      }),
    )
    expect(() => f.battle.executionBudget.run(0, () => effect.innerApply(ctx))).toThrow('Cross-battle')
    expect(local.owner).toBe(f.a.activePet)
    expect(foreign.owner).toBe(other.a.activePet)
    expect(f.a.activePet.marks).toContain(local)
    expect(f.b.activePet.marks).not.toContain(local)
  })
