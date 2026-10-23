import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  BattleMessageType,
  Category,
  EffectTrigger,
  Element,
  type baseMarkId,
  type baseSkillId,
} from '@arcadia-eternity/const'
import { AttributeSystem, TurnContext, UseSkillContext, setGlobalLogger, type Battle } from '../../src/v4/index'
import { compileContentPack } from '../../src/v4/content/content-pack'
import { createContentCatalog, type TrustedEffectFactory } from '../../src/v4/content/definition-catalog'
import {
  compileEffect,
  conditions,
  defineEffect,
  effectParameters,
  numberParam,
  ops,
  targets,
} from '../../src/v4/content/authoring'
import input from '../../src/v2/__tests__/fixtures/baseline/official-switch.input.json'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function pack() {
  const data = JSON.parse(
    readFileSync(new URL('../../../../docs/v4/examples/ugc-recovery-pack.json', import.meta.url), 'utf8'),
  )
  const compiled = compileContentPack(data)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled
}
function metadata() {
  return {
    marks: [{ id: 'native/ability', effect: [] as string[] }],
    skills: [
      {
        id: 'custom/skill',
        element: Element.Normal,
        category: Category.Status,
        power: 0,
        rage: 0,
        accuracy: 100,
        effect: ['native/heal', 'ugc/recovery/apply-rule'],
      },
    ],
    species: [
      {
        id: 'custom/species',
        num: 1,
        element: Element.Normal,
        baseStats: { hp: 100, atk: 100, spa: 100, def: 100, spd: 100, spe: 100 },
        genderRatio: null,
        heightRange: [1, 2],
        weightRange: [1, 2],
        learnable_skills: [{ skill_id: 'custom/skill', level: 1, hidden: false }],
        ability: ['native/ability'],
        emblem: [],
      },
    ],
  }
}
const native: TrustedEffectFactory = marks => {
  expect(marks.has('native/ability')).toBe(true)
  expect(marks.has('ugc/recovery')).toBe(true)
  const amount = numberParam({ default: 7, legacyAliases: ['native.heal.amount'] })
  const effect = compileEffect(
    defineEffect({
      id: 'native/heal',
      on: 'OnHit',
      parameters: { amount },
      when: conditions.selfUsesSkill,
      execute: targets.ownerPet.apply(ops.heal(amount)),
    }),
  )
  return { effects: new Map([[effect.id, effect]]), parameters: new Map([[effect.id, effectParameters(effect)]]) }
}
function content() {
  return createContentCatalog(metadata(), 'mixed-content/test-1', native, [pack()])
}
function players(directory: ReturnType<typeof content>) {
  return directory.parsePlayers(
    input.teams.map((team, index) => ({
      name: team.name,
      id: String(index).repeat(21),
      team: [
        {
          ...structuredClone(team.team[0]),
          species: 'custom/species',
          skills: ['custom/skill'],
          ability: 'native/ability',
        },
      ],
    })),
  )
}
function battle(directory: ReturnType<typeof content>) {
  const [a, b] = players(directory)
  const result = directory.createBattle(a, b, { rngSeed: 'mixed', timerConfig: { enabled: false } })
  battles.push(result)
  return result
}
function apply(battle: Battle) {
  const player = battle.playerA
  const skill = player.activePet.skills[0]
  battle.applyEffects(
    new UseSkillContext(new TurnContext(battle), player, player.activePet, AttackTargetOpinion.opponent, skill),
    EffectTrigger.OnHit,
    skill,
  )
}

