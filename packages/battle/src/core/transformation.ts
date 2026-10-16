import { Pet } from './pet.js'
import { Skill } from './skill.js'
import { Mark } from './mark.js'
import type { Battle } from './battle.js'
import type { BaseMark, BaseSkill, EffectReference, MarkConfig, Species } from './content.js'
import {
  AddMarkContext,
  RemoveMarkContext,
  TransformContext,
  TransformEndContext,
  type Transformable,
} from './context.js'
import { canonicalData, copyData, requireNumber } from './data.js'

export type TransformEndReason = 'manual' | 'mark_destroyed' | 'replaced' | 'cleared' | 'target_destroyed'
export interface TransformOptions {
  transformType?: 'temporary' | 'permanent'
  priority?: number
  causedBy?: Skill | Mark
  permanentStrategy?: 'preserve_temporary' | 'clear_temporary'
  effectHandlingStrategy?: 'preserve' | 'override'
}
export interface TransformReference {
  type: 'pet' | 'skill' | 'mark'
  id: string
}
export interface TransformationRecord {
  id: string
  baseId: string
  transformType: 'temporary' | 'permanent'
  priority: number
  causedBy: { type: 'skill' | 'mark'; id: string } | null
  permanentStrategy: 'preserve_temporary' | 'clear_temporary'
  effectHandlingStrategy: 'preserve' | 'override'
}
export interface TransformTargetState {
  target: TransformReference
  originalBaseId: string
  originalEffects: EffectReference[]
  originalConfig: MarkConfig | null
  nativeMarkIds: string[]
  suppressedMarkIds: string[]
  records: TransformationRecord[]
}
export interface TransformationState {
  nextId: number
  targets: TransformTargetState[]
}
function reference(target: Transformable): TransformReference {
  return { type: target instanceof Pet ? 'pet' : target instanceof Skill ? 'skill' : 'mark', id: target.id }
}
function key(ref: TransformReference) {
  return `${ref.type}:${ref.id}`
}
function top(records: readonly TransformationRecord[]) {
  // V1 tie semantics: the earlier temporary record wins equal priority.
  return (
    records.filter(r => r.transformType === 'temporary').sort((a, b) => b.priority - a.priority)[0] ??
    records.find(r => r.transformType === 'permanent')
  )
}
function mergeEffects(previous: readonly EffectReference[], next: readonly EffectReference[]) {
  return [...new Map([...previous, ...next].map(ref => [ref.id, ref])).values()]
}

