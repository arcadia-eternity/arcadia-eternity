import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedDamageModifierEffects,
  MarkInstanceImpl,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  parameterAddress,
  createGeneratedDamageModifierEffects,
  effectAuthoring,
  BaseSkill,
  SkillInstance,
  Category,
  BattleMessageType,
  PhaseState,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  type BattleMessage,
  AddMarkContext,
  BaseMark,
  DamageContext,
  DamageType,
  Element,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
interface Entry {
  id: keyof typeof generatedDamageModifierEffects
  sourceFile: string
  definitionSha256: string
  status: string
  recipe: {
    triggers: ('OnBeforeCalculateDamage' | 'OnDamage')[]
    consumesStacks?: number
    tags?: string[]
    parameters?: { name: string; value: number; configId?: string }[]
  }
}
interface Definition {
  id: string
  condition: unknown
  apply: unknown
}
const manifest: { records: (Omit<Entry, 'recipe'> & { recipe: Entry['recipe'] | null })[] } = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/damage-modifiers-candidates.json', import.meta.url), 'utf8'),
)
const records = manifest.records.filter((r): r is Entry => r.status === 'generated-candidate' && r.recipe !== null)
const files = new Map<string, Definition[]>()
for (const r of records)
  if (!files.has(r.sourceFile))
    files.set(
      r.sourceFile,
      parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true }),
    )
