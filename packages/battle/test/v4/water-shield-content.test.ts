import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  EffectParser,
  MarkParser,
  DataRepository,
  EffectBuilder,
  BaseSelector,
  Extractor,
  Conditions,
  ConditionUtils,
  Evaluators,
  Operators,
} from '@arcadia-eternity/battle/v4/legacy'
import {
  createOfficialWaterShieldContent,
  EffectTrigger,
  Category,
  DamageContext,
  DamageType,
  EffectContext,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  RemoveMarkContext,
  defineNativeEffect,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  setGlobalLogger,
  type BaseMark,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const read = (file: string) =>
  parse(readFileSync(new URL(`../../../../packs/base/data/${file}.yaml`, import.meta.url), 'utf8'), { merge: true })
const skills = read('effect_skill'),
  effects = read('effect_mark'),
  marks = read('mark')
const amplifyId = 'effect_mark_amplify_next_damage_skill_power_with_stack'
const destroyId = 'effect_mark_onDestroy_add_mark_shanghaizengjia'
const applyId = 'effect_skill_add_mark_shuiwenpingzhang'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

// This is an explicit lower-level reference, not a claim that the rejected YAML parses.
// The reference uses the legacy selector/operator implementations for the spelled-out recipe.
function reference() {
  const amplification = EffectBuilder.create<EffectTrigger>(EffectTrigger.AfterUseSkillCheck)
    .setId(amplifyId)
    .setCondition(
      Conditions.every(
        Conditions.checkSelf(),
        ConditionUtils.fromEvaluator(
          BaseSelector.usingSkillContext.selectPath('category'),
          Evaluators.notSame<Category>(Category.Status),
        ),
      ),
    )
    .setApply([
      BaseSelector.usingSkillContext.apply(
        Operators.amplifyPower(BaseSelector.mark.select(Extractor.stack).multiply(0.01).add(1)),
      ),
      BaseSelector.mark.apply(Operators.destroyMark()),
    ])
    .build()
  const destroyed = EffectParser.parse(effects.find((entry: { id: string }) => entry.id === destroyId))
  const applied = EffectParser.parse(skills.find((entry: { id: string }) => entry.id === applyId))
  const repository = DataRepository.getInstance()
  const previous = new Map([amplifyId, destroyId].map(id => [id, repository.effects.get(id)]))
  repository.effects.set(amplifyId, amplification)
  repository.effects.set(destroyId, destroyed)
  try {
    return {
      effects: [applied, destroyed, amplification],
      marks: ['mark_shuiwenpingzhang', 'mark_shanghaizengjia'].map(id =>
        MarkParser.parse(marks.find((entry: { id: string }) => entry.id === id)),
      ),
    }
  } finally {
    for (const [id, old] of previous) {
      if (old) repository.effects.set(id, old)
      else repository.effects.delete(id)
    }
  }
}
function installReferenceMarks(content: { marks: readonly BaseMark[] }) {
  const repository = DataRepository.getInstance()
  const previous = content.marks.map(mark => [mark.id, repository.marks.get(mark.id)] as const)
  for (const mark of content.marks) repository.marks.set(mark.id, mark)
  return () => {
    for (const [id, old] of previous) {
      if (old) repository.marks.set(id, old)
      else repository.marks.delete(id)
    }
  }
}
const variants = [
  'normal',
  'status',
  'other-owner',
  'partial-stack',
  'late-stack',
  'late-category',
  'cancel-effect',
  'cancel-destroy-effect',
  'undestroyable',
] as const
function run(native: boolean, variant: (typeof variants)[number]) {
  const content = native ? createOfficialWaterShieldContent() : reference()
  const release = installReferenceMarks(content)
  try {
    const f = makeScenario(251)
    battles.push(f.battle)
    if ('parameters' in content) content.parameters.install(f.battle.configSystem)
    const skill = f.a.activePet.skills[0]
    skill.effects.splice(0, skill.effects.length, content.effects[0])
    const use = new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
    f.battle.applyEffects(use, EffectTrigger.OnHit, skill)
    const shield = f.a.activePet.marks.find(mark => mark.base.id === 'mark_shuiwenpingzhang')!
    const before: unknown[] = [shield.stack]
    const parent = new EffectContext(use, EffectTrigger.OnHit, skill)
    if (variant === 'cancel-destroy-effect')
      skill.effects.push(
        defineNativeEffect({
          id: 'fixture/cancel-shield-destroy' as effectId,
          triggers: [EffectTrigger.BeforeEffect],
          when: context => context.parent instanceof EffectContext && context.parent.effect?.id === destroyId,
          apply: context => {
            if (context.parent instanceof EffectContext) context.parent.available = false
          },
        }),
      )
    f.battle.removeMark(new RemoveMarkContext(parent, shield))
    const amplification = f.a.activePet.marks.find(mark => mark.base.id === 'mark_shanghaizengjia')
    before.push(amplification?.stack ?? null)
    if (amplification && variant === 'partial-stack') amplification.stack = 99
    if (amplification && variant === 'undestroyable') amplification.config.destroyable = false
    skill.effects.push(
      defineNativeEffect({
        id: 'fixture/late-amplification' as effectId,
        triggers: [EffectTrigger.BeforeEffect],
        when: context => context.parent instanceof EffectContext && context.parent.effect?.id === amplifyId,
        apply(context) {
          if (!(context.parent instanceof EffectContext)) return
          if (variant === 'late-stack' && amplification) amplification.stack = 99
          if (variant === 'late-category') use.category = Category.Status
          if (variant === 'cancel-effect') context.parent.available = false
        },
      }),
    )
    use.category = variant === 'status' ? Category.Status : Category.Physical
    if (variant === 'other-owner') use.pet = f.b.activePet
    use.power = 70
    f.battle.applyEffects(use, EffectTrigger.AfterUseSkillCheck)
    const first = use.power
    f.battle.applyEffects(use, EffectTrigger.AfterUseSkillCheck)
    return {
      before,
      first,
      second: use.power,
      remaining: f.a.activePet.marks.map(mark => ({ id: mark.base.id, stack: mark.stack })),
      nextRandom: f.battle.random(),
    }
  } finally {
    release()
  }
}
it.each(variants)('native shield dependency chain matches the explicit legacy recipe for %s', variant => {
  const actual = run(true, variant)
  expect(actual).toEqual(run(false, variant))
  if (variant === 'normal') {
    expect(actual.first).toBe(140)
    expect(actual.second).toBe(140)
    expect(actual.remaining).toEqual([])
  }
  if (variant === 'partial-stack' || variant === 'late-stack') expect(actual.first).toBe(70)
  if (variant === 'undestroyable') {
    expect(actual.first).toBe(140)
    expect(actual.second).toBe(280)
  }
})

it('preserves the official mark configuration and declared effect IDs', () => {
  const native = createOfficialWaterShieldContent(),
    legacy = reference()
  for (let index = 0; index < native.marks.length; index++) {
    expect(native.marks[index].config).toEqual(legacy.marks[index].config)
    expect(native.marks[index].tags).toEqual(legacy.marks[index].tags)
    expect(native.marks[index].effects.map(effect => effect.id)).toEqual(
      legacy.marks[index].effects.map(effect => effect.id),
    )
    expect(Object.isFrozen(native.marks[index])).toBe(true)
  }
  expect(() => EffectParser.parse(effects.find((entry: { id: string }) => entry.id === amplifyId))).not.toThrow()
})

it.each(['shield', 'amplification'] as const)(
  'restores the complete native graph from the %s checkpoint into fresh definitions',
  async stage => {
    const content = createOfficialWaterShieldContent()
    const f = makeScenario(252)
    battles.push(f.battle)
    content.parameters.install(f.battle.configSystem)
    const skill = f.a.activePet.skills[0]
    skill.effects.splice(0, skill.effects.length, content.effects[0])
    const catalog = (graph: ReturnType<typeof createOfficialWaterShieldContent>) => {
      const result = new SnapshotCatalog('water-shield-candidate/1')
      for (const mark of graph.marks) result.registerContent(mark.id, mark)
      for (const effect of graph.effects) result.registerEffect(effect.id, effect)
      for (const pet of [...f.a.team, ...f.b.team])
        for (const skill of pet.skills)
          for (const effect of [...skill.base.effects, ...skill.effects])
            if (!graph.effects.some(candidate => candidate.id === effect.id)) result.registerEffect(effect.id, effect)
      for (const effect of f.debuff.effects) result.registerEffect(effect.id, effect)
      return result
    }
    const ready = new Promise<void>(resolve =>
      f.battle.registerListener(message => {
        if (message.type === BattleMessageType.TurnAction) resolve()
      }),
    )
    const run = f.battle.startBattle().catch(error => expect(error.message).toBe('Battle cancelled'))
    await ready
    const use = new UseSkillContext(new TurnContext(f.battle), f.a, f.a.activePet, AttackTargetOpinion.opponent, skill)
    f.battle.applyEffects(use, EffectTrigger.OnHit, skill)
    if (stage === 'amplification')
      f.battle.removeMark(
        new RemoveMarkContext(new EffectContext(use, EffectTrigger.OnHit, skill), f.a.activePet.marks[0]),
      )
    const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(content))))
    await f.battle.cleanup()
    await run
    const fresh = createOfficialWaterShieldContent()
    const restored = restoreBattle(saved, catalog(fresh))
    battles.push(restored)
    const owner = restored.playerA,
      source = owner.activePet.skills[0]
    const next = new UseSkillContext(
      new TurnContext(restored),
      owner,
      owner.activePet,
      AttackTargetOpinion.opponent,
      source,
    )
    expect(owner.activePet.marks[0].base).toBe(fresh.marks[stage === 'shield' ? 0 : 1])
    if (stage === 'shield') {
      const shield = owner.activePet.marks[0]
      shield.consumeStack(new EffectContext(next, EffectTrigger.OnHit, source), shield.stack)
      expect(owner.activePet.marks[0].base).toBe(fresh.marks[1])
    }
    next.category = Category.Physical
    next.power = 70
    restored.applyEffects(next, EffectTrigger.AfterUseSkillCheck)
    expect(next.power).toBe(140)
    expect(owner.activePet.marks).toEqual([])
  },
)

