import typeMetadata from './type-metadata.json' assert { type: 'json' }

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
  public static metadata: TypeMetadata = typeMetadata

  static validatePath(classType: string, path: string): boolean {
    // 拆分联合类型为多个独立类型
    const initialTypes = this.splitUnionTypes(classType)

    const parts = path.split(/(?<!\.)$$$$|\./g).filter(Boolean)

    const validate = (currentTypes: string[], remainingParts: string[]): boolean => {
      if (remainingParts.length === 0) return true

      return currentTypes.some(typeName => {
        // 处理当前类型的联合类型（递归拆分）
        const types = this.splitUnionTypes(typeName)

        return types.some(t => {
          // 处理基础类型
          if (['string', 'number', 'boolean'].includes(t)) {
            return remainingParts.length === 0
          }

          // 处理对象类型
          const typeInfo = this.metadata[t]
          if (!typeInfo) return false

          const currentPart = remainingParts[0]
          const restParts = remainingParts.slice(1)

          // 处理数组类型
          if (currentPart.endsWith('[]')) {
            const propName = currentPart.replace('[]', '')
            const propInfo = typeInfo.find(p => p.n === propName)
            return propInfo?.a ? validate([propInfo.nt || 'any'], restParts) : false
          }

          // 处理普通属性
          const propInfo = typeInfo.find(p => p.n === currentPart)
          if (!propInfo) return false

          // 处理属性自身的联合类型
          if (propInfo.iu) {
            return validate(propInfo.u, restParts)
          }

          return validate([propInfo.t], restParts)
        })
      })
    }

    return validate(initialTypes, parts)
  }

  static getExpectedType(classType: string, path: string): string {
    const parts = this.splitPath(path)
    const resultTypes = new Set<string>()

    this.processUnionType(classType, parts, resultTypes)

    // 合并最终类型并处理 undefined
    const finalTypes = Array.from(resultTypes)
    return finalTypes.length > 0 ? finalTypes.join(' | ') : 'unknown'
  }

  private static processUnionType(type: string, parts: string[], result: Set<string>, isOptional: boolean = false) {
    // 拆分联合类型
    this.splitUnionTypes(type).forEach(subType => {
      this.processSingleType(subType, parts, result, isOptional)
    })
  }

  private static processSingleType(
    currentType: string,
    remainingParts: string[],
    result: Set<string>,
    isOptional: boolean,
  ) {
    if (remainingParts.length === 0) {
      result.add(currentType)
      return
    }

    const [currentPart, ...restParts] = remainingParts
    const [prop, isArray] = currentPart.endsWith('[]') ? [currentPart.slice(0, -2), true] : [currentPart, false]

    // 处理基础类型
    if (['string', 'number', 'boolean'].includes(currentType)) {
      if (restParts.length === 0) result.add(currentType)
      return
    }

    // 获取类型元数据
    const typeInfo = this.metadata[currentType]
    if (!typeInfo) {
      result.add('undefined')
      return
    }

    // 查找属性定义
    const propInfo = typeInfo.find(p => p.n === prop)
    if (!propInfo) {
      result.add('undefined')
      return
    }

    // 处理数组类型
    if (isArray) {
      if (!propInfo.a) return // 非数组类型无法应用 []
      const elementType = propInfo.nt || 'any'
      this.processUnionType(elementType, restParts, result, true)
      return
    }

    // 处理联合类型属性
    if (propInfo.iu) {
      this.processUnionType(propInfo.u.join(' | '), restParts, result, isOptional)
      return
    }

    // 递归处理嵌套属性
    this.processUnionType(propInfo.t, restParts, result, isOptional)
  }

  private static splitUnionTypes(typeString: string): string[] {
    return typeString
      .split('|')
      .map(t => t.trim())
      .filter(Boolean)
  }

  private static splitPath(path: string): string[] {
    return path.split(/(?<!\.)$$$$|\./g).filter(Boolean)
  }

  static isNumberType(typePath: string): boolean {
    const normalizedPath = typePath.replace(/\[\]$/g, '')
    const parts = normalizedPath.split('.')
    let currentType = parts[0]

    // 递归解析类型
    for (let i = 1; i < parts.length; i++) {
      const prop = parts[i]
      const typeInfo = this.metadata[currentType]?.find(p => p.n === prop)

      if (!typeInfo) return false

      currentType = typeInfo.t

      // 处理联合类型（取第一个匹配类型）
      if (typeInfo.iu && typeInfo.u.length > 0) {
        currentType = typeInfo.u[0]
      }
    }

    // 最终类型判断
    return currentType === 'number' || currentType === 'number[]'
  }
}
