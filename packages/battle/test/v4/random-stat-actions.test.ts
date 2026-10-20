import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { EffectParser, type EffectDSL } from '@arcadia-eternity/battle/v4/legacy'
import {
  createRandomStatActions,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  Gender,
  GameRng,
  StatLevelMarkInstanceImpl,
  SkillPhase,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const candidates = createRandomStatActions()
const definitions: EffectDSL[] = parse(
  readFileSync(new URL('../../../../packs/base/data/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  vi.restoreAllMocks()
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'missing-emblem',
  'wrong-gender',
  'other-actor',
  'nested',
  'switch-during-draw',
  'switch-between-actions',
  'cancel-first-stage',
  'repeat',
  'cancel-effect',
  'real-skill',
] as const
function run(
  id: keyof typeof candidates,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
  seed: number,
) {
  const f = makeScenario(seed),
    { battle, a, b, debuff } = f
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) {
    p.marks.splice(0)
    p.gender = Gender.NoGender
    for (const s of p.skills) s.effects.splice(0)
  }
  if (variant === 'wrong-gender') b.activePet.gender = Gender.Female
  function mark(id: string) {
    const m = new BaseMark(id as baseMarkId, [], debuff.config).createInstance()
    m.owner = a.activePet
    a.activePet.marks.push(m)
    return m
  }
  if (variant !== 'missing-emblem') mark('mark_emblem_wuxing')
  const skill = a.activePet.skills[0],
    source = kind === 'skill' ? skill : mark('fixture/source')
  const original = definitions.find(d => d.id === id)!
  const corrected = structuredClone(original)
  const apply = corrected.apply as { target: { value: unknown[]; chain: unknown[] } }
  if (!id.includes('atk_def_or')) {
    // Explicit correction: singleton groups defer flat action values until after the random draw.
    apply.target.value = apply.target.value.map(action => [action])
    apply.target.chain.push({ type: 'flat' })
  }
  source.effects.push(native ? candidates[id] : EffectParser.parse(corrected))
  const draws: number[] = []
  const shuffle = battle.shuffle.bind(battle)
  vi.spyOn(battle, 'shuffle').mockImplementation(items => {
    draws.push([...a.team, ...b.team].flatMap(p => p.marks.filter(m => m instanceof StatLevelMarkInstanceImpl)).length)
    const selected = shuffle(items)
    if (variant === 'switch-during-draw') b.activePet = b.team[1]
    return selected
  })
  if (variant === 'cancel-effect')
    b.activePet.skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/cancel-random' as effectId,
        triggers: [EffectTrigger.BeforeEffect],
        when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
        apply: ctx => {
          if (ctx.parent instanceof EffectContext) ctx.parent.available = false
        },
      }),
    )
  if (variant === 'switch-between-actions' || variant === 'cancel-first-stage') {
    let seen = 0
    b.team[1].skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/stage-boundary' as effectId,
        triggers: [EffectTrigger.OnBeforeAddMark],
        when: ctx => ctx.parent.baseMark.id.startsWith('stat_stage_'),
        apply: ctx => {
          if (++seen !== 1) return
          if (variant === 'switch-between-actions') b.activePet = b.team[1]
          else ctx.parent.available = false
        },
      }),
    )
  }
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    variant === 'other-actor' ? a.team[1] : a.activePet,
    AttackTargetOpinion.opponent,
    skill,
  )
  use.updateActualTarget()
  if (variant === 'real-skill') {
    a.currentRage = a.maxRage
    use.hitOverrides.push({ willHit: true, priority: 1000 })
    use.critOverrides.push({ willCrit: false, priority: 1000 })
    const phase = new SkillPhase(battle, a, a.activePet, AttackTargetOpinion.opponent, skill, use.parent, use)
    phase.initialize()
    phase.execute()
  } else {
    const parent = variant === 'nested' ? new EffectContext(use, EffectTrigger.BeforeHit, source) : use
    battle.applyEffects(parent, EffectTrigger.BeforeHit as EffectTrigger, source)
    if (variant === 'repeat') battle.applyEffects(parent, EffectTrigger.BeforeHit as EffectTrigger, source)
  }
  return {
    draws,
    levels: [...a.team, ...b.team].map(p =>
      p.marks
        .filter((m): m is StatLevelMarkInstanceImpl => m instanceof StatLevelMarkInstanceImpl)
        .map(m => ({ stat: m.statType, level: m.level })),
    ),
    next: battle.random(),
  }
}
for (const id of Object.keys(candidates) as (keyof typeof candidates)[])
  for (const kind of ['skill', 'mark'] as const)
    for (const seed of [11, 29])
      for (const variant of variants) {
        it(`${id} ${kind} ${seed} ${variant}`, () => {
          const actual = run(id, true, kind, variant, seed)
          expect(actual).toEqual(run(id, false, kind, variant, seed))
          if (['missing-emblem', 'wrong-gender', 'other-actor', 'cancel-effect'].includes(variant)) {
            expect(actual.draws).toEqual([])
            expect(actual.levels.flat()).toEqual([])
          }
          if (variant === 'switch-between-actions' && id.includes('atk_def_or')) {
            expect(actual.levels[2]).toHaveLength(1)
            expect(actual.levels[3]).toHaveLength(1)
          }
          if (variant === 'cancel-first-stage')
            expect(actual.levels.flat()).toHaveLength(id.includes('atk_def_or') ? 1 : 0)
          if (variant === 'normal') {
            const groups = id.includes('atk_def_or')
              ? [
                  ['atk', 'def'],
                  ['spa', 'spd'],
                ]
              : id.includes('raise')
                ? [['atk'], ['spe']]
                : [['atk'], ['spa']]
            const rng = new GameRng(seed),
              expected = rng.shuffle(groups)[0]
            expect(actual.draws).toEqual([0])
            expect(actual.levels.flat()).toEqual(expected.map(stat => ({ stat, level: id.includes('raise') ? 1 : -1 })))
            expect(actual.next).toBe(rng.next())
          }
          if (variant === 'switch-during-draw' && !id.includes('raise')) {
            expect(actual.levels[2]).toEqual([])
            expect(actual.levels[3].length).toBe(id.includes('atk_def_or') ? 2 : 1)
          }
        })
      }
