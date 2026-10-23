import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser, MarkParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  defineNativeEffect,
  BaseMark,
  Pet,
  EffectContext,
  EffectTrigger,
  TurnContext,
  RemoveMarkPhase,
  GameRng,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { createCurseMarkApplication } from '@arcadia-eternity/data-pack-base/native'

const id = 'effect_mark_curse_add_random_status'
const load = (name: string): { id: string; tags?: string[]; effect?: string[] }[] =>
  parse(readFileSync(new URL(`../../../../packs/base/data/${name}.yaml`, import.meta.url), 'utf8'), { merge: true })
const definition = load('effect_mark').find(d => d.id === id)!
const oracle = EffectParser.parse(definition)
const definitions = load('mark')
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
const variants = [
  'normal',
  'empty',
  'singleton',
  'reverse',
  'late-catalog',
  'late-add',
  'late-replace',
  'late-tags',
  'late-owner',
  'cancel-effect',
  'cancel-add',
  'modify',
  'suppressed',
  'inactive',
  'indestructible',
  'repeat',
  'existing',
] as const
function run(native: boolean, variant: (typeof variants)[number], seed: number) {
  const { battle, a, b, debuff } = makeScenario(seed)
  battles.push(battle)
  const catalog = new Map(definitions.map(d => [d.id, MarkParser.parse({ ...d, effect: [] })]))
  const statusIds = [...catalog.values()].filter(m => m.tags.includes('status')).map(m => m.id)
  const originalOrder = [...statusIds]
  if (variant === 'empty' || variant === 'singleton')
    for (const key of statusIds.slice(variant === 'singleton' ? 1 : 0)) catalog.delete(key)
  if (variant === 'reverse') {
    const entries = [...catalog.entries()].reverse()
    catalog.clear()
    for (const [key, value] of entries) catalog.set(key, value)
  }
  const source = new BaseMark('fixture/curse' as baseMarkId, [native ? createCurseMarkApplication(catalog) : oracle], {
    ...debuff.config,
    destroyable: variant !== 'indestructible',
  }).createInstance()
  source.owner = a.activePet
  a.activePet.marks.push(source)
  if (variant === 'suppressed') source.isSuppressed = true
  if (variant === 'inactive') source.isActive = false
  const repo = DataRepository.getInstance(),
    previous = new Map(repo.marks)
  const sync = () => {
    repo.marks.clear()
    for (const mark of catalog.values()) repo.marks.set(mark.id, mark)
  }
  sync()
  if (variant === 'existing') {
    const chosen = new GameRng(seed).shuffle(originalOrder)[0]
    const existing = catalog.get(chosen)!.createInstance()
    existing.owner = a.activePet
    a.activePet.marks.push(existing)
  }
  const inputs: { id: string; target: string; stack: number; duration: number; sourceActive: boolean }[] = []
  b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/curse-hook' as effectId,
      triggers: [EffectTrigger.BeforeEffect, EffectTrigger.OnBeforeAddMark],
      when: ctx =>
        ctx.trigger !== EffectTrigger.BeforeEffect ||
        (ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id),
      apply(ctx) {
        if (ctx.trigger === EffectTrigger.BeforeEffect && ctx.parent instanceof EffectContext) {
          if (variant === 'late-owner') source.owner = b.activePet
          if (variant === 'cancel-effect') ctx.parent.available = false
          if (variant === 'late-catalog') {
            catalog.delete(statusIds[0])
            sync()
          }
          if (variant === 'late-tags') catalog.get(statusIds[0])!.tags.splice(0)
          if (variant === 'late-add') {
            const added = new BaseMark('fixture/new-status' as baseMarkId, [], debuff.config, ['status'])
            catalog.clear()
            catalog.set(added.id, added)
            sync()
          }
          if (variant === 'late-replace') {
            const replaced = catalog.get(statusIds[0])!
            catalog.clear()
            catalog.set(replaced.id, new BaseMark(replaced.id, [], { ...replaced.config, duration: 17 }, ['status']))
            sync()
          }
        }
        if (ctx.trigger === EffectTrigger.OnBeforeAddMark) {
          inputs.push({
            id: ctx.parent.baseMark.id,
            target: ctx.parent.target instanceof Pet ? ctx.parent.target.id : 'battle',
            stack: ctx.parent.stack,
            duration: ctx.parent.duration,
            sourceActive: source.isActive,
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
    const remove = () => {
      const phase = new RemoveMarkPhase(battle, new TurnContext(battle), source)
      phase.initialize()
      phase.execute()
    }
    remove()
    if (variant === 'repeat') remove()
    return {
      inputs,
      source: { active: source.isActive, owner: source.owner instanceof Pet ? source.owner.id : null },
      marks: [...a.team, ...b.team].flatMap(p =>
        p.marks
          .filter(m => m !== source)
          .map(m => ({
            id: m.baseId,
            owner: p.id,
            stack: m.stack,
            duration: m.duration,
          })),
      ),
      eligible: [...catalog.values()].filter(m => m.tags.includes('status')).map(m => m.id),
      nextRandom: battle.random(),
    }
  } finally {
    repo.marks.clear()
    for (const [key, value] of previous) repo.marks.set(key, value)
  }
}
it.each(variants)('curse random catalog: %s', variant => {
  for (const seed of [28, 269, 2311]) {
    const actual = run(true, variant, seed)
    expect(actual).toEqual(run(false, variant, seed))
    const admitted = !['cancel-effect', 'suppressed', 'inactive', 'indestructible'].includes(variant)
    const rng = new GameRng(seed)
    const chosen = admitted ? rng.shuffle(actual.eligible)[0] : undefined
    expect(actual.nextRandom).toBe(rng.next())
    expect(actual.inputs).toHaveLength(chosen ? 1 : 0)
    if (chosen) {
      expect(actual.inputs[0].id).toBe(chosen)
      expect(actual.inputs[0].target).toBe(variant === 'late-owner' ? 'B/lead' : 'A/lead')
      expect(actual.inputs[0].sourceActive).toBe(true)
      if (variant === 'late-replace') expect(actual.inputs[0].duration).toBe(17)
      if (variant !== 'cancel-add') {
        expect(actual.marks).toHaveLength(1)
        expect(actual.marks[0].id).toBe(chosen)
        expect(actual.marks[0].owner).toBe(actual.inputs[0].target)
      }
    }
    if (!chosen || variant === 'cancel-add') expect(actual.marks).toEqual([])
  }
})
it('pins the complete ordered catalog and the unmodified source', () => {
  const record = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/validation/curse-mark-application.json', import.meta.url), 'utf8'),
  )
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  expect(record.definitionSha256).toBe(hash(definition))
  expect(record.catalogSha256).toBe(hash(definitions))
  expect(record.dependencies).toEqual(
    definitions
      .filter(d => d.tags?.includes('status'))
      .map(d => ({
        id: d.id,
        definitionSha256: hash(d),
        effectIds: d.effect ?? [],
      })),
  )
  expect(record.dependencies).toHaveLength(9)
})

it('selects every official status with deterministic RNG and removes the source after creation', () => {
  const ids = definitions.filter(d => d.tags?.includes('status')).map(d => d.id)
  const seeds = new Map<string, number>()
  for (let seed = 1; seed <= 10000 && seeds.size < ids.length; seed++)
    seeds.set(new GameRng(seed).shuffle(ids)[0], seed)
  expect([...seeds.keys()].sort()).toEqual([...ids].sort())
  for (const [chosen, seed] of seeds) {
    const actual = run(true, 'normal', seed)
    expect(actual).toEqual(run(false, 'normal', seed))
    expect(actual.inputs[0].id).toBe(chosen)
    expect(actual.source).toEqual({ active: false, owner: null })
  }
})
