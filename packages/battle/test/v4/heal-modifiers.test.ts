import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  effectAuthoring,
  AddMarkContext,
  BaseMark,
  HealContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  defineNativeEffect,
  setGlobalLogger,
  BattleMessageType,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { officialHealModifierEffects, createOfficialHealModifierEffects } from '@arcadia-eternity/data-pack-base/native'

const definitions = ['effect_mark', 'effect_emblem'].flatMap(file =>
  parse(readFileSync(new URL(`../../../../packs/base/data/${file}.yaml`, import.meta.url), 'utf8'), { merge: true }),
)
const ids = Object.keys(officialHealModifierEffects) as (keyof typeof officialHealModifierEffects)[]
const oracles = new Map(ids.map(id => [id, EffectParser.parse(definitions.find(d => d.id === id))]))
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'wrong-target',
  'late-owner',
  'cancel-effect',
  'cancel-heal',
  'full',
  'fainted',
  'repeat',
] as const
function run(
  id: (typeof ids)[number],
  native: boolean,
  kind: 'skill' | 'mark',
  variant: (typeof variants)[number],
  seed: number,
) {
  const f = makeScenario(seed)
  const { battle, a, b } = f
  battles.push(battle)
  for (const p of [...a.team, ...b.team]) for (const s of p.skills) s.effects.splice(0)
  const pet = a.activePet,
    skill = pet.skills[0]
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const effect = native ? createOfficialHealModifierEffects()[id] : oracles.get(id)!
  let source: typeof skill | (typeof pet.marks)[number] = skill
  if (kind === 'mark') {
    const base = new BaseMark('fixture/heal-modifier' as baseMarkId, [], f.debuff.config)
    battle.addMark(new AddMarkContext(setup, pet, base))
    source = pet.marks.find(m => m.base === base)!
  }
  source.effects.push(effect)
  pet.attributeSystem.updateBaseValue('maxHp', 401)
  pet.currentHp = variant === 'full' ? 401 : variant === 'fainted' ? 0 : 11
  const trace: unknown[] = []
  const observer = defineNativeEffect({
    id: 'fixture/heal-observer' as effectId,
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
        trace.push('admitted')
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'cancel-effect') ctx.parent.available = false
      }
      if (ctx.trigger === EffectTrigger.OnBeforeHeal && variant === 'cancel-heal') ctx.parent.available = false
      if (ctx.trigger === EffectTrigger.OnHeal) trace.push(['after', ctx.parent.healResult])
    },
  })
  b.activePet.skills[0].effects.push(observer)
  battle.registerListener(m => {
    // This runtime message is missing from the public BattleMessage union.
    if ((m.type as BattleMessageType) === BattleMessageType.EffectApplyFail) {
      const data = m.data as unknown as { reason: string; source: string; effect: string }
      expect(data.reason).toBe('disabled')
      expect(data.source).toBe(source.id)
      trace.push([m.type, { ...data, source: 'candidate-source' }])
    } else if ([BattleMessageType.Heal, BattleMessageType.HealFail].includes(m.type)) trace.push([m.type, m.data])
  })
  const target = variant === 'wrong-target' ? b.activePet : pet
  const results: unknown[] = []
  for (let i = 0; i < (variant === 'repeat' ? 3 : 1); i++) {
    const heal = new HealContext(setup, skill, target, 83)
    target.heal(heal)
    results.push({ modified: heal.modified, result: heal.healResult, hp: target.currentHp })
  }
  return { results, trace, nextRandom: battle.random() }
}
for (const id of ids)
  for (const kind of ['skill', 'mark'] as const)
    for (const seed of [201, 202, 203, 204])
      it.each(variants)(`${id} ${kind} seed ${seed}: %s`, variant => {
        expect(run(id, true, kind, variant, seed)).toEqual(run(id, false, kind, variant, seed))
      })
it('exercises both probability outcomes rather than comparing only skipped effects', () => {
  const outcomes = Array.from({ length: 20 }, (_, n) =>
    run('effect_emblem_20percent_double_heal', true, 'mark', 'normal', n).trace.includes('admitted'),
  )
  expect(outcomes).toContain(true)
  expect(outcomes).toContain(false)
})

async function continuation(id: (typeof ids)[number], native: boolean, checkpoint: boolean) {
  const f = makeScenario(201)
  let battle = f.battle
  battles.push(battle)
  const originals = [...f.a.team, ...f.b.team].flatMap(p => p.skills.flatMap(s => [...s.base.effects, ...s.effects]))
  for (const p of [...f.a.team, ...f.b.team]) for (const s of p.skills) s.effects.splice(0)
  const candidate = () => (native ? createOfficialHealModifierEffects()[id] : oracles.get(id)!)
  const effect = candidate()
  const catalog = (fresh: boolean) => {
    const result = new SnapshotCatalog(`heal-modifier/${id}`)
    for (const e of [...originals, ...f.debuff.effects]) result.registerEffect(e.id, e)
    const current = fresh ? candidate() : effect
    if (native) effectAuthoring.registerEffect(result, current)
    else result.registerEffect(current.id, current)
    return result
  }
  const ready = new Promise<void>(resolve =>
    battle.registerListener(m => {
      if (m.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const running = battle.startBattle().catch(error => {
    if (error.message !== 'Battle cancelled') throw error
  })
  await Promise.race([
    ready,
    running.then(() => {
      throw new Error('Battle ended before selection')
    }),
  ])
  const owner = battle.playerA.activePet
  const setup = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, owner.skills[0])
  battle.addMark(
    new AddMarkContext(
      setup,
      owner,
      new BaseMark('fixture/heal-source' as baseMarkId, [effect], { ...f.debuff.config, persistent: true }),
    ),
  )
  const results: unknown[] = []
  const heal = () => {
    const pet = battle.playerA.activePet,
      skill = pet.skills[0]
    pet.currentHp = 11
    const ctx = new HealContext(
      new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill),
      skill,
      pet,
      83,
    )
    pet.heal(ctx)
    results.push({ modified: ctx.modified, amount: ctx.healResult, hp: pet.currentHp })
  }
  heal()
  if (checkpoint) {
    const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog(false))))
    await battle.cleanup()
    await running
    battle = restoreBattle(saved, catalog(true))
    battles.push(battle)
  }
  for (let i = 0; i < 20; i++) heal()
  const result = { results, nextRandom: battle.random() }
  await battle.cleanup()
  await running
  return result
}
for (const id of ids)
  it(`${id} preserves real healing and RNG through fresh-catalog JSON restoration`, async () => {
    const expected = await continuation(id, false, false)
    expect(await continuation(id, true, false)).toEqual(expected)
    expect(await continuation(id, true, true)).toEqual(expected)
    expect(await continuation(id, false, true)).toEqual(expected)
  })

it('pins every candidate to unchanged YAML with no omitted or extra ID', () => {
  const manifest: { records: { id: string; definitionSha256: string }[] } = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/heal-modifiers-candidates.json', import.meta.url), 'utf8'),
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
  expect(manifest.records.map(r => r.id).sort()).toEqual([...ids].sort())
  for (const r of manifest.records)
    expect(
      createHash('sha256')
        .update(JSON.stringify(normalize(definitions.find(d => d.id === r.id))))
        .digest('hex'),
    ).toBe(r.definitionSha256)
})
