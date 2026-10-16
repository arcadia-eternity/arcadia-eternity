import type { Battle } from './battle.js'
import type { Pet } from './pet.js'
import type { Player } from './player.js'
import type { Skill } from './skill.js'
import type { Mark } from './mark.js'
import type { AddMarkContext, RemoveMarkContext } from './context.js'
import type { EffectReference } from './content.js'

export interface Entity<TId extends string = string> {
  readonly id: TId
}
export interface Prototype<TId extends string = string> extends Entity<TId> {
  readonly id: TId
}
export interface Instance<TPrototype extends Prototype = Prototype, TId extends string = string> extends Entity<TId> {
  readonly base: TPrototype
}
export type CanOwnedEntity = Battle | Player | Pet | Skill | Mark | MarkOwner
export interface OwnedEntity<TOwner extends CanOwnedEntity = CanOwnedEntity> {
  readonly owner: TOwner
  setOwner(owner: TOwner): void
}
/** Host emitters do not belong in ownership; all rules report through the owning Battle. */
export interface MarkOwner extends Entity {
  readonly battle: Battle
  marks: Mark[]
  addMark(context: AddMarkContext): Mark | null
  removeMark(context: RemoveMarkContext): void
}
export interface EffectContainer {
  readonly effects: readonly EffectReference[]
}
