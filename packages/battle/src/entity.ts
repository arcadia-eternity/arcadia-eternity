import type { Events, InstanceId, PrototypeId } from '@arcadia-eternity/const'
import type { Emitter } from 'mitt'
import { Battle } from './battle'
import type { MarkInstance } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { SkillInstance } from './skill'

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
