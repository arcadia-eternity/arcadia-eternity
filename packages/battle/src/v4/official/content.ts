import { BattleStatus, type effectId } from '@arcadia-eternity/const'
import { createBattle, type BattleOptions } from '../api'
import type { Battle } from '../battle'
import { ConfigSystem } from '../config'
import type { BaseMark } from '../mark'
import type { Species } from '../pet'
import type { Player } from '../player'
import type { BaseSkill } from '../skill'
import { SnapshotCatalog, snapshotBattle, restoreBattle } from '../snapshot'
import { hasAuthoredParameters, registerEffect } from '../content/authoring/runtime'
import { freezeContent } from '../content/immutable'
import type { PrototypeLookup } from '../content/prototype-lookup'
import { MarkParser } from '../legacy/parser/mark'
import { SkillParser } from '../legacy/parser/skill'
import { SpeciesParser } from '../legacy/parser/species'
import { PlayerParser } from '../legacy/parser/player'
import { MarkSchema } from '../legacy/schema/mark'
import { PlayerSchema } from '../legacy/schema/player'
import { createOfficialEffectCandidates } from './candidate-catalog'

export interface OfficialPrototypeData {
  readonly marks: readonly unknown[]
  readonly skills: readonly unknown[]
  readonly species: readonly unknown[]
}
const installed = new WeakMap<Battle, object>()

/** Trusted host entry. The revision identifies this code build and its metadata together.
 * Effect implementations come exclusively from the compiled TypeScript directory.
 */
export function createOfficialContent(data: OfficialPrototypeData, revision: string) {
  const catalog = new SnapshotCatalog(revision)
  const input = structuredClone(data)
  for (const kind of ['marks', 'skills', 'species'] as const)
    if (!Array.isArray(input[kind])) throw new Error(`Official ${kind} must be an array`)
  const marks = new Map<string, BaseMark>(),
    skills = new Map<string, BaseSkill>(),
    species = new Map<string, Species>()
  const required = <T>(items: ReadonlyMap<string, T>, kind: string, id: string): T => {
    const item = items.get(id)
    if (!item) throw new Error(`Unknown official ${kind}: ${id}`)
    return item
  }
  const add = <T extends { readonly id: string }>(items: Map<string, T>, kind: string, value: T) => {
    if (items.has(value.id)) throw new Error(`Duplicate official ${kind}: ${value.id}`)
    items.set(value.id, value)
  }
  const lookup: PrototypeLookup = {
    getEffect: id => required(candidates.effects, 'effect', id),
    getMark: id => required(marks, 'mark', id),
    getSkill: id => required(skills, 'skill', id),
    getSpecies: id => required(species, 'species', id),
  }
  // Empty effect lists do not resolve until all canonical marks have been allocated.
  const markDefinitions = input.marks.map(raw => MarkSchema.parse(raw))
  for (const definition of markDefinitions) add(marks, 'mark', MarkParser.parse({ ...definition, effect: [] }, lookup))
  const candidates = createOfficialEffectCandidates(marks)
  for (const definition of markDefinitions) {
    const mark = required(marks, 'mark', definition.id)
    for (const id of definition.effect ?? []) mark.effects.push(lookup.getEffect(id as effectId))
  }
  for (const raw of input.skills) add(skills, 'skill', SkillParser.parse(raw, lookup))
  for (const raw of input.species) add(species, 'species', SpeciesParser.parse(raw, lookup))
  for (const effect of candidates.effects.values()) {
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
  const parameters = new Set(candidates.parameters.values())
  const token = Object.freeze({})
  return Object.freeze({
    revision,
    ...lookup,
    effects: Object.freeze([...candidates.effects.values()]),
    marks: Object.freeze([...marks.values()]),
    skills: Object.freeze([...skills.values()]),
    species: Object.freeze([...species.values()]),
    parametersFor: (id: string) => candidates.parameters.get(id),
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
            throw new Error(`Foreign official species: ${pet.originalSpecies.id}`)
          for (const skill of pet.skills)
            if (skills.get(skill.baseId) !== skill.base) throw new Error(`Foreign official skill: ${skill.baseId}`)
          for (const mark of pet.marks)
            if (marks.get(mark.baseId) !== mark.base) throw new Error(`Foreign official mark: ${mark.baseId}`)
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
      if (installed.get(battle) !== token) throw new Error('Battle belongs to a different official content directory')
      return snapshotBattle(
        battle,
        catalog,
        battle.status === BattleStatus.Unstarted ? { boundary: 'initial' } : undefined,
      )
    },
    restore(data: unknown): Battle {
      const battle = restoreBattle(data, catalog)
      installed.set(battle, token)
      return battle
    },
  })
}
export type OfficialContent = ReturnType<typeof createOfficialContent>
