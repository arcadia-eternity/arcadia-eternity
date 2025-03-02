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
import type { SelectorOpinion } from './selector'
import type { ValueExtractor } from './effectBuilder'

export interface ChainableExtractor<T extends SelectorOpinion, U extends SelectorOpinion> {
  path: string
  extract: ValueExtractor<T, U>
  typePath: string
}

type ExtractorMap = {
  hp: ChainableExtractor<Pet, number>
  maxhp: ChainableExtractor<Pet, number>
  rage: ChainableExtractor<Player, number>
  owner: ChainableExtractor<OwnedEntity, Battle | Player | Pet | MarkInstance | SkillInstance | null>
  type: ChainableExtractor<Pet, Element>
  marks: ChainableExtractor<Pet, MarkInstance[]>
  stats: ChainableExtractor<Pet, StatOnBattle>
  stack: ChainableExtractor<MarkInstance, number>
  duration: ChainableExtractor<MarkInstance, number>
  power: ChainableExtractor<UseSkillContext, number>
  priority: ChainableExtractor<UseSkillContext, number>
  activePet: ChainableExtractor<Player, Pet>
  skills: ChainableExtractor<Pet, SkillInstance[]>
  id: ChainableExtractor<Instance, InstanceId>
  baseId: ChainableExtractor<Instance, PrototypeId>
  tags: ChainableExtractor<MarkInstance, string[]>
}

export const Extractor: ExtractorMap = {
  hp: {
    path: 'hp',
    typePath: 'number',
    extract: (target: Pet) => target.currentHp,
  },
  maxhp: {
    path: 'maxhp',
    typePath: 'number',
    extract: (target: Pet) => target.maxHp!,
  },
  rage: {
    path: 'rage',
    typePath: 'number',
    extract: (target: Player) => target.currentRage,
  },
  owner: {
    path: 'owner',
    typePath: 'OwnedEntity.owner',
    extract: (target: OwnedEntity) => target.owner!,
  },
  type: {
    path: 'type',
    typePath: 'Element',
    extract: (target: Pet) => target.element,
  },
  marks: {
    path: 'marks',
    typePath: 'MarkInstance[]',
    extract: (target: Pet) => target.marks,
  },
  stats: {
    path: 'stats',
    typePath: 'StatOnBattle',
    extract: (target: Pet) => target.stat,
  },
  stack: {
    path: 'stack',
    typePath: 'number',
    extract: (target: MarkInstance) => target.stack,
  },
  duration: {
    path: 'duration',
    typePath: 'number',
    extract: (target: MarkInstance) => target.duration,
  },
  power: {
    path: 'power',
    typePath: 'number',
    extract: (target: UseSkillContext) => target.power,
  },
  priority: {
    path: 'priority',
    typePath: 'number',
    extract: (target: UseSkillContext) => target.skillPriority,
  },
  activePet: {
    path: 'activePet',
    typePath: 'Pet',
    extract: (target: Player) => target.activePet,
  },
  skills: {
    path: 'skills',
    typePath: 'SkillInstance[]',
    extract: (target: Pet) => target.skills,
  },
  id: {
    path: 'id',
    typePath: 'InstanceId',
    extract: (target: Instance) => target.id,
  },
  baseId: {
    path: 'base.id',
    typePath: 'PrototypeId',
    extract: (target: Instance) => target.base.id,
  },
  tags: {
    path: 'tags',
    typePath: 'string[]',
    extract: (target: MarkInstance) => target.tags,
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
