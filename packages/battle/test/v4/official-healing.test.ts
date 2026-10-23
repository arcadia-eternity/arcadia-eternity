import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  defineNativeEffect,
  EffectTrigger,
  EffectContext,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  BattleMessageType,
  setGlobalLogger,
  type Battle,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { officialHealingEffects } from '@arcadia-eternity/data-pack-base/native'

const definitions = parse(
  readFileSync(new URL('./fixtures/effect-regression/effect_skill.yaml', import.meta.url), 'utf8'),
  { merge: true },
)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
type Variant =
  | 'normal'
  | 'full'
  | 'fainted'
  | 'wrong-skill'
  | 'cancel-effect'
  | 'cancel-heal'
  | 'late-max-hp'
  | 'late-owner'
function run(id: keyof typeof officialHealingEffects, native: boolean, variant: Variant) {
  const { battle, a, b } = makeScenario(201)
  battles.push(battle)
  const pet = a.activePet
  const source = pet.skills[0]
  const effect = native
    ? officialHealingEffects[id]
    : EffectParser.parse(definitions.find((entry: { id: string }) => entry.id === id))
  source.effects.push(effect)
  pet.attributeSystem.updateBaseValue('maxHp', 401)
  pet.currentHp = variant === 'full' ? 401 : variant === 'fainted' ? 0 : 11
  const events: unknown[] = []
  const hook = defineNativeEffect({
    id: 'fixture/healing-hook' as effectId,
    triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeHeal, EffectTrigger.OnHeal],
    when: ctx =>
      ctx.trigger !== EffectTrigger.BeforeEffect ||
      (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
    apply(ctx) {
      if (
        ctx.trigger === EffectTrigger.BeforeEffect &&
        ctx.parent instanceof EffectContext &&
        ctx.parent.effect?.id === id
      ) {
        if (variant === 'cancel-effect') ctx.parent.available = false
        if (variant === 'late-max-hp') pet.attributeSystem.updateBaseValue('maxHp', 407)
        if (variant === 'late-owner') source.owner = a.team[1]
      }
      if (ctx.trigger === EffectTrigger.OnBeforeHeal) {
        events.push({ hook: 'before', amount: ctx.parent.value })
        if (variant === 'cancel-heal') ctx.parent.available = false
      }
      if (ctx.trigger === EffectTrigger.OnHeal) events.push({ hook: 'after', result: ctx.parent.healResult })
    },
  })
  source.effects.push(hook)
  battle.registerListener(message => {
    if ([BattleMessageType.Heal, BattleMessageType.HealFail].includes(message.type))
      events.push({ type: message.type, data: message.data })
  })
  const use = new UseSkillContext(
    new TurnContext(battle),
    a,
    pet,
    AttackTargetOpinion.opponent,
    variant === 'wrong-skill' ? b.activePet.skills[0] : source,
  )
  battle.applyEffects(use, EffectTrigger.OnHit, source)
  return {
    hp: pet.currentHp,
    teamHp: [...a.team, ...b.team].map(member => member.currentHp),
    events,
    nextRandom: battle.random(),
  }
}
for (const id of Object.keys(officialHealingEffects) as (keyof typeof officialHealingEffects)[]) {
  it.each<Variant>([
    'normal',
    'full',
    'fainted',
    'wrong-skill',
    'cancel-effect',
    'cancel-heal',
    'late-max-hp',
    'late-owner',
  ])(`${id} matches current YAML for %s`, variant => {
    const actual = run(id, true, variant)
    expect(actual).toEqual(run(id, false, variant))
    if (variant === 'normal') {
      const amounts = {
        effect_skill_heal_self_90_hp: 90,
        effect_heal_self_half: 200,
        effect_heal_self_onethird: 133,
        effect_skill_heal_self_quarter: 100,
      }
      expect(actual.hp).toBe(11 + amounts[id])
      expect(actual.events).toContainEqual({ hook: 'before', amount: amounts[id] })
    }
  })
}

it('pins every handwritten candidate to its current production definition', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/official-healing-candidates.json', import.meta.url), 'utf8'),
  )
  expect(manifest.records.map((record: { id: string }) => record.id).sort()).toEqual(
    Object.keys(officialHealingEffects).sort(),
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
  for (const record of manifest.records) {
    const definition = definitions.find((entry: { id: string }) => entry.id === record.id)
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definition)))
        .digest('hex'),
    ).toBe(record.definitionSha256)
  }
})
