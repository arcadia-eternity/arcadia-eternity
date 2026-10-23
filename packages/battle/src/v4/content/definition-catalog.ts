import { BattlePhase, BattleStatus, type EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { createBattle, type BattleOptions } from '../api'
import type { Battle } from '../battle'
import { ConfigSystem } from '../config'
import { Effect } from '../effect'
import type { BaseMark } from '../mark'
import type { Species } from '../pet'
import type { Player } from '../player'
import type { BaseSkill } from '../skill'
import { SnapshotCatalog, snapshotBattle, restoreBattle } from '../snapshot'
import { hasAuthoredParameters, registerEffect } from './authoring/runtime'
import { freezeContent } from './immutable'
import type { PrototypeLookup } from './prototype-lookup'
import type { ParameterCatalog } from './parameters'
import type { ContentPackResult } from './content-pack'
import { MarkParser } from '../legacy/parser/mark'
import { SkillParser } from '../legacy/parser/skill'
import { SpeciesParser } from '../legacy/parser/species'
import { PlayerParser } from '../legacy/parser/player'
import { MarkSchema } from '../legacy/schema/mark'
import { PlayerSchema } from '../legacy/schema/player'
import { SpeciesSchema } from '../legacy/schema/species'

/** Serializable metadata shared by file adapters, editors and trusted content packages. */
export interface ContentPrototypeData {
  readonly marks: readonly unknown[]
  readonly skills: readonly unknown[]
  readonly species: readonly unknown[]
}
export interface TrustedEffectCatalog {
  readonly effects: ReadonlyMap<string, Effect<EffectTrigger>>
  readonly parameters: ReadonlyMap<string, ParameterCatalog>
}
/** Only a host may supply executable factories. Received content documents cannot select one. */
export type TrustedEffectFactory = (marks: ReadonlyMap<string, BaseMark>) => TrustedEffectCatalog
export type CompiledContentPack = Extract<ContentPackResult, { ok: true }>
const installed = new WeakMap<Battle, object>()
const emptyFactory: TrustedEffectFactory = () => ({ effects: new Map(), parameters: new Map() })

/** Assemble metadata, trusted effects and compiled rules into one immutable set of prototypes.
 * The host's revision must identify every input, including trusted code and compiled pack data.
 * Marks are allocated before effects, so ordinary content-reference cycles remain valid.
 */
export function createContentCatalog(
  data: ContentPrototypeData,
  revision: string,
  createEffects: TrustedEffectFactory = emptyFactory,
  packs: readonly CompiledContentPack[] = [],
) {
  const catalog = new SnapshotCatalog(revision)
  const input = structuredClone(data)
  for (const kind of ['marks', 'skills', 'species'] as const)
    if (!Array.isArray(input[kind])) throw new Error(`Content ${kind} must be an array`)
  const marks = new Map<string, BaseMark>(),
    skills = new Map<string, BaseSkill>(),
    species = new Map<string, Species>(),
    effects = new Map<string, Effect<EffectTrigger>>(),
    effectParameters = new Map<string, ParameterCatalog>(),
    parameters = new Set<ParameterCatalog>()
  const required = <T>(items: ReadonlyMap<string, T>, kind: string, id: string): T => {
    const item = items.get(id)
    if (!item) throw new Error(`Unknown content ${kind}: ${id}`)
    return item
  }
  const add = <T extends { readonly id: string }>(items: Map<string, T>, kind: string, value: T) => {
    if (items.has(value.id)) throw new Error(`Duplicate content ${kind}: ${value.id}`)
    items.set(value.id, value)
  }
  const lookup: PrototypeLookup = {
    getEffect: id => required(effects, 'effect', id),
    getMark: id => required(marks, 'mark', id),
    getSkill: id => required(skills, 'skill', id),
    getSpecies: id => required(species, 'species', id),
  }
  const markDefinitions = input.marks.map(raw => MarkSchema.parse(raw))
  for (const definition of markDefinitions) add(marks, 'mark', MarkParser.parse({ ...definition, effect: [] }, lookup))
  const packIds = new Set<string>()
  const ruleSources = new Map<string, { kind: 'skill' | 'petMark'; markId?: string }>()
  for (const pack of packs) {
    if (packIds.has(pack.data.id)) throw new Error(`Duplicate content pack: ${pack.data.id}`)
    packIds.add(pack.data.id)
    for (const mark of pack.marks) add(marks, 'mark', mark)
  }
  const native = createEffects(marks)
  for (const [id, effect] of native.effects) {
    if (!(effect instanceof Effect) || effect.id !== id) throw new Error(`Invalid content effect: ${id}`)
    add(effects, 'effect', effect)
  }
  for (const [id, parameter] of native.parameters) {
    required(effects, 'effect', id)
    effectParameters.set(id, parameter)
    parameters.add(parameter)
  }
  for (const pack of packs) {
    for (const rule of pack.rules) {
      add(effects, 'effect', rule.effect)
      effectParameters.set(rule.effect.id, rule.parameters)
    }
    for (const entry of pack.data.rules)
      ruleSources.set(entry.rule.id, { kind: entry.sourceKind, markId: entry.rule.sourceMarkId })
    parameters.add(pack.parameters)
  }
  const validateSource = (effect: string, kind: 'skill' | 'petMark', ownerId: string) => {
    const source = ruleSources.get(effect)
    if (source && (source.kind !== kind || (kind === 'petMark' && source.markId !== ownerId)))
      throw new Error(`Content effect source mismatch: ${effect} on ${ownerId}`)
  }
  for (const definition of markDefinitions) {
    const mark = required(marks, 'mark', definition.id)
    for (const id of definition.effect ?? []) {
      validateSource(id, 'petMark', definition.id)
      mark.effects.push(lookup.getEffect(id as effectId))
    }
  }
  for (const raw of input.skills) {
    const skill = SkillParser.parse(raw, lookup)
    for (const effect of skill.effects) validateSource(effect.id, 'skill', skill.id)
    add(skills, 'skill', skill)
  }
  for (const raw of input.species) {
    const definition = SpeciesSchema.parse(raw)
    for (const entry of definition.learnable_skills) required(skills, 'skill', entry.skill_id)
    add(species, 'species', SpeciesParser.parse(definition, lookup))
  }
  for (const effect of effects.values()) {
    if (hasAuthoredParameters(effect)) registerEffect(catalog, effect)
    else catalog.registerEffect(effect.id, effect)
    freezeContent(effect)
  }
  for (const [kind, items] of [
    ['mark', marks],
    ['skill', skills],
    ['species', species],
  ] as const)
    for (const [id, prototype] of items) {
      freezeContent(prototype)
      catalog.registerContent(`${kind}:${id}`, prototype)
    }
  catalog.seal()
  const token = Object.freeze({})
  return Object.freeze({
    revision,
    ...lookup,
    effects: Object.freeze([...effects.values()]),
    marks: Object.freeze([...marks.values()]),
    skills: Object.freeze([...skills.values()]),
    species: Object.freeze([...species.values()]),
    parametersFor: (id: string) => effectParameters.get(id),
    parsePlayer: (raw: unknown) => PlayerParser.parse(raw, lookup),
    /** Validate the whole creation batch before allocating any domain instances. */
    parsePlayers(raw: readonly unknown[], options: { aiPlayerIds?: readonly string[] } = {}): Player[] {
      const players = raw.map(value => PlayerSchema.parse(value))
      const ai = new Set(options.aiPlayerIds)
      for (const id of ai) if (!players.some(player => player.id === id)) throw new Error(`Unknown AI player: ${id}`)
      for (const player of players)
        for (const pet of player.team) {
          lookup.getSpecies(pet.species as Parameters<PrototypeLookup['getSpecies']>[0])
          for (const skill of pet.skills) lookup.getSkill(skill as Parameters<PrototypeLookup['getSkill']>[0])
          if (pet.ability) lookup.getMark(pet.ability as Parameters<PrototypeLookup['getMark']>[0])
          if (pet.emblem) lookup.getMark(pet.emblem as Parameters<PrototypeLookup['getMark']>[0])
        }
      return players.map(player => PlayerParser.parse(player, lookup, { ai: ai.has(player.id) }))
    },
    createBattle(playerA: Player, playerB: Player, options?: BattleOptions): Battle {
      for (const player of [playerA, playerB])
        for (const pet of player.team) {
          if (species.get(pet.originalSpecies.id) !== pet.originalSpecies)
            throw new Error(`Foreign content species: ${pet.originalSpecies.id}`)
          for (const skill of pet.skills)
            if (skills.get(skill.baseId) !== skill.base) throw new Error(`Foreign content skill: ${skill.baseId}`)
          for (const mark of pet.marks)
            if (marks.get(mark.baseId) !== mark.base) throw new Error(`Foreign content mark: ${mark.baseId}`)
        }
      const config = ConfigSystem.createInstance()
      try {
        for (const parameter of parameters) parameter.install(config)
        const battle = createBattle(playerA, playerB, options, config)
        installed.set(battle, token)
        return battle
      } catch (error) {
        config.destroy()
        throw error
      }
    },
    snapshot(battle: Battle) {
      if (installed.get(battle) !== token) throw new Error('Battle belongs to a different content directory')
      return snapshotBattle(
        battle,
        catalog,
        battle.status === BattleStatus.Unstarted
          ? { boundary: battle.currentPhase === BattlePhase.TeamSelectionPhase ? 'team-selection' : 'initial' }
          : undefined,
      )
    },
    restore(data: unknown): Battle {
      const battle = restoreBattle(data, catalog)
      installed.set(battle, token)
      return battle
    },
  })
}
export type ContentCatalog = ReturnType<typeof createContentCatalog>