it('assembles native and data-authored effects with canonical marks, skills and namespaced species', () => {
  const directory = content()
  const skill = directory.getSkill('custom/skill' as baseSkillId)
  expect(skill.effects.map(effect => effect.id)).toEqual(['native/heal', 'ugc/recovery/apply-rule'])
  for (const effect of skill.effects) expect(directory.getEffect(effect.id)).toBe(effect)
  expect(directory.species[0].ability?.[0]).toBe(directory.getMark('native/ability' as baseMarkId))
  expect(Object.isFrozen(directory.species[0].baseStats)).toBe(true)
  const first = battle(directory)
  const second = battle(directory)
  expect(directory.snapshot(first).boundary).toBe('initial')
  first.playerA.activePet.currentHp = 1
  second.playerA.activePet.currentHp = 1
  apply(first)
  expect(first.playerA.activePet.currentHp).toBe(8)
  const recovery = first.playerA.activePet.marks.find(mark => mark.baseId === 'ugc/recovery')!
  expect(recovery.base).toBe(directory.getMark('ugc/recovery' as baseMarkId))
  expect(recovery.instanceParams).toEqual({ ratio: 0.2 })
  expect(second.playerA.activePet.currentHp).toBe(1)
  expect(second.playerA.activePet.marks.some(mark => mark.baseId === 'ugc/recovery')).toBe(false)
  directory.parametersFor('native/heal')!.set(first.configSystem, 'native.heal.amount', 11)
  apply(second)
  expect(second.playerA.activePet.currentHp).toBe(8)
  first.playerA.activePet.currentHp = 1
  apply(first)
  expect(first.playerA.activePet.currentHp).toBe(12)
})

it('restores mixed definitions against a freshly compiled catalog and retains scoped parameter values', async () => {
  const first = content()
  const original = battle(first)
  first.parametersFor('native/heal')!.set(original.configSystem, 'native.heal.amount', 13)
  const ready = new Promise<void>(resolve =>
    original.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = original.startBattle().catch(error => expect(error.message).toBe('Battle cancelled'))
  await ready
  original.playerA.activePet.currentHp = 1
  apply(original)
  const saved = first.snapshot(original)
  await original.cleanup()
  await run
  battles.pop()
  const fresh = content()
  const restored = fresh.restore(JSON.parse(JSON.stringify(saved)))
  battles.push(restored)
  expect(restored.playerA.activePet.originalSpecies).toBe(fresh.species[0])
  expect(restored.playerA.activePet.skills[0].base).toBe(fresh.skills[0])
  expect(restored.playerA.activePet.marks.find(mark => mark.baseId === 'ugc/recovery')?.instanceParams).toEqual({
    ratio: 0.2,
  })
  restored.playerA.activePet.currentHp = 1
  apply(restored)
  expect(restored.playerA.activePet.currentHp).toBe(14)
  const recovery = restored.playerA.activePet.marks.find(mark => mark.baseId === 'ugc/recovery')!
  expect(recovery.base).toBe(fresh.getMark('ugc/recovery' as baseMarkId))
  restored.applyEffects(new TurnContext(restored), EffectTrigger.TurnEnd)
  expect(restored.playerA.activePet.currentHp).toBe(14 + Math.floor(restored.playerA.activePet.stat.maxHp * 0.2))
  expect(() => first.snapshot(restored)).toThrow('different content directory')
})

it.each(['pack', 'mark', 'effect', 'skill', 'species', 'missing-learnset', 'wrong-source'] as const)(
  'rejects a mixed catalog with %s conflicts before any player is allocated',
  kind => {
    const data = metadata()
    const compiled = pack()
    const baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
    if (kind === 'mark') data.marks.push({ id: 'ugc/recovery', effect: [] })
    if (kind === 'skill') data.skills.push(data.skills[0])
    if (kind === 'species') data.species.push(data.species[0])
    if (kind === 'missing-learnset') data.species[0].learnable_skills[0].skill_id = 'missing/skill'
    if (kind === 'wrong-source') data.skills[0].effect = ['ugc/recovery/tick']
    const factory: TrustedEffectFactory = marks => {
      const result = native(marks)
      if (kind !== 'effect') return result
      return {
        ...result,
        effects: new Map([...result.effects, [compiled.rules[0].effect.id, compiled.rules[0].effect]]),
      }
    }
    expect(() =>
      createContentCatalog(data, 'invalid', factory, kind === 'pack' ? [compiled, compiled] : [compiled]),
    ).toThrow()
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  },
)

it('admits data-only content without a trusted effect factory', () => {
  const data = metadata()
  data.skills[0].effect = ['ugc/recovery/apply-rule']
  const directory = createContentCatalog(data, 'rules-only', undefined, [pack()])
  expect(directory.effects).toHaveLength(2)
  const first = battle(directory)
  apply(first)
  expect(first.playerA.activePet.marks.some(mark => mark.baseId === 'ugc/recovery')).toBe(true)
})
