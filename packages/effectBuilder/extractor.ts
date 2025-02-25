import {
  type OwnedEntity,
  Battle,
  DamageContext,
  MarkInstance,
  Pet,
  Player,
  SkillInstance,
  UseSkillContext,
} from '@test-battle/battle'
import type { Element, StatOnBattle } from '@test-battle/const'
import type { SelectorOpinion } from 'selector'

type ExtractorMap = {
  hp: (target: Pet) => number
  maxhp: (target: Pet) => number
  rage: (target: Player) => number
  owner: (target: OwnedEntity) => Battle | Player | Pet | MarkInstance | SkillInstance | null
  type: (target: Pet) => Element
  marks: (target: Pet) => MarkInstance[]
  stats: (target: Pet) => StatOnBattle
  stack: (target: MarkInstance) => number
  duration: (target: MarkInstance) => number
  power: (target: UseSkillContext) => number
  priority: (target: UseSkillContext) => number
  activePet: (target: Player) => Pet
  skills: (target: Pet) => SkillInstance[]
  id: (mark: MarkInstance | Pet) => string
  tags: (mark: MarkInstance) => string[]
}
// Extractor用于提取Selector得到的一组对象的某个值，将这个值的类型作为新的Selector

export const Extractor: ExtractorMap = {
  hp: (target: Pet) => target.currentHp,
  maxhp: (target: Pet) => target.maxHp!,
  rage: (target: Player) => target.currentRage,
  owner: (target: OwnedEntity) => target.owner!,
  type: (target: Pet) => target.element,
  marks: (target: Pet) => target.marks,
  stats: (target: Pet) => target.stat,
  stack: (target: MarkInstance) => target.stack,
  duration: (target: MarkInstance) => target.duration,
  power: (target: UseSkillContext) => target.power,
  priority: (target: UseSkillContext) => target.skillPriority,
  activePet: (target: Player) => target.activePet,
  skills: (target: Pet) => target.skills,
  id: (target: MarkInstance | Pet) => target.id,
  tags: (mark: MarkInstance) => mark.tags,
}

export type Path<T, P extends string> = P extends `${infer HeadPath}[]${infer Tail}`
  ? Path<T, HeadPath> extends Array<infer U>
    ? Path<U, Tail> extends infer R
      ? R extends never
        ? never
        : R[]
      : never
    : never
  : P extends `.${infer Rest}`
    ? Path<T, Rest>
    : P extends `${infer Head}.${infer Tail}`
      ? Head extends keyof T
        ? T[Head] extends object | Array<unknown> | null | undefined
          ? Path<NonNullable<T[Head]>, Tail>
          : never
        : never
      : P extends keyof T
        ? T[P]
        : never

export function createExtractor<T, P extends string>(path: P): (target: T) => Path<T, P> {
  const keys = path.split(/\.|\[\]/).filter(Boolean)
  return (target: T) => {
    let value: unknown = target
    for (const key of keys) {
      if (Array.isArray(value)) {
        value = value.flatMap(v => v[key as keyof typeof v])
      } else {
        value = value?.[key as keyof typeof value]
      }
    }
    if (!isValidSelectorOpinion(value)) {
      throw new Error(`路径${path}解析到无效类型: ${typeof value}`)
    }

    return value as Path<T, P>
  }
}
function isValidSelectorOpinion(value: unknown): value is SelectorOpinion {
  return (
    value instanceof Pet ||
    value instanceof MarkInstance ||
    value instanceof Player ||
    value instanceof SkillInstance ||
    value instanceof UseSkillContext ||
    value instanceof Battle ||
    value instanceof DamageContext ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    value === null ||
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null && 'atk' in value && 'def' in value)
  )
}