// Parse once before constructing battles: raw parameters belong to the oracle's global content registry.
const oracles = new Map(
  records.map(r => [r.id, EffectParser.parse(files.get(r.sourceFile)!.find(d => d.id === r.id)!)]),
)
function parameterKey(r: Entry, battle: Battle, native: boolean, name: string) {
  if (native) return parameterAddress(r.id, 'parameters', name)
  const p = r.recipe.parameters!.find(p => p.name === name)!
  if (p.configId) return `${r.id}.${p.configId}`
  const keys = battle.configSystem.getRegisteredKeys().filter(key => key.startsWith(`${r.id}.`))
  if (keys.length !== 1) throw new Error('Anonymous parameter oracle needs an unambiguous key')
  return keys[0]
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
function objects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objects)
  if (value && typeof value === 'object')
    return [value as Record<string, unknown>, ...Object.values(value).flatMap(objects)]
  return []
}
const variants = [
  'normal',
  'missing-marks',
  'wrong-role',
  'late-values',
  'late-owner',
  'late-opponent',
  'cancel',
  'alternate-type',
  'phase',
] as const
const parameterVariants = [
  'config-zero',
  'config-negative',
  'config-fractional',
  'late-config',
  'foreign-config',
  'removed-config',
] as const
const consumptionVariants = ['last-stack', 'exhaust-before', 'suppressed', 'repeat'] as const
type Variant = (typeof variants)[number] | (typeof parameterVariants)[number] | (typeof consumptionVariants)[number]
function run(
  r: Entry,
  native: boolean,
  kind: 'skill' | 'mark',
  variant: Variant,
  trigger: EffectTrigger.OnDamage | EffectTrigger.OnBeforeCalculateDamage,
) {
  const f = makeScenario(216),
    { battle, a, b } = f
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const skill of p.skills) skill.effects.splice(0)
  const d = files.get(r.sourceFile)!.find(d => d.id === r.id)!
  const nodes = objects(d.condition)
  const defensive = nodes.some(n => n.type === 'selfBeDamaged' || n.type === 'checkSelf')
  const owner = defensive ? b.activePet : a.activePet
  const skill = owner.skills[0],
    attacker = a.activePet,
    target = b.activePet
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const add = (pet: typeof owner, id: string, stack = 2) => {
    const base = new BaseMark(id as baseMarkId, [], { ...f.debuff.config, maxStacks: 20, stackable: true })
    battle.addMark(new AddMarkContext(setup, pet, base, stack))
    return pet.marks.find(m => m.base === base)!
  }
  for (const pet of [...a.team, ...b.team]) {
    pet.attributeSystem.updateBaseValue('maxHp', 801)
    pet.currentHp = 100
    pet.lastSkillUsedTimes = 3
  }
  if (nodes.some(n => n.operator === '==')) for (const pet of [...a.team, ...b.team]) pet.currentHp = 801
  const ids = new Set(
    objects(d).flatMap(n =>
      typeof n.baseId === 'string'
        ? [n.baseId]
        : n.type === 'same' && typeof n.value === 'string' && n.value.startsWith('mark_')
          ? [n.value]
          : [],
    ),
  )
  if (variant !== 'missing-marks')
    for (const id of ids) {
      add(owner, id, 3)
      add(battle.getOpponent(owner.owner!).activePet, id, 3)
    }
  // A tag-existence condition is represented by a real mark with that tag.
  if (variant !== 'missing-marks')
    for (const n of nodes)
      if (n.type === 'contain' && typeof n.tag === 'string') add(owner, 'fixture/tag').tags.push(n.tag)
  const source =
    kind === 'skill' ? skill : add(owner, 'fixture/modifier', variant === 'last-stack' || variant === 'repeat' ? 1 : 3)
  if (source instanceof MarkInstanceImpl && variant === 'suppressed') source.isSuppressed = true
  const effect = native ? generatedDamageModifierEffects[r.id] : oracles.get(r.id)!
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  source.effects.push(effect)
  const changeConfig = (amount: number, foreign = false) => {
    for (const p of r.recipe.parameters ?? []) {
      const modifier = new ConfigModifier(
        ConfigDurationType.binding,
        'fixture/config',
        amount,
        ConfigModifierType.override,
        0,
      )
      const scope = foreign ? owner.owner!.team[1].skills[0] : source
      const cleanup = native
        ? effectAuthoring
            .effectParameters(effect)
            .modify(
              battle.configSystem,
              p.configId ? `${r.id}.${p.configId}` : parameterKey(r, battle, true, p.name),
              modifier,
              scope,
            )
        : battle.configSystem.addScopedConfigModifier(parameterKey(r, battle, false, p.name), modifier, scope)
      if (variant === 'removed-config') cleanup()
    }
  }
  if (variant === 'config-zero') changeConfig(0)
  if (variant === 'config-negative') changeConfig(-0.375)
  if (variant === 'config-fractional' || variant === 'removed-config') changeConfig(0.375)
  if (variant === 'foreign-config') changeConfig(1000, true)
  const trace: unknown[] = []
  const hook = defineNativeEffect({
    id: 'fixture/modifier-hook' as effectId,
    triggers: [EffectTrigger.BeforeEffect, EffectTrigger.AfterEffect],
    when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === r.id,
    apply: ctx => {
      if (!(ctx.parent instanceof EffectContext)) return
      if (ctx.trigger === EffectTrigger.AfterEffect) {
        trace.push({ success: ctx.parent.success })
        return
      }
      trace.push('admitted')
      if (variant === 'exhaust-before' && source instanceof MarkInstanceImpl)
        source.consumeStack(ctx.parent, source.stack)
      if (variant === 'late-config') changeConfig(0.375)
      if (variant === 'cancel') ctx.parent.available = false
      if (variant === 'late-values') {
        owner.currentHp = 801
        owner.attributeSystem.updateBaseValue('maxHp', 1003)
        owner.lastSkillUsedTimes = 5
        if (kind === 'mark') Reflect.set(source, 'stack', 5)
        for (const m of owner.marks) if (ids.has(m.baseId)) m.stack = 7
      }
      if (variant === 'late-owner') source.owner = owner.owner!.team[1]
      if (variant === 'late-opponent')
        battle.getOpponent(owner.owner!).activePet = battle.getOpponent(owner.owner!).team[1]
    },
  })
  add(owner, 'fixture/hook').effects.push(hook)
  if (variant === 'wrong-role') source.owner = owner.owner!.team[1]
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    attacker,
    AttackTargetOpinion.opponent,
    attacker.skills[0],
  )
  const damage = new DamageContext(use, attacker, target, 83)
  const special = nodes.some(n => n.value === 'Special')
  damage.damageType =
    variant === 'alternate-type'
      ? special
        ? DamageType.Physical
        : DamageType.Special
      : special
        ? DamageType.Special
        : DamageType.Physical
  damage.element = Element.Light
  if (variant === 'phase') target.damage(damage)
  else battle.applyEffects(damage, trigger, source)
  if (variant === 'repeat') battle.applyEffects(damage, trigger, source)
  return {
    trace,
    modified: damage.modified,
    result: damage.damageResult,
    source:
      source instanceof MarkInstanceImpl
        ? { stack: source.stack, active: source.isActive, present: owner.marks.includes(source) }
        : null,
    hp: [a.activePet.currentHp, b.activePet.currentHp],
    nextRandom: battle.random(),
  }
}
for (const r of records)
  for (const kind of ['skill', 'mark'] as const)
    for (const name of r.recipe.triggers) {
      const trigger = EffectTrigger[name]
      it.each([
        ...variants,
        ...(r.recipe.parameters ? parameterVariants : []),
        ...(r.recipe.consumesStacks && kind === 'mark' ? consumptionVariants : []),
      ])(`${r.id} ${kind} ${name}: %s`, variant => {
        const actual = run(r, true, kind, variant, trigger)
        expect(actual).toEqual(run(r, false, kind, variant, trigger))
        expect(actual.trace).not.toContainEqual({ success: false })
        if (r.recipe.consumesStacks && kind === 'mark') {
          if (variant === 'normal') expect(actual.source?.stack).toBe(3 - r.recipe.consumesStacks)
          if (variant === 'cancel') expect(actual.source?.stack).toBe(3)
          if (variant === 'last-stack' || variant === 'repeat') {
            expect(actual.source).toEqual({ stack: 0, active: false, present: false })
            expect(actual.trace.filter(x => x === 'admitted')).toHaveLength(1)
            expect(actual.modified.some(n => n !== 0)).toBe(true)
          }
          if (variant === 'exhaust-before' || variant === 'suppressed') expect(actual.modified).toEqual([0, 0])
        }
        if (variant === 'normal' && kind === 'mark') {
          expect(actual.trace).toContain('admitted')
          expect(actual.modified.some(n => n !== 0)).toBe(true)
        }
      })
    }
