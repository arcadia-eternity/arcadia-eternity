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
  SwitchPetContext,
  SwitchPetPhase,
  GameRng,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
type RecordEntry = {
  id: keyof ReturnType<typeof createGeneratedMarkApplications>
  sourceFile: string
  status: string
  recipe: {
    markId: string
    when: string
    stack: number
    switchTargetRepairs?: { path: string; before: string; after: string }[]
    additionalDecisions?: string[]
  }
  dependency: { sourceFile: string }
}
const allRecords: RecordEntry[] = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/mark-applications-candidates.json', import.meta.url), 'utf8'),
).records.filter((r: RecordEntry) => r.status === 'generated-candidate')
const records = allRecords.filter(r => r.recipe.switchTargetRepairs)
const files = new Map<string, { id: string }[]>()
for (const r of allRecords)
  for (const path of [r.sourceFile, r.dependency.sourceFile])
    if (!files.has(path))
      files.set(path, parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8'), { merge: true }))
const marks = new Map(
  allRecords.map(r => [
    r.recipe.markId,
    MarkParser.parse({ ...files.get(r.dependency.sourceFile)!.find(d => d.id === r.recipe.markId), effect: [] }),
  ]),
)
const candidates = createGeneratedMarkApplications(marks)
const definitions = new Map(records.map(r => [r.id, files.get(r.sourceFile)!.find(d => d.id === r.id)!]))
const oracles = new Map(
  records.map(r => {
    const copy = structuredClone(definitions.get(r.id)) as unknown as {
      apply: { target: { chain: { type: string; arg: string }[] } }
    }
    expect(copy.apply.target.chain[0]).toEqual({ type: 'selectPath', arg: 'switchInPetId' })
    copy.apply.target.chain[0].arg = 'switchInPet'
    return [r.id, EffectParser.parse(copy)]
  }),
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'wrong-owner',
  'late-owner',
  'late-target',
  'late-outgoing',
  'late-active',
  'cancel-effect',
  'cancel-add',
  'modify',
  'existing',
  'real-switch',
] as const
function run(r: RecordEntry, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(31)
  battles.push(battle)
  const outgoing = a.activePet,
    incoming = a.team[1]
  const owner = r.recipe.when === 'conditions.ownerSwitchesIn' ? incoming : outgoing
  const skill = owner.skills[0]
  skill.effects.splice(0)
  let source: typeof skill | (typeof owner.marks)[number] = skill
  if (kind === 'mark') {
    source = new BaseMark('fixture/switch-target-source' as baseMarkId, [], {
      ...debuff.config,
      keepOnSwitchOut: true,
    }).createInstance()
    source.owner = owner
    owner.marks.push(source)
  }
  source.effects.push(native ? candidates[r.id] : oracles.get(r.id)!)
  if (variant === 'wrong-owner') source.owner = b.activePet
  const base = marks.get(r.recipe.markId)!,
    repo = DataRepository.getInstance(),
    previous = repo.marks.get(base.id)
  repo.marks.set(base.id, base)
  if (variant === 'existing') {
    const instance = base.createInstance({ stack: 3, duration: 1 })
    instance.owner = incoming
    incoming.marks.push(instance)
  }
  const event = new SwitchPetContext(new TurnContext(battle), a, incoming)
  const inputs: { target: string; stack: number; duration: number; active: string }[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/switch-target-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === r.id),
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'late-target') event.switchInPet = outgoing
          if (variant === 'late-outgoing') event.switchOutPet = b.activePet
          if (variant === 'late-active') a.activePet = incoming
          if (variant === 'cancel-effect') ctx.parent.available = false
        }
        if (ctx.trigger === EffectTrigger.OnBeforeAddMark && ctx.parent.baseMark === base) {
          inputs.push({
            target: ctx.parent.target instanceof Pet ? ctx.parent.target.id : 'battle',
            stack: ctx.parent.stack,
            duration: ctx.parent.duration,
            active: a.activePet.id,
          })
          if (variant === 'cancel-add') ctx.parent.available = false
          if (variant === 'modify') {
            ctx.parent.stack = 2
            ctx.parent.duration = 7
          }
        }
      },
    }),
  )
  try {
    if (variant === 'real-switch') {
      const phase = new SwitchPetPhase(battle, a, incoming, event.parent, event)
      phase.initialize()
      phase.execute()
    } else battle.applyEffects(event, EffectTrigger.OnSwitchOut)
    return {
      inputs,
      active: a.activePet.id,
      marks: [...a.team, ...b.team].flatMap(pet =>
        pet.marks.filter(m => m.baseId === base.id).map(m => ({ owner: pet.id, stack: m.stack, duration: m.duration })),
      ),
      nextRandom: battle.random(),
    }
  } finally {
    if (previous) repo.marks.set(base.id, previous)
    else repo.marks.delete(base.id)
  }
}
for (const r of records) {
  it(`${r.id} records C11 without changing the stage or guard`, () => {
    expect(() => EffectParser.parse(definitions.get(r.id))).toThrow(/switchInPetId/)
    expect(r.recipe.switchTargetRepairs).toEqual([
      { path: '/apply/target/chain/0/arg', before: 'switchInPetId', after: 'switchInPet' },
    ])
    expect(r.recipe.additionalDecisions).toEqual(['C11'])
    expect(candidates[r.id].trigger).toEqual(oracles.get(r.id)!.trigger)
  })
  for (const kind of ['skill', 'mark'] as const)
    it.each(variants)(`${r.id} ${kind} switch target: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      expect(actual.nextRandom).toBe(new GameRng(31).next())
      const admitted = !['wrong-owner', 'cancel-effect'].includes(variant)
      expect(actual.inputs).toHaveLength(admitted ? 1 : 0)
      expect(actual.active).toBe(['real-switch', 'late-active'].includes(variant) ? 'A/reserve' : 'A/lead')
      if (!admitted || variant === 'cancel-add') expect(actual.marks).toEqual([])
      else {
        const target = variant === 'late-target' ? 'A/lead' : 'A/reserve'
        expect(actual.inputs[0]).toEqual({
          target,
          stack: r.recipe.stack,
          duration: marks.get(r.recipe.markId)!.config.duration,
          active: variant === 'late-active' ? 'A/reserve' : 'A/lead',
        })
        expect(actual.marks).toHaveLength(1)
        expect(actual.marks[0].owner).toBe(target)
        if (variant === 'modify')
          expect(actual.marks[0]).toEqual({
            owner: target,
            stack: 2,
            duration: marks.get(r.recipe.markId)!.config.persistent ? -1 : 7,
          })
      }
    })
}
it('covers two outgoing guards and one incoming guard during switch-out dispatch', () => {
  expect(records).toHaveLength(3)
  expect(records.filter(r => r.recipe.when === 'conditions.ownerSwitchesOut')).toHaveLength(2)
})
