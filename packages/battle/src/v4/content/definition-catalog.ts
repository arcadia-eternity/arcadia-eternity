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
import type { CapabilityRegistry } from './capabilities'
import { createCoreCapabilityRegistry } from './core-capabilities'
import {
  BehaviorCompilationError,
  behaviorEffectId,
  normalizeBehaviorDefinitions,
  normalizeBehaviorUses,
  validateBehaviorUse,
  compilePreparedBehaviorUse,
  type BehaviorOwner,
  type NativeBehaviorExport,
} from './behaviors'
import { MarkParser } from '../legacy/parser/mark'
import { SkillParser } from '../legacy/parser/skill'
import { SpeciesParser } from '../legacy/parser/species'
import { PlayerParser } from '../legacy/parser/player'
import { MarkSchema } from '../legacy/schema/mark'
import { SkillSchema } from '../legacy/schema/skill'
import { PlayerSchema } from '../legacy/schema/player'
import { SpeciesSchema } from '../legacy/schema/species'

/** Serializable metadata shared by file adapters, editors and trusted content packages. */
export interface ContentPrototypeData {
  readonly marks: readonly unknown[]
  readonly skills: readonly unknown[]
  readonly species: readonly unknown[]
  readonly behaviors?: readonly unknown[]
}
/** Executable exports and rule capabilities are supplied by the trusted host, never metadata. */
export interface BehaviorCatalogRegistrations {
  readonly registry?: CapabilityRegistry
  readonly nativeExports?: readonly NativeBehaviorExport[]
}
/** Trusted registration may reference the canonical marks allocated from saved metadata. */
export type BehaviorCatalogOptions =
  | BehaviorCatalogRegistrations
  | ((content: {
      readonly marks: ReadonlyMap<string, BaseMark>
      readonly skillIds: ReadonlySet<string>
    }) => BehaviorCatalogRegistrations)
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
  behaviorRegistrations: BehaviorCatalogOptions = {},
) {
  const catalog = new SnapshotCatalog(revision)
  for (const kind of ['marks', 'skills', 'species'] as const)
    if (!Array.isArray(data[kind])) throw new Error(`Content ${kind} must be an array`)
  const behaviorDefinitions = normalizeBehaviorDefinitions(data.behaviors === undefined ? [] : data.behaviors)
  const readUses = (raw: unknown, owner: BehaviorOwner) => {
    const value = raw && typeof raw === 'object' ? Reflect.get(raw, 'behaviors') : undefined
    return normalizeBehaviorUses(value === undefined ? [] : value, owner)
  }
  // Normalize behavior fields first so their errors retain content/use locations.
  const markEntries = data.marks.map(raw => {
    const id = raw && typeof raw === 'object' ? Reflect.get(raw, 'id') : undefined
    const uses = readUses(raw, { kind: 'petMark', id: typeof id === 'string' ? id : '<mark>' })
    const definition = MarkSchema.parse(raw)
    const owner = { kind: 'petMark' as const, id: definition.id }
    return { definition: structuredClone(definition), owner, uses }
  })
  const skillEntries = data.skills.map(raw => {
    const id = raw && typeof raw === 'object' ? Reflect.get(raw, 'id') : undefined
    const uses = readUses(raw, { kind: 'skill', id: typeof id === 'string' ? id : '<skill>' })
    const definition = SkillSchema.parse(raw)
    const owner = { kind: 'skill' as const, id: definition.id }
    return { definition: structuredClone(definition), owner, uses }
  })
  const inputSpecies = structuredClone(data.species)
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
  for (const { definition } of markEntries) add(marks, 'mark', MarkParser.parse({ ...definition, effect: [] }, lookup))
  const skillIds = new Set<string>()
  for (const { definition } of skillEntries) {
    if (skillIds.has(definition.id)) throw new Error(`Duplicate content skill: ${definition.id}`)
    skillIds.add(definition.id)
  }
  const packIds = new Set<string>()
  const ruleSources = new Map<string, { kind: 'skill' | 'petMark'; markId?: string }>()
  for (const pack of packs) {
    if (packIds.has(pack.data.id)) throw new Error(`Duplicate content pack: ${pack.data.id}`)
    packIds.add(pack.data.id)
    for (const mark of pack.marks) add(marks, 'mark', mark)
  }
  const behaviorOptions =
    typeof behaviorRegistrations === 'function'
      ? behaviorRegistrations(Object.freeze({ marks: new Map(marks), skillIds: new Set(skillIds) }))
      : behaviorRegistrations
  const registry = behaviorOptions.registry ?? createCoreCapabilityRegistry()
  const behaviorPlans = [...markEntries, ...skillEntries].flatMap(entry =>
    entry.uses.map(use => ({
      owner: entry.owner,
      prepared: validateBehaviorUse(behaviorDefinitions, use, {
        owner: entry.owner,
        sourceMark: entry.owner.kind === 'petMark' ? required(marks, 'mark', entry.owner.id) : undefined,
        registry,
        nativeExports: behaviorOptions.nativeExports,
        references: { marks: new Set(marks.keys()), skills: skillIds },
      }),
    })),
  )
  const behaviorSources = new Map(behaviorPlans.map(({ owner, prepared }) => [prepared.effectId, owner]))
  for (const { definition, owner } of [...markEntries, ...skillEntries])
    for (const id of definition.effect ?? []) {
      const source = behaviorSources.get(id)
      if (source)
        throw new BehaviorCompilationError([
          {
            code: source.kind === owner.kind && source.id === owner.id ? 'DUPLICATE_ID' : 'CAPABILITY_MISMATCH',
            contentId: owner.id,
            field: 'effect',
            message: `Behavior use ${id} must be referenced through its owning behavior entry`,
          },
        ])
    }
  // Validate and compile every data rule before invoking host-provided code builders.
  const compiledBehaviors = new Map<string, Extract<ReturnType<typeof compilePreparedBehaviorUse>, { ok: true }>>()
  for (const kind of ['rule', 'native'] as const)
    for (const { prepared } of behaviorPlans) {
      if (prepared.definition.implementation.kind !== kind) continue
      const compiled = compilePreparedBehaviorUse(prepared)
      if (!compiled.ok) throw new BehaviorCompilationError(compiled.diagnostics)
      compiledBehaviors.set(prepared.effectId, compiled)
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
  for (const { prepared } of behaviorPlans) {
    const compiled = required(compiledBehaviors, 'behavior use', prepared.effectId)
    add(effects, 'effect', compiled.effect)
    effectParameters.set(compiled.effect.id, compiled.parameters)
    parameters.add(compiled.parameters)
  }
  const validateSource = (effect: string, kind: 'skill' | 'petMark', ownerId: string) => {
    const behaviorOwner = behaviorSources.get(effect)
    if (behaviorOwner && (behaviorOwner.kind !== kind || behaviorOwner.id !== ownerId))
      throw new BehaviorCompilationError([
        {
          code: 'CAPABILITY_MISMATCH',
          contentId: ownerId,
          field: 'effect',
          message: `Content behavior source mismatch: ${effect} on ${ownerId}`,
        },
      ])
    const source = ruleSources.get(effect)
    if (source && (source.kind !== kind || (kind === 'petMark' && source.markId !== ownerId)))
      throw new Error(`Content effect source mismatch: ${effect} on ${ownerId}`)
  }
  for (const { definition, owner, uses } of markEntries) {
    const mark = required(marks, 'mark', definition.id)
    for (const id of [...(definition.effect ?? []), ...uses.map(use => behaviorEffectId(owner, use.useId))]) {
      validateSource(id, 'petMark', definition.id)
      mark.effects.push(lookup.getEffect(id as effectId))
    }
  }
  for (const { definition, owner, uses } of skillEntries) {
    const skill = SkillParser.parse(
      { ...definition, effect: [...(definition.effect ?? []), ...uses.map(use => behaviorEffectId(owner, use.useId))] },
      lookup,
    )
    for (const effect of skill.effects) validateSource(effect.id, 'skill', skill.id)
    add(skills, 'skill', skill)
  }
  for (const raw of inputSpecies) {
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
