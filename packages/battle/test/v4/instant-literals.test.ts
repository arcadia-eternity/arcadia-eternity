import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedInstantLiteralEffects,
  defineNativeEffect,
  BaseMark,
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
