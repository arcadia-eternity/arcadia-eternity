// runtime-type-checker.ts
import { StatTypeWithoutHp } from '@test-battle/const'
import typeMetadata from './type-metadata.json'

type TypeMetadata = Record<
  string,
  Array<{
    n: string
    t: string
    iu: boolean
    u: string[]
    a: boolean
    nt?: string
  }>
>

export class RuntimeTypeChecker {
  private static metadata: TypeMetadata = typeMetadata

  static validatePath(classType: string, path: string): boolean {
    const parts = path.split(/(?<!\.)\[\]|\./g).filter(Boolean)

    const validate = (currentTypes: string[], remainingParts: string[]): boolean => {
      if (remainingParts.length === 0) return true

      return currentTypes.some(typeName => {
        // 处理基础类型
        if (['string', 'number', 'boolean'].includes(typeName)) {
          return remainingParts.length === 0
        }

        // 处理对象类型
        const typeInfo = this.metadata[typeName]
        if (!typeInfo) return false

        const currentPart = remainingParts[0]
        const restParts = remainingParts.slice(1)

        // 处理数组类型（保持原逻辑）
        if (currentPart.endsWith('[]')) {
          const propInfo = typeInfo.find(p => p.n === currentPart.replace('[]', ''))
          return propInfo?.a ? validate([propInfo.nt || 'any'], restParts) : false
        }

        // 处理嵌套属性
        const propInfo = typeInfo.find(p => p.n === currentPart)
        if (!propInfo) {
          return false
        }

        // 处理联合类型（保持原逻辑）
        if (propInfo.iu) {
          return validate(propInfo.u, restParts)
        }

        return validate([propInfo.t], restParts)
      })
    }

    return validate([classType], parts)
  }

  static getExpectedType(classType: string, path: string): string {
    const parts = path.split(/(?<!\.)\[\]|\./g).filter(Boolean)
    let currentType = classType

    for (const part of parts) {
      const typeInfo = this.metadata[currentType]
      if (!typeInfo) return 'unknown'

      const [prop, isArray] = part.endsWith('[]') ? [part.slice(0, -2), true] : [part, false]

      const propInfo = typeInfo.find(p => p.n === prop)
      if (!propInfo) return 'unknown'

      currentType = isArray ? propInfo.nt || 'any' : propInfo.t

      // 处理联合类型（直接拼接）
      if (propInfo.iu) {
        currentType = propInfo.u.join(' | ')
      }
    }

    return currentType
  }
}
