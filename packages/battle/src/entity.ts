import type { Events, Id, InstanceId, PrototypeId } from '@arcadia-eternity/const'
import { Battle } from './battle'
import { AddMarkContext, RemoveMarkContext } from './context'
import type { MarkInstance } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { SkillInstance } from './skill'
import type { Emitter } from 'mitt'

//Pet,Skill,Mark,Effect

export interface Prototype {
  id: PrototypeId
}

export interface Instance {
  id: InstanceId
  base: Prototype
}

export type CanOwnedEntity = Battle | Player | Pet | MarkInstance | SkillInstance | null

export interface OwnedEntity<T = CanOwnedEntity> {
  owner: T
  setOwner(owner: Exclude<T, null>, emitter: Emitter<Events>): void // 排除 null
}

export interface MarkOwner {
  marks: MarkInstance[]

  /*
   * @deprecated Use AddPhase directly instead of calling this method.
   * This method is kept for backward compatibility but will be removed in future versions.
   */
  addMark(context: AddMarkContext): void
  /**
   * @deprecated Use RemovePhase directly instead of calling this method.
   * This method is kept for backward compatibility but will be removed in future versions.
   */
  removeMark(context: RemoveMarkContext): void
}
