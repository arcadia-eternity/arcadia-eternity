import type { Id } from '@test-battle/const'
import { Battle } from './battle'
import { AddMarkContext, RemoveMarkContext } from './context'
import { MarkInstance } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { SkillInstance } from './skill'

//Pet,Skill,Mark,Effect

export interface Prototype {
  id: Id
}

export interface Entity {
  type: string
}

export interface OwnedEntity<T = Battle | Player | Pet | MarkInstance | SkillInstance | null> {
  owner: T
  setOwner(owner: Exclude<T, null>): void // 排除 null
}

export interface MarkOwner {
  marks: MarkInstance[]

  addMark(context: AddMarkContext): void
  removeMark(context: RemoveMarkContext): void
}