it('pins every emitted ID and definition to current YAML and excludes the handwritten override', () => {
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
  expect(records.map(r => r.id).sort()).toEqual(Object.keys(generatedDamageModifierEffects).sort())
  expect(generatedDamageModifierEffects).not.toHaveProperty('effect_mark_damage_boost_based_on_hp_percentage')
  for (const r of records) {
    expect(generatedDamageModifierEffects[r.id].tags).toEqual(r.recipe.tags ?? [])
    expect(generatedDamageModifierEffects[r.id].consumesStacks).toBe(r.recipe.consumesStacks)
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(files.get(r.sourceFile)!.find(d => d.id === r.id))))
        .digest('hex'),
    ).toBe(r.definitionSha256)
  }
})

async function game(r: Entry, native: boolean, checkpoint: boolean) {
  const f = makeScenario(217)
  let battle = f.battle
  battles.push(battle)
  const definition = files.get(r.sourceFile)!.find(d => d.id === r.id)!
  const nodes = objects(definition.condition)
  const effect = native ? createGeneratedDamageModifierEffects()[r.id] : oracles.get(r.id)!
  if (native) effectAuthoring.effectParameters(effect).install(battle.configSystem)
  for (const p of r.recipe.parameters ?? [])
    battle.configSystem.set(parameterKey(r, battle, native, p.name), p.value * 0.5)
  const allPets = [...f.a.team, ...f.b.team]
  const originalEffects = allPets.flatMap(p => p.baseSkills.flatMap(s => s.effects))
  for (const pet of allPets) {
    pet.attributeSystem.updateBaseValue('maxHp', 801)
    pet.currentHp = nodes.some(n => n.operator === '==') ? 801 : 100
    pet.lastSkillUsedTimes = 3
    const base = new BaseSkill(
      `fixture/damage-${pet.id}` as BaseSkill['id'],
      nodes.some(n => n.value === 'Special') ? Category.Special : Category.Physical,
      Element.Light,
      pet === f.a.team[1] ? 1000 : 30,
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
  const catalog = (fresh: boolean) => {
    const c = new SnapshotCatalog(`damage-modifier/${r.id}`)
    for (const e of originalEffects) c.registerEffect(e.id, e)
    for (const e of f.debuff.effects) c.registerEffect(e.id, e)
    const registered = fresh ? (native ? createGeneratedDamageModifierEffects()[r.id] : oracles.get(r.id)!) : effect
    if (native) effectAuthoring.registerEffect(c, registered)
    else c.registerEffect(registered.id, registered)
    return c
  }
  const trace: unknown[] = []
  let applications = 0
  const observe = (current: Battle) =>
    current.registerListener(message => {
      if (message.type === BattleMessageType.EffectApply && message.data.effect === r.id) applications++
      if ([BattleMessageType.EffectApplyFail, BattleMessageType.Error].includes(message.type))
        throw new Error('Damage candidate game failed')
      trace.push(message.type)
      if (message.type === BattleMessageType.TurnEnd)
        trace.push({
          turn: current.currentTurn,
          hp: [...current.playerA.team, ...current.playerB.team].map(p => p.currentHp),
        })
    })
  const submit = (current: Battle, id: Battle['playerA']['id'], type: 'switch-pet' | 'use-skill' | 'do-nothing') => {
    const selection = current.getAvailableSelection(id).find(s => s.type === type)
    if (!selection || !current.setSelection(selection)) throw new Error('Damage game selection rejected')
  }
  const forced = (current: Battle) =>
    current.registerListener(m => {
      if (m.type === BattleMessageType.ForcedSwitch) for (const id of m.data.player) submit(current, id, 'switch-pet')
      if (m.type === BattleMessageType.FaintSwitch) submit(current, m.data.player, 'do-nothing')
    })
  const ready = (current: Battle, turn: number) =>
    new Promise<void>(resolve => {
      const listener = (m: BattleMessage) => {
        if (m.type === BattleMessageType.TurnAction && current.currentTurn === turn) {
          current.unregisterListener(listener)
          resolve()
        }
      }
      current.registerListener(listener)
    })
  const choose = (current: Battle) => {
    if (current.currentTurn > 12) throw new Error('Damage game exceeded turn bound')
    for (const p of [current.playerA, current.playerB])
      submit(
        current,
        p.id,
        current.currentTurn === 2 && p === current.playerA && p.activePet === p.team[0] ? 'switch-pet' : 'use-skill',
      )
  }
  observe(battle)
  forced(battle)
  const first = ready(battle, 0)
  let run = battle.startBattle().catch(error => {
    if (error.message !== 'Battle cancelled') throw error
  })
  await first
  for (const pet of allPets) {
    const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, pet.skills[0])
    const ids = new Set(
      objects(definition).flatMap(n =>
        typeof n.baseId === 'string'
          ? [n.baseId]
          : n.type === 'same' && typeof n.value === 'string' && n.value.startsWith('mark_')
            ? [n.value]
            : [],
      ),
    )
    for (const id of ids)
      battle.addMark(
        new AddMarkContext(
          setup,
          pet,
          new BaseMark(id as baseMarkId, [], {
            ...f.debuff.config,
            maxStacks: 20,
            persistent: true,
            keepOnSwitchOut: true,
          }),
          3,
        ),
      )
    for (const n of nodes)
      if (n.type === 'contain' && typeof n.tag === 'string') {
        const base = new BaseMark(
          'fixture/damage-tag' as baseMarkId,
          [],
          { ...f.debuff.config, persistent: true, keepOnSwitchOut: true },
          [n.tag],
        )
        battle.addMark(new AddMarkContext(setup, pet, base))
      }
    battle.addMark(
      new AddMarkContext(
        setup,
        pet,
        new BaseMark('fixture/damage-source' as baseMarkId, [effect], {
          ...f.debuff.config,
          maxStacks: 20,
          persistent: true,
          keepOnSwitchOut: true,
        }),
        3,
      ),
    )
  }
  const second = ready(battle, 1)
  choose(battle)
  await second
  if (checkpoint) {
    const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog(false))))
    await battle.cleanup()
    await run
    battle = restoreBattle(saved, catalog(true))
    battles.push(battle)
    observe(battle)
    forced(battle)
  }
  battle.registerListener(m => {
    if (m.type === BattleMessageType.TurnAction) choose(battle)
  })
  if (checkpoint) run = battle.resumeBattle()
  choose(battle)
  await run
  expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toEqual([])
  expect(battle.victor).toBeDefined()
  expect(applications).toBeGreaterThan(0)
  const result = {
    trace,
    applications,
    winner: battle.victor?.id,
    turn: battle.currentTurn,
    hp: [...battle.playerA.team, ...battle.playerB.team].map(p => p.currentHp),
    nextRandom: battle.random(),
  }
  await battle.cleanup()
  return result
}
for (const r of records)
  it.each([false, true])(`${r.id}: full game with checkpoint=%s`, async checkpoint => {
    const expected = await game(r, false, false)
    expect(await game(r, true, checkpoint)).toEqual(expected)
  })
