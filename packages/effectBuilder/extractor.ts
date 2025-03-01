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
  id: (target: Instance) => target.id,
  baseId: (target: Instance) => target.base.id,
  tags: (mark: MarkInstance) => mark.tags,
}

type SelectorOpinionPath<T> = T extends SelectorOpinion
  ? T
  : T extends Array<infer U>
    ? U extends SelectorOpinion
      ? T
      : never
    : never

export type Path<T, P extends string> = P extends `.${infer Rest}`
  ? Path<T, Rest>
  : P extends `${infer Head}[]${infer Tail}`
    ? Head extends keyof T
      ? T[Head] extends Array<infer U>
        ? Tail extends ''
          ? U[]
          : Path<U, Tail>
        : never
      : never
    : P extends `${infer Head}.${infer Tail}`
      ? Head extends keyof T
        ? Path<T[Head], Tail>
        : never
      : P extends keyof T
        ? SelectorOpinionPath<T[P]> // 此处能正确识别数组
        : never

export function createExtractor<T, P extends string>(path: P): (target: T) => Path<T, P> {
  const parts = (path.match(/([^\.\[\]]+|\[\])/g) || []).filter(p => p !== '')
  const hasArray = parts.includes('[]') // 检查路径中是否有数组访问符

  return (target: T) => {
    let current: any = [target]

    for (const part of parts) {
      if (current === null || current === undefined) {
        throw new Error(`路径访问中断：在 '${part}' 处遇到 null/undefined`)
      }

      if (part === '[]') {
        if (!Array.isArray(current)) {
          throw new Error(`路径错误：'${part}' 前导值不是数组`)
        }
        current = current.flat()
        continue
      }

      current = Array.isArray(current)
        ? current.flatMap(item => {
            const val = item?.[part as keyof typeof item]
            return val !== undefined ? [val] : []
          })
        : [current?.[part as keyof typeof current]]
    }

    // 根据路径中是否有数组访问符决定是否返回数组
    const finalValue = hasArray ? current : current[0]

    if (!isValidSelectorOpinion(finalValue)) {
      throw new Error(`路径 ${path} 解析到无效类型: ${typeof finalValue}`)
    }

    return finalValue as Path<T, P>
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
