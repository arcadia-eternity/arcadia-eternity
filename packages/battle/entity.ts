import { Battle } from './battle'
import { AddMarkContext, RemoveMarkContext } from './context'
import { Mark } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { Skill } from './skill'

//Pet,Skill,Mark,Effect

export interface Prototype {
  id: string
}

export interface Entity {
  type: string
}

export interface OwnedEntity<T = Battle | Player | Pet | Mark | Skill | null> {
  owner: T
  setOwner(owner: Exclude<T, null>): void // 排除 null
}

export interface MarkOwner {
  marks: Mark[]

  addMark(context: AddMarkContext): void
  removeMark(context: RemoveMarkContext): void
}
