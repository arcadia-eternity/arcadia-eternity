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
}
