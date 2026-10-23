import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  defineNativeEffect,
  BaseMark,
  Pet,
  SkillInstance,
  SkillPhase,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  GameRng,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import {
  createRandomMarkApplications,
  randomMarkApplicationDependencies,
} from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_skill_add_mark_zhaocai_or_jinbao'
const load = (name: string): { id: string }[] =>
  parse(
    readFileSync(
      new URL(
        `${name.startsWith('effect_') ? './fixtures/effect-regression' : '../../../../packs/base/data'}/${name}.yaml`,
        import.meta.url,
      ),
      'utf8',
    ),
    { merge: true },
  )
const definition = load('effect_skill').find(d => d.id === id)!
const oracle = EffectParser.parse(definition)
const markDefinitions = load('mark')
const marks = new Map(
  randomMarkApplicationDependencies.map(id => [
    id,
    MarkParser.parse({ ...markDefinitions.find(d => d.id === id), effect: [] }),
  ]),
)
const candidate = createRandomMarkApplications(marks)[id]
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'real-skill',
  'other-skill',
  'late-owner',
  'cancel-effect',
  'cancel-add',
  'replace',
  'repeat',
  'modify',
] as const
function run(native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number], seed: number) {
  const { battle, a, b, debuff } = makeScenario(seed)
  battles.push(battle)
  const owner = a.activePet,
    skill = owner.skills[0]
  skill.effects.splice(0)
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/random-source' as baseMarkId, [], debuff.config).createInstance()
    source.owner = owner
    owner.marks.push(source)
  }
  source.effects.push(native ? candidate : oracle)
  const repo = DataRepository.getInstance()
  const previous = [...marks.values()].map(base => [base.id, repo.marks.get(base.id)] as const)
  for (const base of marks.values()) repo.marks.set(base.id, base)
  if (variant === 'replace') {
    const rng = new GameRng(seed)
    const chosen = rng.shuffle([...randomMarkApplicationDependencies])[0]
    const other = randomMarkApplicationDependencies.find(id => id !== chosen)!
    const existing = marks.get(other)!.createInstance()
    existing.owner = owner
    owner.marks.push(existing)
  }
  const inputs: { id: string; owner: string; stack: number; duration: number }[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/random-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'cancel-effect') ctx.parent.available = false
        }
        if (ctx.trigger === EffectTrigger.OnBeforeAddMark && [...marks.values()].includes(ctx.parent.baseMark)) {
          inputs.push({
            id: ctx.parent.baseMark.id,
            owner: ctx.parent.target instanceof Pet ? ctx.parent.target.id : 'battle',
            stack: ctx.parent.stack,
            duration: ctx.parent.duration,
          })
          if (variant === 'cancel-add') ctx.parent.available = false
          if (variant === 'modify') ctx.parent.duration = 7
        }
      },
    }),
  )
  try {
    const selected = variant === 'other-skill' ? new SkillInstance(skill.base, { effects: [] }) : skill
    if (variant === 'other-skill') {
      selected.owner = owner
      owner.skills.push(selected)
    }
    const use = new UseSkillContext(new TurnContext(battle), a, owner, AttackTargetOpinion.opponent, selected)
    use.updateActualTarget()
    if (variant === 'real-skill') {
      a.currentRage = a.maxRage
      use.hitOverrides.push({ willHit: true, priority: 0 })
      use.critOverrides.push({ willCrit: false, priority: 0 })
      const phase = new SkillPhase(battle, a, owner, AttackTargetOpinion.opponent, selected, use.parent, use)
      phase.initialize()
      phase.execute()
    } else battle.applyEffects(use, EffectTrigger.OnHit)
    if (variant === 'repeat') battle.applyEffects(use, EffectTrigger.OnHit)
    return {
      inputs,
      marks: [...a.team, ...b.team].flatMap(pet =>
        pet.marks
          .filter(m => [...marks.values()].includes(m.base))
          .map(m => ({ id: m.baseId, owner: pet.id, duration: m.duration })),
      ),
      nextRandom: battle.random(),
    }
  } finally {
    for (const [key, mark] of previous)
      if (mark) repo.marks.set(key, mark)
      else repo.marks.delete(key)
  }
}
for (const kind of ['skill', 'mark'] as const)
  it.each(variants)(`random lucky mark ${kind}: %s`, variant => {
    const selectedIds = new Set<string>()
    for (const seed of [28, 269]) {
      const actual = run(true, kind, variant, seed)
      expect(actual).toEqual(run(false, kind, variant, seed))
      const rng = new GameRng(seed)
      const admitted = variant !== 'cancel-effect' && !(variant === 'other-skill' && kind === 'skill')
      const chosen = admitted ? rng.shuffle([...randomMarkApplicationDependencies])[0] : undefined
      const last = admitted && variant === 'repeat' ? rng.shuffle([...randomMarkApplicationDependencies])[0] : chosen
      expect(actual.nextRandom).toBe(rng.next())
      expect(actual.inputs).toHaveLength(admitted ? (variant === 'repeat' ? 2 : 1) : 0)
      if (chosen) {
        selectedIds.add(chosen)
        expect(actual.inputs[0]).toEqual({
          id: chosen,
          owner: variant === 'late-owner' ? 'B/lead' : 'A/lead',
          stack: marks.get(chosen)!.config.maxStacks,
          duration: 5,
        })
        if (variant === 'repeat') expect(actual.inputs[1].id).toBe(last)
      }
      if (!admitted || variant === 'cancel-add') expect(actual.marks).toEqual([])
      else
        expect(actual.marks).toEqual([
          { id: last, owner: variant === 'late-owner' ? 'B/lead' : 'A/lead', duration: variant === 'modify' ? 7 : 5 },
        ])
    }
    if (variant !== 'cancel-effect' && !(variant === 'other-skill' && kind === 'skill'))
      expect(selectedIds.size).toBe(2)
  })
it('requires both exact definitions', () => {
  expect(() => createRandomMarkApplications(new Map())).toThrow('mark_zhaocai')
  const copy = new Map<string, BaseMark>(marks)
  copy.set('mark_jinbao', marks.get('mark_zhaocai')!)
  expect(() => createRandomMarkApplications(copy)).toThrow('mark_jinbao')
  expect(Object.keys(createRandomMarkApplications(marks))).toEqual([id])
})
it('pins the original random selection and dependency definitions', () => {
  const record = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/random-mark-applications.json', import.meta.url), 'utf8'),
  )
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  expect(record.id).toBe(id)
  expect(() => EffectParser.parse(definition)).not.toThrow()
  expect(record.correction).toEqual({
    decision: 'C10',
    path: '/apply/mark/type',
    before: 'selectorValue',
    after: 'selector',
  })
  expect(record.definitionSha256).toBe(hash(definition))
  expect(record.dependencies.map((d: { id: string }) => d.id)).toEqual([...randomMarkApplicationDependencies])
  for (const dependency of record.dependencies)
    expect(dependency.definitionSha256).toBe(hash(markDefinitions.find(d => d.id === dependency.id)))
})
