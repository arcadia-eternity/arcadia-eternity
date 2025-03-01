import {
  type Instance,
  type OwnedEntity,
  Battle,
  DamageContext,
  MarkInstance,
  Pet,
  Player,
  SkillInstance,
  UseSkillContext,
} from '@test-battle/battle'
import type { Element, InstanceId, PrototypeId, StatOnBattle } from '@test-battle/const'
import { type SelectorOpinion } from './SelectorOpinion'

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
  id: (target: Instance) => InstanceId
  baseId: (target: Instance) => PrototypeId
  tags: (mark: MarkInstance) => string[]
}

// 实现 Extractor
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
  id: (target: Instance) => target.id,
  baseId: (target: Instance) => target.base.id,
  tags: (mark: MarkInstance) => mark.tags,
}

export type Path<T, P extends string> = P extends ''
  ? T
  : P extends `.${infer Rest}`
    ? Path<T, Rest>
    : P extends `${infer Head}[]${infer Tail}`
      ? T extends any
        ? Head extends keyof T
          ? T[Head] extends Array<infer U>
            ? Array<Path<U, Tail>>
            : never
          : never
        : never
      : P extends `${infer Head}.${infer Tail}`
        ? T extends any
          ? Head extends keyof T
            ? Path<T[Head], Tail>
            : never
          : never
        : T extends any
          ? P extends keyof T
            ? Exclude<T[P], null>
            : T extends Record<string, infer V>
              ? V
              : never
          : never

export function createExtractor<T, P extends string>(path: P): (target: T) => Path<T, P> {
  const parts = path.split(/(\.|\[\])/g).filter(p => p && p !== '.') // 分割路径并保留 []
  const hasArray = parts.includes('[]') // 标记路径是否包含数组展开

  return (target: T) => {
    let current: any[] = [target]

    for (const part of parts) {
      if (part === '[]') {
        current = current.flat() // 展平一层数组
      } else {
        current = current.flatMap(item => {
          if (item == null) return [] // 过滤 null/undefined
          const value = item[part as keyof typeof item]
          return Array.isArray(value) ? value : [value] // 非数组值包装成数组
        })
      }
    }

    // 根据路径是否包含数组展开决定返回形式
    return (hasArray ? current : current[0]) as Path<T, P>
  }
}

export function isValidSelectorOpinion(value: unknown): value is SelectorOpinion {
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
