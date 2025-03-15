// type-analyzer.ts
import { Project, PropertySignature, Type, TypeAliasDeclaration } from 'ts-morph'
export type PropertyTypeInfo = {
  name: string
  type: string
  isUnion: boolean
  unionTypes: string[]
  isArray: boolean
  nestedType?: string
}
// 类型元数据结构
export type ClassTypeInfo = {
  className: string
  properties: PropertyTypeInfo[]
}

export class TypeAnalyzer {
  private project: Project
  private typeCache = new Map<string, ClassTypeInfo>()
  private maxDepth = 5

  constructor(tsConfigPath: string) {
    this.project = new Project({ tsConfigFilePath: tsConfigPath })
  }

  analyzeClasses(): Map<string, ClassTypeInfo> {
    const sourceFiles = this.project.getSourceFiles()

    sourceFiles.forEach(sourceFile => {
      sourceFile.getClasses().forEach(classDeclaration => {
        const className = classDeclaration.getName()!
        const typeInfo: ClassTypeInfo = {
          className,
          properties: [],
        }
        const collectedProperties = new Map<string, any>()

        // 1. 处理普通属性
        classDeclaration.getProperties().forEach(property => {
          const propName = property.getName()
          const type = property.getType()
          collectedProperties.set(propName, this.parseType(propName, type))
        })

        // 2. 处理构造函数中的 public 参数
        classDeclaration.getConstructors().forEach(constructor => {
          constructor.getParameters().forEach(param => {
            const modifiers = param.getModifiers()
            const isPublicProperty = modifiers.some(
              m => m.getKindName() === 'PublicKeyword' || m.getKindName() === 'ReadonlyKeyword',
            )

            if (isPublicProperty) {
              const propName = param.getName()
              const type = param.getType()
              if (!collectedProperties.has(propName)) {
                collectedProperties.set(propName, this.parseType(propName, type))
              }
            }
          })
        })

        // 3. 处理 getter 方法（新增部分）
        classDeclaration.getGetAccessors().forEach(getter => {
          const propName = getter.getName()
          try {
            const returnType = getter.getReturnType()
            const parsedType = this.parseType(propName, returnType)

            // Getter 优先级高于普通属性
            collectedProperties.set(propName, parsedType)
          } catch (e) {
            console.warn(`Failed to parse return type for getter ${className}.${propName}`)
          }
        })

        // 将收集的属性转为数组
        typeInfo.properties = Array.from(collectedProperties.values())
        this.typeCache.set(className, typeInfo)
      })

      sourceFile.getTypeAliases().forEach(typeAlias => {
        const typeName = typeAlias.getName()
        const typeInfo: ClassTypeInfo = {
          className: typeName,
          properties: this.parseTypeAlias(typeAlias),
        }

        this.typeCache.set(typeName, typeInfo)
      })

      // 处理接口
      sourceFile.getInterfaces().forEach(interfaceDeclaration => {
        const interfaceName = interfaceDeclaration.getName()!
        const typeInfo: ClassTypeInfo = {
          className: interfaceName,
          properties: [],
        }

        interfaceDeclaration.getProperties().forEach(property => {
          const propName = property.getName()
          const type = property.getType()

          typeInfo.properties.push(this.parseType(propName, type))
        })

        interfaceDeclaration.getGetAccessors().forEach(getter => {
          const propName = getter.getName()
          try {
            const returnType = getter.getReturnType()
            const parsedType = this.parseType(propName, returnType)

            // Getter 优先级高于普通属性
            typeInfo.properties.push(parsedType)
          } catch (e) {
            console.warn(`Failed to parse return type for getter ${interfaceName}.${propName}`)
          }
        })

        this.typeCache.set(interfaceName, typeInfo)
      })
    })

    return this.typeCache
  }

  private parseTypeAlias(typeAlias: TypeAliasDeclaration): PropertyTypeInfo[] {
    const type = typeAlias.getType()
    const checker = this.project.getTypeChecker()
    const properties: PropertyTypeInfo[] = []

    // 处理对象类型（包含映射类型）
    if (type.isObject()) {
      type.getProperties().forEach(symbol => {
        const propertyName = symbol.getName()
        const propertyType = checker.getTypeOfSymbolAtLocation(symbol, typeAlias)

        // 检测可选性
        const declaration = symbol.getDeclarations()?.[0] as PropertySignature | undefined
        const isOptional = (declaration?.hasQuestionToken ? declaration?.hasQuestionToken() : false) || false

        // 解析类型
        const parsed = this.parseType(propertyName, propertyType, 0, true)

        // 标记可选性
        if (isOptional) {
          parsed.unionTypes = [...parsed.unionTypes, 'undefined']
          parsed.isUnion = true
          parsed.type = parsed.unionTypes.join(' | ')
        }

        properties.push(parsed)
      })
    }
    // 处理 Record 映射类型
    else if (type.getText().startsWith('Record<')) {
      const [keyType, valueType] = type.getTypeArguments()
      const parsedKey = this.parseType('key', keyType, 0, true)
      const parsedValue = this.parseType('value', valueType, 0, true)

      properties.push({
        name: '[key]',
        type: `Record<${parsedKey.type}, ${parsedValue.type}>`,
        isUnion: false,
        unionTypes: [],
        isArray: false,
      })
    }
    // 处理联合类型
    else if (type.isUnion()) {
      const unionTypes = type.getUnionTypes().map(t => this.parseType('union', t, 0, true).type)
      properties.push({
        name: 'type',
        type: unionTypes.join(' | '),
        isUnion: true,
        unionTypes: unionTypes,
        isArray: false,
      })
    }

    return properties
  }

