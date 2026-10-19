import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  createGeneratedMarkApplications,
  defineNativeEffect,
  BaseMark,
  Pet,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  SkillPhase,
  GameRng,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const id = 'effect_mark_yingfeng_heal_50_on_evasion_in_yemu'
const markId = 'mark_huifu_50_per_turn'
const load = (path: string): { id: string }[] =>
  parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'), { merge: true })
const definitions = load('packs/base/data/effect_mark.yaml')
const oracle = EffectParser.parse(definitions.find(d => d.id === id))
const ledger: { records: { status: string; recipe: { markId: string }; dependency: { sourceFile: string } }[] } =
  JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
  )
const files = new Map<string, { id: string }[]>()
const marks = new Map<string, BaseMark>()
for (const record of ledger.records.filter(r => r.status === 'generated-candidate')) {
  const path = record.dependency.sourceFile
  if (!files.has(path)) files.set(path, load(path))
  marks.set(
    record.recipe.markId,
    MarkParser.parse({ ...files.get(path)!.find(d => d.id === record.recipe.markId), effect: [] }),
  )
}
const candidate = createGeneratedMarkApplications(marks)[id]
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'wrong-target',
  'no-field',
  'late-target',
  'late-owner',
  'late-active',
  'late-field',
  'cancel-effect',
  'cancel-add',
  'modify',
  'existing',
  'real-miss',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(31)
  battles.push(battle)
  const owner = a.activePet,
    skill = owner.skills[0]
  skill.effects.splice(0)
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/target-source' as baseMarkId, [], debuff.config).createInstance()
    source.owner = owner
    owner.marks.push(source)
  }
  source.effects.push(native ? candidate : oracle)
  const field = new BaseMark('mark_global_yemu' as baseMarkId, []).createInstance()
  field.owner = battle
  if (variant !== 'no-field') battle.marks.push(field)
  const base = marks.get(markId)!
  const repo = DataRepository.getInstance(),
    previous = repo.marks.get(base.id)
  repo.marks.set(base.id, base)
  if (variant === 'existing') {
    const existing = base.createInstance({ duration: 1 })
    existing.owner = owner
    owner.marks.push(existing)
  }
  const inputs: { target: string; duration: number; stack: number }[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/target-mark-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark, EffectTrigger.BeforeMultiHit],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.BeforeMultiHit) ctx.parent.hitResult = false
        if (
          ctx.trigger === EffectTrigger.BeforeEffect &&
          ctx.parent instanceof EffectContext &&
          ctx.parent.effect?.id === id
        ) {
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'late-active') a.activePet = a.team[1]
          if (variant === 'late-target' && ctx.parent.parent instanceof UseSkillContext)
            ctx.parent.parent.actualTarget = b.activePet
          if (variant === 'late-field') battle.marks.splice(battle.marks.indexOf(field), 1)
          if (variant === 'cancel-effect') ctx.parent.available = false
        }
        if (ctx.trigger === EffectTrigger.OnBeforeAddMark && ctx.parent.baseMark === base) {
          inputs.push({
            target: ctx.parent.target instanceof Pet ? ctx.parent.target.id : 'battle',
            duration: ctx.parent.duration,
            stack: ctx.parent.stack,
          })
          if (variant === 'cancel-add') ctx.parent.available = false
          if (variant === 'modify') ctx.parent.duration = 7
        }
      },
    }),
  )
  try {
    const turn = new TurnContext(battle)
    const use = new UseSkillContext(turn, b, b.activePet, AttackTargetOpinion.opponent, b.activePet.skills[0])
    use.updateActualTarget()
    if (variant === 'wrong-target') use.actualTarget = a.team[1]
    if (variant === 'real-miss') {
      b.currentRage = b.maxRage
      const phase = new SkillPhase(
        battle,
        b,
        b.activePet,
        AttackTargetOpinion.opponent,
        b.activePet.skills[0],
        turn,
        use,
      )
      phase.initialize()
      phase.execute()
    } else battle.applyEffects(use, EffectTrigger.OnMiss)
    return {
      inputs,
      marks: [...a.team, ...b.team].flatMap(pet =>
        pet.marks.filter(m => m.baseId === markId).map(m => ({ owner: pet.id, duration: m.duration, stack: m.stack })),
      ),
      nextRandom: battle.random(),
    }
  } finally {
    if (previous) repo.marks.set(base.id, previous)
    else repo.marks.delete(base.id)
  }
}
for (const kind of ['skill', 'mark'] as const)
  it.each(variants)(`target-side evasion ${kind}: %s`, variant => {
    const actual = run(true, kind, variant)
    expect(actual).toEqual(run(false, kind, variant))
    const admitted = !['wrong-target', 'no-field', 'cancel-effect'].includes(variant)
    expect(actual.inputs).toHaveLength(admitted ? 1 : 0)
    if (variant !== 'real-miss') expect(actual.nextRandom).toBe(new GameRng(31).next())
    if (!admitted || variant === 'cancel-add') expect(actual.marks).toEqual([])
    else {
      expect(actual.inputs[0]).toEqual({
        target: variant === 'late-owner' ? 'B/lead' : 'A/lead',
        duration: 3,
        stack: marks.get(markId)!.config.maxStacks,
      })
      expect(actual.marks).toEqual([
        {
          owner: variant === 'late-owner' ? 'B/lead' : 'A/lead',
          duration: variant === 'modify' ? 7 : 3,
          stack: marks.get(markId)!.config.maxStacks,
        },
      ])
    }
  })
