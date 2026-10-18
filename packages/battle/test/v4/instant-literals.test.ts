import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedInstantLiteralEffects,
  defineNativeEffect,
  BaseMark,
  SkillInstance,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  PhaseState,
  type BattleMessage,
  AddMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  BattleMessageType,
  setGlobalLogger,
  type Battle,
  type effectId,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

interface RecordEntry {
  id: keyof typeof generatedInstantLiteralEffects
  sourceFile: string
  definitionSha256: string
  status: string
  recipe: {
    action: 'heal' | 'addRage'
    target: 'self' | 'opponent'
    value: number
    triggers: ('OnHit' | 'OnMiss' | 'TurnEnd')[]
  }
}
const ledger = JSON.parse(
  readFileSync(new URL('../../../../docs/v4/validation/instant-literals-candidates.json', import.meta.url), 'utf8'),
) as { records: RecordEntry[] }
const records = ledger.records.filter(record => record.status === 'generated-candidate')
const definitions = new Map<string, unknown>()
for (const record of records) {
  const file = new URL(`../../../../${record.sourceFile}`, import.meta.url)
  for (const entry of parse(readFileSync(file, 'utf8'), { merge: true })) definitions.set(entry.id, entry)
}
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'inactive',
  'wrong-skill',
  'late-owner',
  'late-opponent',
  'cancel',
  'modify',
  'fainted',
  'full',
] as const
function run(
  record: RecordEntry,
  native: boolean,
  kind: 'skill' | 'mark',
  trigger: RecordEntry['recipe']['triggers'][number],
  variant: (typeof variants)[number],
) {
  const effect = native ? generatedInstantLiteralEffects[record.id] : EffectParser.parse(definitions.get(record.id))
  const f = makeScenario(261)
  const { battle, a, b } = f
  battles.push(battle)
  const owner = a.activePet,
    skill = owner.skills[0]
  for (const pet of [...a.team, ...b.team])
    pet.currentHp = variant === 'full' ? pet.stat.maxHp : variant === 'fainted' ? 0 : 10
  a.currentRage = b.currentRage = variant === 'full' ? 100 : 50
  const source =
    kind === 'skill'
      ? skill
      : (() => {
          const base = new BaseMark('fixture/instant-source' as baseMarkId, [], f.debuff.config)
          battle.addMark(
            new AddMarkContext(new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill), owner, base),
          )
          return owner.marks.find(mark => mark.base === base)!
        })()
  source.effects.push(effect)
  if (variant === 'inactive') a.activePet = a.team[1]
  const events: unknown[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/instant-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeHeal, EffectTrigger.OnRageGain],
      when: context =>
        context.trigger !== EffectTrigger.BeforeEffect ||
        (context.parent instanceof EffectContext && context.parent.effect?.id === record.id),
      apply(context) {
        if (context.trigger === EffectTrigger.BeforeEffect && context.parent instanceof EffectContext) {
          if (variant === 'cancel') context.parent.available = false
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'late-opponent') b.activePet = b.team[1]
        }
        if (context.trigger === EffectTrigger.OnBeforeHeal || context.trigger === EffectTrigger.OnRageGain) {
          events.push({
            hook: context.trigger,
            value: context.parent.value ?? ('baseHeal' in context.parent ? context.parent.baseHeal : undefined),
            target: context.parent.target.id,
          })
          if (variant === 'modify') context.parent.addModified(0, 7)
        }
      },
    }),
  )
  battle.registerListener(message => {
    if ([BattleMessageType.Heal, BattleMessageType.HealFail, BattleMessageType.RageChange].includes(message.type))
      events.push({ type: message.type, data: message.data })
  })
  const parent =
    trigger === 'TurnEnd'
      ? new TurnContext(battle)
      : new UseSkillContext(
          new TurnContext(battle),
          a,
          owner,
          AttackTargetOpinion.opponent,
          variant === 'wrong-skill' ? b.activePet.skills[0] : skill,
        )
  battle.applyEffects(parent, EffectTrigger[trigger], source)
  return {
    hp: [...a.team, ...b.team].map(pet => pet.currentHp),
    rage: [a.currentRage, b.currentRage],
    events,
    nextRandom: battle.random(),
  }
}
for (const record of records)
  for (const trigger of record.recipe.triggers)
    for (const kind of ['skill', 'mark'] as const) {
      it.each(variants)(`${record.id} ${trigger}/${kind} matches YAML for %s`, variant => {
        const actual = run(record, true, kind, trigger, variant)
        expect(actual).toEqual(run(record, false, kind, trigger, variant))
        if (variant === 'normal') {
          if (record.recipe.action === 'heal') expect(actual.hp[0]).toBe(10 + record.recipe.value)
          else
            expect(actual.rage).toEqual(
              record.recipe.target === 'self' ? [50 + record.recipe.value, 50] : [50, 50 + record.recipe.value],
            )
          expect(actual.events.length).toBeGreaterThan(0)
        }
      })
    }
it('covers exactly the emitted IDs and pins current source definitions', () => {
  expect(records.map(record => record.id).sort()).toEqual(Object.keys(generatedInstantLiteralEffects).sort())
  expect(generatedInstantLiteralEffects).not.toHaveProperty('effect_skill_heal_self_90_hp')
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
  for (const record of records)
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definitions.get(record.id))))
        .digest('hex'),
    ).toBe(record.definitionSha256)
})