it('absorbs real damage, creates the downstream mark on exhaustion, and consumes its next-skill bonus', () => {
  function execute(native: boolean) {
    const content = native ? createOfficialWaterShieldContent() : reference()
    const release = installReferenceMarks(content)
    try {
      const f = makeScenario(253)
      battles.push(f.battle)
      if ('parameters' in content) content.parameters.install(f.battle.configSystem)
      const pet = f.a.activePet,
        skill = pet.skills[0]
      skill.effects.splice(0, skill.effects.length, content.effects[0])
      const use = new UseSkillContext(new TurnContext(f.battle), f.a, pet, AttackTargetOpinion.opponent, skill)
      f.battle.applyEffects(use, EffectTrigger.OnHit, skill)
      const shield = pet.marks[0],
        initialHp = pet.currentHp,
        initialShield = shield.stack
      const first = new DamageContext(use, f.b.activePet, pet, 20, DamageType.Physical)
      pet.damage(first)
      const partial = { hp: pet.currentHp, stack: shield.stack, damage: first.damageResult }
      const second = new DamageContext(use, f.b.activePet, pet, shield.stack + 10, DamageType.Physical)
      pet.damage(second)
      const after = {
        hp: pet.currentHp,
        marks: pet.marks.map(mark => ({ id: mark.base.id, stack: mark.stack })),
        damage: second.damageResult,
      }
      use.power = 70
      use.category = Category.Physical
      f.battle.applyEffects(use, EffectTrigger.AfterUseSkillCheck)
      return {
        initialHp,
        initialShield,
        partial,
        after,
        power: use.power,
        remaining: pet.marks.length,
        nextRandom: f.battle.random(),
      }
    } finally {
      release()
    }
  }
  const actual = execute(true)
  expect(actual).toEqual(execute(false))
  expect(actual.partial).toEqual({ hp: actual.initialHp, stack: actual.initialShield - 20, damage: 0 })
  expect(actual.after).toEqual({
    hp: actual.initialHp - 10,
    marks: [{ id: 'mark_shanghaizengjia', stack: 100 }],
    damage: 10,
  })
  expect(actual.power).toBe(140)
  expect(actual.remaining).toBe(0)
})

it('pins every source definition used by the native graph and handwritten legacy recipe', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/water-shield-content.json', import.meta.url), 'utf8'),
  )
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      )
    return value
  }
  const graph = createOfficialWaterShieldContent()
  expect(manifest.records.map((record: { id: string }) => record.id).sort()).toEqual(
    [...graph.effects, ...graph.marks].map(value => value.id).sort(),
  )
  for (const record of manifest.records) {
    const source = [...skills, ...effects, ...marks].find((entry: { id: string }) => entry.id === record.id)
    expect(record.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(source)))
        .digest('hex'),
    )
  }
})