/** Seer 2 forms only. Records contain IDs and data; runtime objects are resolved by the owning Battle. */
export class TransformationSystem {
  private nextId = 0
  private targets = new Map<string, TransformTargetState>()
  private changing = new Set<string>()
  constructor(readonly battle: Battle) {}
  snapshot(): TransformationState | undefined {
    return this.nextId === 0 ? undefined : copyData({ nextId: this.nextId, targets: [...this.targets.values()] })
  }
  restore(state?: TransformationState) {
    this.nextId = state?.nextId ?? 0
    this.targets = new Map((state?.targets ?? []).map(row => [key(row.target), copyData(row)]))
  }
  getState(target: Transformable) {
    this.assertTarget(target)
    const entry = this.targets.get(key(reference(target)))
    return copyData({ records: entry?.records ?? [], active: entry ? (top(entry.records) ?? null) : null })
  }
  resolve(ref: TransformReference): Transformable {
    if (ref.type === 'pet') return this.battle.getPetByID(ref.id)
    if (ref.type === 'skill') return this.battle.getSkillByID(ref.id)
    if (ref.type !== 'mark') throw new Error('Invalid transformation target type')
    const mark = [this.battle, ...this.battle.players.flatMap(p => p.team)]
      .flatMap(owner => owner.marks)
      .find(mark => mark.id === ref.id)
    if (!mark) throw new Error('Unknown transformation mark')
    return mark
  }
  private base(ref: TransformReference, id: string): Species | BaseSkill | BaseMark {
    return ref.type === 'pet'
      ? this.battle.content.species(id)
      : ref.type === 'skill'
        ? this.battle.content.skill(id)
        : this.battle.content.mark(id)
  }
  assertTarget(target: Transformable) {
    if (target.battle !== this.battle || this.resolve(reference(target)) !== target)
      throw new Error('Transformation target belongs to another battle or is no longer live')
    if (target instanceof Mark && (!target.isActive || target.base.id.startsWith('stat_stage_')))
      throw new Error('Transformation requires an active ordinary mark')
  }
  validate(context: TransformContext) {
    this.assertTarget(context.target)
    if (
      context.fromBase !== context.target.base ||
      this.base(reference(context.target), context.toBase.id) !== context.toBase
    )
      throw new Error('Transformation prototype does not match the target or content catalog')
    if (context.target instanceof Mark && context.toBase.id.startsWith('stat_stage_'))
      throw new Error('Stat stage marks cannot be transformation prototypes')
    const options = context.options
    if (
      !['temporary', 'permanent'].includes(options.transformType ?? 'temporary') ||
      !['preserve_temporary', 'clear_temporary'].includes(options.permanentStrategy ?? 'clear_temporary') ||
      !['preserve', 'override'].includes(options.effectHandlingStrategy ?? 'preserve') ||
      !Number.isSafeInteger(options.priority ?? 0)
    )
      throw new Error('Invalid transformation options')
    if (options.causedBy) {
      if (
        options.causedBy.battle !== this.battle ||
        this.resolve(reference(options.causedBy)) !== options.causedBy ||
        (options.causedBy instanceof Mark && !options.causedBy.isActive)
      )
        throw new Error('Invalid transformation source')
      if (!(options.causedBy instanceof Skill || options.causedBy instanceof Mark))
        throw new Error('Invalid transformation source')
    }
  }
  withTarget<R>(context: TransformContext | TransformEndContext, execute: () => R): R {
    this.battle.assertInOperation()
    const id = key(reference(context.target))
    const nestedEnd =
      context instanceof TransformEndContext &&
      context.parent instanceof TransformContext &&
      context.parent.target === context.target
    if (this.changing.has(id) && !nestedEnd) throw new Error('Reentrant transformation of the same target')
    if (nestedEnd && this.changing.has(id)) return execute()
    this.changing.add(id)
    try {
      return execute()
    } finally {
      this.changing.delete(id)
    }
  }
  /** Phase supplies lifecycle hooks; this method changes the stored form layers. */
  apply(context: TransformContext): string {
    const target = context.target,
      ref = reference(target),
      id = key(ref)
    let entry = this.targets.get(id)
    if (!entry) {
      entry = {
        target: ref,
        originalBaseId: target.base.id,
        originalEffects: target instanceof Pet ? [] : copyData([...target.effects]),
        originalConfig: target instanceof Mark ? copyData(target.config) : null,
        nativeMarkIds:
          target instanceof Pet
            ? target.marks.filter(mark => [target.ability, target.emblem].includes(mark.base.id)).map(mark => mark.id)
            : [],
        suppressedMarkIds: [],
        records: [],
      }
      this.targets.set(id, entry)
    }
    const options = context.options,
      source = options.causedBy
    const record: TransformationRecord = {
      id: `@transform/${this.nextId++}`,
      baseId: context.toBase.id,
      transformType: options.transformType ?? 'temporary',
      priority: options.priority ?? 0,
      causedBy: source ? { type: source instanceof Skill ? 'skill' : 'mark', id: source.id } : null,
      permanentStrategy: options.permanentStrategy ?? 'clear_temporary',
      effectHandlingStrategy: options.effectHandlingStrategy ?? 'preserve',
    }
    entry.records.push(record)
    this.updateForm(entry, target, context)
    return record.id
  }
  removals(context: TransformContext): TransformationRecord[] {
    const entry = this.targets.get(key(reference(context.target)))
    return copyData(
      entry?.records.filter(
        record =>
          (context.options.transformType === 'permanent' &&
            (record.transformType === 'permanent' || context.options.permanentStrategy !== 'preserve_temporary')) ||
          (context.options.transformType !== 'permanent' &&
            record.transformType === 'temporary' &&
            !!context.options.causedBy &&
            context.options.causedBy.id === record.causedBy?.id),
      ) ?? [],
    )
  }
  prepareEnd(context: TransformEndContext): boolean {
    // Mark destruction removes its records while it is still attached, but already inactive.
    if (context.reason === 'target_destroyed' && context.target instanceof Mark) {
      if (context.target.battle !== this.battle || this.resolve(reference(context.target)) !== context.target)
        throw new Error('Invalid destroyed transformation target')
    } else this.assertTarget(context.target)
    const entry = this.targets.get(key(reference(context.target)))
    const record = context.transformationId
      ? entry?.records.find(r => r.id === context.transformationId)
      : entry?.records.at(-1)
    if (!record || !entry) return false
    context.record = copyData(record)
    const next = top(entry.records.filter(r => r.id !== record.id))
    // Resolution is checked by target kind. Context's generic relation is retained at the public API.
    context.toBase = this.base(entry.target, next?.baseId ?? entry.originalBaseId)
    return true
  }
  remove(context: TransformEndContext) {
    const entry = this.targets.get(key(reference(context.target)))!
    entry.records = entry.records.filter(r => r.id !== context.record!.id)
    if (context.reason !== 'target_destroyed') this.updateForm(entry, context.target, context)
    if (entry.records.length === 0) this.targets.delete(key(entry.target))
  }
  cleanupMark(mark: Mark, parent: RemoveMarkContext) {
    // Snapshot the work list: hooks may create/remove other targets during teardown.
    const work = [...this.targets.values()].flatMap(entry =>
      entry.records
        .filter(
          record => entry.target.id === mark.id || (record.causedBy?.type === 'mark' && record.causedBy.id === mark.id),
        )
        .map(record => ({ target: entry.target, id: record.id })),
    )
    for (const item of work) {
      if (!this.targets.get(key(item.target))?.records.some(record => record.id === item.id)) continue
      const target = this.resolve(item.target)
      this.battle.endTransformation(
        new TransformEndContext(parent, target, item.id, target === mark ? 'target_destroyed' : 'mark_destroyed'),
      )
    }
    for (const entry of this.targets.values()) {
      entry.nativeMarkIds = entry.nativeMarkIds.filter(id => id !== mark.id)
      entry.suppressedMarkIds = entry.suppressedMarkIds.filter(id => id !== mark.id)
    }
  }
  private effectiveEffects(entry: TransformTargetState): readonly EffectReference[] {
    const active = top(entry.records),
      permanent = entry.records.find(record => record.transformType === 'permanent')
    let effects: readonly EffectReference[] = entry.originalEffects
    for (const record of [...(permanent ? [permanent] : []), ...(active && active !== permanent ? [active] : [])]) {
      const prototype = this.base(entry.target, record.baseId)
      if (!('effects' in prototype)) throw new Error('Effect prototype required')
      effects =
        record.effectHandlingStrategy === 'override' ? prototype.effects : mergeEffects(effects, prototype.effects)
    }
    return effects
  }
  private updateForm(
    entry: TransformTargetState,
    target: Transformable,
    parent: TransformContext | TransformEndContext,
  ) {
    const active = top(entry.records)
    const base = this.base(entry.target, active?.baseId ?? entry.originalBaseId)
    if (target instanceof Pet) {
      if (!('baseStats' in base)) throw new Error('Pet requires species')
      const previousHp = target.currentHp,
        previousMax = target.stat.maxHp,
        alive = target.isAlive
      target.species = base
      target.attributeSystem.refreshBase()
      this.updateNativeMarks(entry, target, active, base, parent)
      target.currentHp = alive ? Math.max(1, Math.floor((target.stat.maxHp * previousHp) / previousMax)) : 0
    } else {
      const effects = this.effectiveEffects(entry)
      if (target instanceof Skill) {
        if (!('power' in base)) throw new Error('Skill requires skill prototype')
        for (const field of ['power', 'accuracy', 'rage', 'priority'] as const)
          target.attributeSystem.updateBaseValue(
            field,
            target.attributeSystem.getBaseValue(field) + base[field] - target.base[field],
          )
        target.base = base
      } else {
        if (!('config' in base)) throw new Error('Mark requires mark prototype')
        const changed = target.base !== base
        target.base = base
        if (changed || !active) target.config = copyData(active ? base.config : entry.originalConfig!)
        target.stack = Math.min(target.stack, target.config.maxStacks)
      }
      target.effectReferences =
        canonicalData(effects) === canonicalData(base.effects) ? undefined : copyData([...effects])
    }
  }
  private updateNativeMarks(
    entry: TransformTargetState,
    pet: Pet,
    active: TransformationRecord | undefined,
    base: Species,
    parent: TransformContext | TransformEndContext,
  ) {
    const ability = active ? base.abilityIds[0] : pet.build.ability
    const emblem = active ? base.emblemIds[0] : pet.build.emblem
    const desired = new Set([pet.build.ability, pet.build.emblem].filter((id): id is string => !!id))
    const permanent = entry.records.find(record => record.transformType === 'permanent')
    for (const record of [...(permanent ? [permanent] : []), ...(active && active !== permanent ? [active] : [])]) {
      const species = this.battle.content.species(record.baseId)
      if (record.effectHandlingStrategy === 'override') desired.clear()
      for (const id of [species.abilityIds[0], species.emblemIds[0]]) if (id) desired.add(id)
    }
    // Resolve before mutations so invalid content never leaves half a form transition.
    for (const id of desired) this.battle.content.mark(id)
    pet.currentAbility = ability ?? null
    pet.currentEmblem = emblem ?? null
    for (const mark of [...pet.marks]) {
      if (!entry.nativeMarkIds.includes(mark.id)) continue
      if (desired.has(mark.base.id)) {
        if (entry.suppressedMarkIds.includes(mark.id)) mark.effectsSuppressed = false
        entry.suppressedMarkIds = entry.suppressedMarkIds.filter(id => id !== mark.id)
      } else if (entry.records.some(record => record.causedBy?.type === 'mark' && record.causedBy.id === mark.id)) {
        // Retain the live source as a dormant anchor; destroying it would immediately undo its own form.
        mark.effectsSuppressed = true
        if (!entry.suppressedMarkIds.includes(mark.id)) entry.suppressedMarkIds.push(mark.id)
      } else {
        this.battle.removeMark(new RemoveMarkContext(parent, mark, true))
        if (mark.isActive) throw new Error('Native mark removal was prevented during transformation')
      }
    }
    entry.nativeMarkIds = entry.nativeMarkIds.filter(id => pet.marks.some(mark => mark.id === id))
    for (const id of desired) {
      const existing = pet.marks.find(mark => mark.base.id === id && mark.isActive)
      if (existing) continue // Reusing a status mark does not acquire ownership of its destruction.
      const mark = this.battle.addMark(new AddMarkContext(parent, pet, this.battle.content.mark(id)))
      if (!mark) throw new Error('Native mark creation was prevented during transformation')
      entry.nativeMarkIds.push(mark.id)
    }
  }
  /** Validate ID/prototype/source relationships after the Battle object graph has been rehydrated. */
  validateState(state?: TransformationState) {
    if (!state) return
    if (!Number.isSafeInteger(state.nextId) || state.nextId < 1) throw new Error('Invalid transformation counter')
    const ids = new Set<string>(),
      targets = new Set<string>()
    for (const entry of state.targets) {
      const target = this.resolve(entry.target),
        targetKey = key(entry.target)
      this.assertTarget(target)
      if (targets.has(targetKey) || entry.records.length === 0) throw new Error('Invalid transformation target records')
      targets.add(targetKey)
      const original = this.base(entry.target, entry.originalBaseId)
      if (
        (target instanceof Pet && original.id !== target.originalSpecies.id) ||
        (target instanceof Skill && original.id !== target.owner.build.skills[target.owner.skills.indexOf(target)])
      )
        throw new Error('Invalid original transformation prototype')
      for (const ref of entry.originalEffects) this.battle.registry.resolve(ref)
      const sources = new Set<string>()
      let permanent = 0,
        previous = -1
      for (const record of entry.records) {
        const serial = Number(record.id.slice(11))
        if (
          !/^@transform\/\d+$/.test(record.id) ||
          !Number.isSafeInteger(serial) ||
          serial >= state.nextId ||
          serial <= previous ||
          ids.has(record.id) ||
          !Number.isSafeInteger(record.priority) ||
          !['temporary', 'permanent'].includes(record.transformType) ||
          !['preserve', 'override'].includes(record.effectHandlingStrategy) ||
          !['clear_temporary', 'preserve_temporary'].includes(record.permanentStrategy)
        )
          throw new Error('Invalid transformation record')
        previous = serial
        ids.add(record.id)
        this.base(entry.target, record.baseId)
        if (record.transformType === 'permanent' && ++permanent > 1)
          throw new Error('Duplicate permanent transformation')
        if (record.causedBy) {
          if (!['skill', 'mark'].includes(record.causedBy.type)) throw new Error('Invalid transformation source type')
          const source = this.resolve(record.causedBy)
          if (source instanceof Mark && !source.isActive) throw new Error('Inactive transformation source')
          if (record.transformType === 'temporary') {
            const source = key(record.causedBy)
            if (sources.has(source)) throw new Error('Duplicate temporary transformation source')
            sources.add(source)
          }
        }
      }
      if (target.base.id !== top(entry.records)?.baseId) throw new Error('Transformation active prototype mismatch')
      if (target instanceof Pet) {
        if (
          entry.originalEffects.length ||
          target.currentAbility !== (target.base.abilityIds[0] ?? null) ||
          target.currentEmblem !== (target.base.emblemIds[0] ?? null)
        )
          throw new Error('Transformation native state mismatch')
      } else if (canonicalData(target.effects) !== canonicalData(this.effectiveEffects(entry)))
        throw new Error('Transformation effects mismatch')
      if (target instanceof Mark) {
        if (!entry.originalConfig) throw new Error('Missing original mark config')
        requireNumber(entry.originalConfig.maxStacks, 'original mark max stacks', 1)
      } else if (entry.originalConfig !== null) throw new Error('Unexpected original mark config')
      if (!(target instanceof Pet) && (entry.nativeMarkIds.length || entry.suppressedMarkIds.length))
        throw new Error('Unexpected native marks')
      for (const id of entry.suppressedMarkIds)
        if (
          !entry.nativeMarkIds.includes(id) ||
          !(target instanceof Pet) ||
          !target.marks.some(mark => mark.id === id && mark.effectsSuppressed)
        )
          throw new Error('Invalid suppressed native mark')
      if (new Set(entry.nativeMarkIds).size !== entry.nativeMarkIds.length) throw new Error('Duplicate native mark')
      for (const id of entry.nativeMarkIds)
        if (!(target instanceof Pet) || !target.marks.some(mark => mark.id === id && mark.isActive))
          throw new Error('Invalid transformation native mark')
    }
  }
}