// Exercise the real selection/skill/turn lifecycle, not synthetic effect dispatch.
async function fullBattle(record: RecordEntry, native: boolean, checkpoint: boolean, miss = false) {
  const f = makeScenario(262)
  let battle = f.battle
  battles.push(battle)
  const effect = native ? generatedInstantLiteralEffects[record.id] : EffectParser.parse(definitions.get(record.id))
  const owner = f.a.activePet
  owner.currentHp = 150
  const oldSkill = owner.skills[0]
  const skill = new SkillInstance(oldSkill.base, { sureHit: !miss, accuracy: miss ? 0 : 100 })
  skill.effects.splice(0)
  skill.setOwner(owner)
  owner.skills.splice(0, 1, skill)
  battle.skillMap.delete(oldSkill.id)
  battle.skillMap.set(skill.id, skill)
  const turnEnd = record.recipe.triggers.includes('TurnEnd')
  const mark = new BaseMark('fixture/instant-persistent' as baseMarkId, [effect], {
    ...f.debuff.config,
    persistent: true,
    keepOnSwitchOut: true,
  })
  if (!turnEnd) skill.effects.push(effect)
  const catalog = () => {
    const result = new SnapshotCatalog('instant-literals-game/1')
    result.registerEffect(effect.id, effect)
    result.registerContent(mark.id, mark)
    for (const pet of [...f.a.team, ...f.b.team])
      for (const source of pet.skills)
        for (const item of [...source.base.effects, ...source.effects]) result.registerEffect(item.id, item)
    for (const item of f.debuff.effects) result.registerEffect(item.id, item)
    return result
  }
  const trace: unknown[] = []
  let applications = 0
  const observe = (current: Battle) =>
    current.registerListener(message => {
      if (message.type === BattleMessageType.EffectApply && message.data.effect === record.id) applications++
      if ([BattleMessageType.EffectApplyFail, BattleMessageType.Error].includes(message.type))
        throw new Error('Full-game candidate emitted an execution error')
      // Instance IDs are random; state and event ordering are compared without them.
      trace.push(message.type)
      if (message.type === BattleMessageType.TurnEnd)
        trace.push({
          turn: current.currentTurn,
          hp: [...current.playerA.team, ...current.playerB.team].map(pet => pet.currentHp),
          rage: [current.playerA.currentRage, current.playerB.currentRage],
          active: [current.playerA.activePet.id, current.playerB.activePet.id],
        })
    })
  observe(battle)
  const waitForTurn = (current: Battle, turn: number) =>
    new Promise<void>(resolve => {
      const listener = (message: BattleMessage) => {
        if (message.type === BattleMessageType.TurnAction && current.currentTurn === turn) {
          current.unregisterListener(listener)
          resolve()
        }
      }
      current.registerListener(listener)
    })
  const submit = (current: Battle, id: Battle['playerA']['id'], type: 'use-skill' | 'switch-pet' | 'do-nothing') => {
    const choice = current.getAvailableSelection(id).find(selection => selection.type === type)
    if (!choice || !current.setSelection(choice)) throw new Error('Candidate game selection rejected')
  }
  const chooseTurn = (current: Battle) => {
    if (current.currentTurn > 8) throw new Error('Candidate game exceeded turn bound')
    submit(current, current.playerA.id, current.currentTurn === 2 ? 'switch-pet' : 'use-skill')
    submit(current, current.playerB.id, 'use-skill')
  }
  const ready = waitForTurn(battle, 0)
  let run = battle.startBattle().catch(error => {
    if (error.message !== 'Battle cancelled') throw error
  })
  await ready
  if (turnEnd)
    battle.addMark(
      new AddMarkContext(new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill), owner, mark),
    )
  const second = waitForTurn(battle, 1)
  chooseTurn(battle)
  await second
  expect(applications).toBe(1)
  if (checkpoint) {
    const data = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog())))
    await battle.cleanup()
    await run
    battle = restoreBattle(data, catalog())
    battles.push(battle)
    observe(battle)
  }
  battle.registerListener(message => {
    if (message.type === BattleMessageType.TurnAction) chooseTurn(battle)
    if (message.type === BattleMessageType.ForcedSwitch)
      for (const id of message.data.player) submit(battle, id, 'switch-pet')
    if (message.type === BattleMessageType.FaintSwitch) submit(battle, message.data.player, 'do-nothing')
  })
  if (checkpoint) run = battle.resumeBattle()
  chooseTurn(battle)
  await run
  expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toEqual([])
  expect(battle.victor?.id).toBe('A')
  expect(applications).toBe(2)
  const result = {
    trace,
    applications,
    winner: battle.victor?.id,
    turn: battle.currentTurn,
    hp: [...battle.playerA.team, ...battle.playerB.team].map(pet => pet.currentHp),
    rage: [battle.playerA.currentRage, battle.playerB.currentRage],
    nextRandom: battle.random(),
  }
  await battle.cleanup()
  return result
}
const gameModes = [
  { label: 'native uninterrupted', native: true, checkpoint: false },
  { label: 'YAML restored', native: false, checkpoint: true },
  { label: 'native restored', native: true, checkpoint: true },
] as const
for (const record of records) {
  it.each(gameModes)(`${record.id} completes a real game identically: $label`, async mode => {
    const expected = await fullBattle(record, false, false)
    expect(await fullBattle(record, mode.native, mode.checkpoint)).toEqual(expected)
  })
}
it.each(gameModes)('preserves real missed skills: $label', async mode => {
  const record = records.find(item => item.recipe.triggers.includes('OnMiss'))!
  const expected = await fullBattle(record, false, false, true)
  expect(await fullBattle(record, mode.native, mode.checkpoint, true)).toEqual(expected)
})
