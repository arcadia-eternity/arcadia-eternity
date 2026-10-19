import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  SkillInstance,
  BaseSkill,
  SnapshotCatalog,
  effectAuthoring,
  createGeneratedSkillPowerEffects,
  SkillPhase,
  PhaseState,
  generatedSkillPowerEffects,
  AddMarkContext,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  Element,
  Category,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { playCandidateGame } from './candidate-game'
type Id = keyof typeof generatedSkillPowerEffects
interface RecordEntry {
  id: Id
  sourceFile: string
  sourcePath: string
  definitionSha256: string
  recipe: {
    trigger: 'BeforeUseSkillCheck' | 'AfterUseSkillCheck' | 'BeforeHit'
    operation: 'addPower' | 'amplifyPower'
    amount: number
    consumesStacks?: number
    repairedPaths: string[]
  }
}
const { records }: { records: RecordEntry[] } = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/skill-power-candidates.json', import.meta.url), 'utf8'),
)
const definitions = new Map(
  records.map(r => [
    r.id,
    parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
      Number(r.sourcePath.slice(1))
    ],
  ]),
)
// Independent test reference: repair only selector spelling; no coefficients, paths or predicates change.
function corrected(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(corrected)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [
        k,
        ['base', 'target'].includes(k) && x === 'useSkillContext' ? 'usingSkillContext' : corrected(x),
      ]),
    )
  return v
}
const oracles = new Map(records.map(r => [r.id, EffectParser.parse(corrected(definitions.get(r.id)))]))
function objects(v: unknown): { [key: string]: unknown }[] {
  if (Array.isArray(v)) return v.flatMap(objects)
  if (v && typeof v === 'object') return [v as { [key: string]: unknown }, ...Object.values(v).flatMap(objects)]
  return []
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
const variants = [
  'normal',
  'missing-marks',
  'wrong-role',
  'late-owner',
  'late-values',
  'cancel',
  'other-skill',
  'alternate-element',
  'repeat',
  'phase',
] as const
function run(r: RecordEntry, native: boolean, kind: 'skill' | 'mark' | 'global', variant: (typeof variants)[number]) {
  const f = makeScenario(328),
    { battle, a, b } = f
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  const pet = a.activePet,
    skill = pet.skills[0]
  const nodes = objects(definitions.get(r.id).condition)
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const add = (owner: typeof pet | Battle, id: string) => {
    const base = new BaseMark(id as baseMarkId, [], { ...f.debuff.config, maxStacks: 5, stackable: true })
    battle.addMark(new AddMarkContext(setup, owner, base, 3))
    return owner.marks.find(m => m.base === base)!
  }
  if (variant !== 'missing-marks')
    for (const node of nodes) {
      if (typeof node.baseId === 'string') {
        add(pet, node.baseId)
        add(b.activePet, node.baseId)
      }
      if (node.type === 'contain' && typeof node.tag === 'string') add(pet, 'fixture/tag').tags.push(node.tag)
    }
  for (const owner of [pet, b.activePet]) {
    owner.attributeSystem.updateBaseValue('maxHp', 801)
    owner.currentHp = nodes.some(n => n.operator === '==') ? 801 : nodes.some(n => n.operator === '>') ? 700 : 10
  }
  const source = kind === 'skill' ? skill : add(kind === 'global' ? battle : pet, 'fixture/power')
  source.effects.push(native ? generatedSkillPowerEffects[r.id] : oracles.get(r.id)!)
  const otherSkill = new SkillInstance(skill.base)
  otherSkill.setOwner(pet)
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    pet,
    AttackTargetOpinion.opponent,
    variant === 'other-skill' ? otherSkill : skill,
  )
  use.actualTarget = b.activePet
  use.power = 83
  const strings = nodes.flatMap(n => (typeof n.value === 'string' ? [n.value] : Array.isArray(n.value) ? n.value : []))
  use.element = (strings.find(s => Object.values(Element).includes(s)) ?? Element.Normal) as Element
  use.category = (strings.find(s => Object.values(Category).includes(s) && s !== 'Status') ??
    Category.Physical) as Category
  if (variant === 'alternate-element') {
    use.element = Element.Trait
    use.category = Category.Status
  }
  const trace: unknown[] = []
  battle.registerListener(message => trace.push(message.type))
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/power-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.AfterEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === r.id,
      apply: ctx => {
        if (!(ctx.parent instanceof EffectContext)) return
        if (ctx.trigger === EffectTrigger.AfterEffect) {
          trace.push({ success: ctx.parent.success })
          return
        }
        trace.push('admitted')
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-values') {
          pet.currentHp = 801
          use.power = 101
          use.element = Element.Trait
        }
        if (variant === 'cancel') ctx.parent.available = false
      },
    }),
  )
  if (variant === 'wrong-role') source.owner = a.team[1]
  if (variant === 'phase') {
    use.rage = 0
    a.currentRage = 100
    const phase = new SkillPhase(battle, a, pet, AttackTargetOpinion.opponent, skill, use.parent, use)
    battle.phaseManager.registerPhase(phase)
    battle.phaseManager.executePhase(phase.id)
    expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toEqual([])
  } else battle.applyEffects(use, EffectTrigger[r.recipe.trigger], source)
  if (variant === 'repeat') battle.applyEffects(use, EffectTrigger[r.recipe.trigger], source)
  return {
    power: use.power,
    trace,
    stack: source instanceof SkillInstance ? null : source.stack,
    hp: [pet.currentHp, b.activePet.currentHp],
    rage: [a.currentRage, b.currentRage],
    nextRandom: battle.random(),
  }
}
for (const r of records) {
  it(`${r.id} records the original parser failure and pins its source`, () => {
    expect(() => EffectParser.parse(definitions.get(r.id))).toThrow()
    expect(r.recipe.repairedPaths).toContain(
      typeof definitions.get(r.id).apply.target === 'string' ? '/apply/target' : '/apply/target/base',
    )
    const normalize = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(normalize)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b, 'en'))
                .map(([k, x]) => [k, normalize(x)]),
            )
          : v
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definitions.get(r.id))))
        .digest('hex'),
    ).toBe(r.definitionSha256)
  })
  for (const kind of (r.id.startsWith('effect_global_') ? ['skill', 'mark', 'global'] : ['skill', 'mark']) as (
    | 'skill'
    | 'mark'
    | 'global'
  )[])
    it.each(variants)(`${r.id} ${kind}: %s`, variant => {
      const actual = run(r, true, kind, variant)
      expect(actual).toEqual(run(r, false, kind, variant))
      expect(actual.trace).not.toContainEqual({ success: false })
      if (variant === 'normal' || variant === 'phase') {
        expect(actual.trace).toContain('admitted')
        expect(actual.power).toBeCloseTo(
          r.recipe.operation === 'addPower' ? 83 + r.recipe.amount : 83 * r.recipe.amount,
        )
      }
    })
}
it('exports exactly the recorded candidate IDs', () =>
  expect(Object.keys(generatedSkillPowerEffects).sort()).toEqual(records.map(r => r.id).sort()))