  private parseType(name: string, type: Type, depth: number = 0, isFromAlias: boolean = false) {
    if (depth > this.maxDepth) {
      return this.createFallbackType(name)
    }

    const aliasSymbol = type.getAliasSymbol()
    if (aliasSymbol && !isFromAlias) {
      const resolvedType = type.getAliasTypeArguments()[0] || type
      return this.parseType(name, resolvedType, depth + 1, true)
    }

    // 处理联合类型（深度展开）
    if (type.isUnion()) {
      const unionTypes = type.getUnionTypes().map(t => this.parseType('union', t, depth + 1).type)
      return {
        name,
        type: unionTypes.join(' | '),
        isUnion: true,
        unionTypes,
        isArray: false,
      }
    }
    let typeText = type.getText()

    // 新的处理流程
    typeText = typeText
      // 1. 保留完整的泛型参数（移除了清理泛型的步骤）
      // 2. 处理模块路径引用
      .replace(/import\(["'][^"']*["']\)\./g, '')
      // 3. 处理特殊后缀
      .replace(/\)\.default/g, '')
      // 4. 简化常见工具类型
      .replace(/\bRecord<([^>]+)>/g, (_, params) => {
        const [keyType, valueType] = params.split(',').map(t => t.trim())
        return `Record<${keyType}, ${valueType}>`
      })
      // 5. 压缩对象类型表示
      .replace(/\{\s*([\w]+):\s*([^;]+);\s*}\s*/g, (_, props) => {
        return props
          .split(';')
          .map(p => p.trim())
          .join(', ')
      })
      // 6. 处理联合类型
      .replace(/\s*\|\s*/g, ' | ')

    const isUnion = false
    const unionTypes = []

    // 智能识别对象类型
    const isObjectType = /^{.*}$/.test(typeText)
    if (isObjectType) {
      return this.handleObjectType(name, typeText)
    }

    // 处理数组类型（保持原逻辑）
    const isArray = /\[\]$/.test(typeText)
    const baseType = typeText.replace(/\[\]$/, '')

    return {
      name,
      type: baseType,
      isUnion,
      unionTypes,
      isArray,
      nestedType: isArray ? baseType : undefined,
    }
  }

  private handleObjectType(name: string, typeText: string) {
    // 标准化处理步骤
    let normalized = typeText
      .replace(/\s+/g, ' ') // 压缩多余空格
      .replace(/,\s*}/g, '}') // 去除末尾逗号
      .replace(/;\s*/g, ', ') // 替换分号为逗号
      .replace(/{ /g, '{')
      .replace(/ }/g, '}')

    // 识别 Record 类型模式（增强版）
    const recordMatch = normalized.match(/^{\[([^\]]+)\]:\s*([^}]+)}/)
    if (recordMatch) {
      const [_, keyDef, valueType] = recordMatch
      const keyType = keyDef.replace(/^(key|\w+)\s+(in|:)\s+/, '')
      return {
        name,
        type: `Record<${keyType}, ${valueType.trim()}>`,
        isUnion: false,
        unionTypes: [],
        isArray: false,
      }
    }

    // 处理普通对象类型
    const isObject = normalized.startsWith('{')
    if (isObject) {
      // 进一步简化对象表示
      normalized = normalized
        .replace(/{|}/g, '')
        .split(',')
        .map(prop => {
          const [pName, pType] = prop.split(':').map(s => s.trim())
          return pType ? `${pName}: ${pType}` : ''
        })
        .filter(Boolean)
        .join(', ')

      return {
        name,
        type: `{ ${normalized} }`,
        isUnion: false,
        unionTypes: [],
        isArray: false,
      }
    }

    return {
      name,
      type: normalized,
      isUnion: false,
      unionTypes: [],
      isArray: false,
    }
  }

  private createFallbackType(name: string): PropertyTypeInfo {
    return {
      name,
      type: 'any',
      isUnion: false,
      unionTypes: [],
      isArray: false,
    }
  }

  getTypeInfo(className: string): ClassTypeInfo | undefined {
    return this.typeCache.get(className)
  }
}
