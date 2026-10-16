import {
  type Instance,
  type OwnedEntity,
  Battle,
  DamageContext,
  type MarkInstance,
  Pet,
  Player,
  SkillInstance,
  UseSkillContext,
  MarkInstanceImpl,
} from '@arcadia-eternity/battle'
import type { Element, InstanceId, PrototypeId, StatOnBattle } from '@arcadia-eternity/const'
import type { SelectorOpinion } from './selector'
import type { ValueExtractor } from './effectBuilder'
import { RuntimeTypeChecker } from './runtime-type-checker'

export interface PathExtractor<T, U> {
  path: string
  extract: ValueExtractor<T, U>
  type: string
}

type ExtractorMap = {
  currentHp: PathExtractor<Pet, number>
  maxHp: PathExtractor<Pet, number>
  rage: PathExtractor<Player | Pet, number>
  owner: PathExtractor<OwnedEntity, Battle | Player | Pet | MarkInstance | SkillInstance | null>
  type: PathExtractor<Pet, Element>
  marks: PathExtractor<Pet, MarkInstance[]>
  stats: PathExtractor<Pet, StatOnBattle>
  stack: PathExtractor<MarkInstance, number>
  duration: PathExtractor<MarkInstance, number>
  power: PathExtractor<UseSkillContext, number>
  priority: PathExtractor<UseSkillContext, number>
  activePet: PathExtractor<Player, Pet>
  skills: PathExtractor<Pet, SkillInstance[]>
  id: PathExtractor<Instance, InstanceId>
  baseId: PathExtractor<Instance, PrototypeId>
  tags: PathExtractor<MarkInstance, string[]>
  rageCost: PathExtractor<SkillInstance, number>
  element: PathExtractor<Pet, Element>
}

export const Extractor: ExtractorMap = {
  currentHp: {
    path: 'currentHp',
    type: 'number',
    extract: (target: Pet) => target.currentHp,
  },
  maxHp: {
    path: 'stat.maxHp',
    type: 'number',
    extract: (target: Pet) => target.stat.maxHp!,
  },
  rage: {
    path: 'currentRage',
    type: 'number',
    extract: (target: Player | Pet) => target.currentRage,
  },
  owner: {
    path: 'owner',
    type: 'CanOwnedEntity',
    extract: (target: OwnedEntity) => target.owner!,
  },
  type: {
    path: 'element',
    type: 'Element',
    extract: (target: Pet) => target.element,
  },
  marks: {
    path: 'marks',
    type: 'MarkInstance[]',
    extract: (target: Pet) => target.marks,
  },
  stats: {
    path: 'stat',
    type: 'StatOnBattle',
    extract: (target: Pet) => target.stat,
  },
  stack: {
    path: 'stack',
    type: 'number',
    extract: (target: MarkInstance) => target.stack,
  },
  duration: {
    path: 'duration',
    type: 'number',
    extract: (target: MarkInstance) => target.duration,
  },
  power: {
    path: 'power',
    type: 'number',
    extract: (target: UseSkillContext) => target.power,
  },
  priority: {
    path: 'priority',
    type: 'number',
    extract: (target: UseSkillContext) => target.priority,
  },
  activePet: {
    path: 'activePet',
    type: 'Pet',
    extract: (target: Player) => target.activePet,
  },
  skills: {
    path: 'skills',
    type: 'SkillInstance[]',
    extract: (target: Pet) => target.skills,
  },
  id: {
    path: 'id',
    type: 'InstanceId',
    extract: (target: Instance) => target.id,
  },
  baseId: {
    path: 'base.id',
    type: 'PrototypeId',
    extract: (target: Instance) => target.base.id,
  },
  tags: {
    path: 'tags',
    type: 'string[]',
    extract: (target: MarkInstance) => target.tags,
  },
  rageCost: {
    path: 'rage',
    type: 'number',
    extract: (target: SkillInstance) => target.rage,
  },
  element: {
    path: 'element',
    type: 'Element',
    extract: (target: Pet) => target.element,
  },
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
    return (hasArray ? current : current[0]) as Path<T, P>
  }
}

export function createPathExtractor<T, P extends string>(type: string, path: P): PathExtractor<T, Path<T, P>> {
  return {
    path: path,
    type: RuntimeTypeChecker.getExpectedType(type, path),
    extract: createExtractor(path),
  }
}

export function isValidSelectorOpinion(value: unknown): value is SelectorOpinion {
  return (
    value instanceof Pet ||
    value instanceof MarkInstanceImpl ||
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