async function game(r: RecordEntry, native: boolean, checkpoint: boolean) {
  const f = makeScenario(329),
    { battle, a, b } = f
  const pets = [...a.team, ...b.team]
  const originals = pets.flatMap(p => p.baseSkills.flatMap(s => s.effects))
  const nodes = objects(definitions.get(r.id).condition)
  const strings = nodes.flatMap(n => (typeof n.value === 'string' ? [n.value] : Array.isArray(n.value) ? n.value : []))
  const element = (strings.find(s => Object.values(Element).includes(s)) ?? Element.Normal) as Element
  const category = (strings.find(s => Object.values(Category).includes(s) && s !== 'Status') ??
    Category.Physical) as Category
  const candidate = () => (native ? createGeneratedSkillPowerEffects()[r.id] : oracles.get(r.id)!)
  const effect = candidate()
  for (const pet of pets) {
    pet.attributeSystem.updateBaseValue('maxHp', 801)
    pet.currentHp = nodes.some(n => n.operator === '==') ? 801 : nodes.some(n => n.operator === '>') ? 700 : 10
    const base = new BaseSkill(
      `fixture/power-${pet.id}` as BaseSkill['id'],
      pet.owner === a ? category : Category.Status,
      element,
      pet === a.team[1] ? 1000 : 10,
      100,
      0,
      0,
      AttackTargetOpinion.opponent,
      1,
      true,
    )
    const skill = new SkillInstance(base)
    skill.setOwner(pet)
    for (const old of pet.skills) battle.skillMap.delete(old.id)
    pet.skills.splice(0, pet.skills.length, skill)
    battle.skillMap.set(skill.id, skill)
  }
  return playCandidateGame({
    battle,
    effectId: r.id,
    checkpoint,
    catalog: fresh => {
      const c = new SnapshotCatalog(`skill-power/${r.id}`)
      for (const e of [...originals, ...f.debuff.effects]) c.registerEffect(e.id, e)
      const registered = fresh ? candidate() : effect
      if (native) effectAuthoring.registerEffect(c, registered)
      else c.registerEffect(registered.id, registered)
      return c
    },
    setup: () => {
      const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
      const add = (
        owner: typeof a.activePet | Battle,
        id: string,
        effects: (typeof effect)[] = [],
        tags: string[] = [],
      ) =>
        battle.addMark(
          new AddMarkContext(
            setup,
            owner,
            new BaseMark(
              id as baseMarkId,
              effects,
              { ...f.debuff.config, maxStacks: 20, persistent: true, keepOnSwitchOut: true },
              tags,
            ),
            3,
          ),
        )
      for (const pet of pets)
        for (const node of nodes) {
          if (typeof node.baseId === 'string') add(pet, node.baseId)
          if (node.type === 'contain' && typeof node.tag === 'string') add(pet, 'fixture/power-tag', [], [node.tag])
        }
      if (r.id.startsWith('effect_global_')) add(battle, 'fixture/power-source', [effect])
      else for (const pet of a.team) add(pet, 'fixture/power-source', [effect])
    },
  })
}
for (const r of records)
  it(`${r.id}: complete game and fresh-catalog checkpoint continuation`, async () => {
    const expected = await game(r, false, false)
    expect(await game(r, true, false)).toEqual(expected)
    expect(await game(r, true, true)).toEqual(expected)
  })
