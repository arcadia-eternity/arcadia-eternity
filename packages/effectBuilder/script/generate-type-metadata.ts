// generate-type-metadata.ts
import { TypeAnalyzer } from './type-analyzer'
import { writeFileSync } from 'fs'

const analyzer = new TypeAnalyzer('./tsconfig.json')
const typeMap = analyzer.analyzeClasses()

// 转换为更紧凑的格式
const metadata = Array.from(typeMap.values()).reduce(
  (acc, typeInfo) => {
    acc[typeInfo.className] = typeInfo.properties.map(p => ({
      n: p.name,
      t: p.type,
      iu: p.isUnion,
      u: p.unionTypes,
      a: p.isArray,
      nt: p.nestedType,
    }))
    return acc
  },
  {} as Record<string, any>,
)

writeFileSync('./type-metadata.json', JSON.stringify(metadata, null, 2))
