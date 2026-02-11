import { Type, type Static } from '@sinclair/typebox'
import { parseWithErrors } from './utils'

export type FileMetadata = {
  metaType: 'effect' | 'mark' | 'skill' | 'species'
  version: string
}

export const MetadataSchema = Type.Object({
  metaType: Type.Union([
    Type.Literal('effect'),
    Type.Literal('mark'),
    Type.Literal('skill'),
    Type.Literal('species'),
  ]),
  version: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$' }),
})

export function extractMetadata(content: string): FileMetadata {
  const metadata = content
    .split('\n')
    .filter(line => line.startsWith('# @'))
    .reduce(
      (acc, line) => {
        const [key, ...values] = line.slice(3).split(/\s+/) // 使用 slice 替代 replace
        if (key && values.length) {
          acc[key] = values.join(' ')
        }
        return acc
      },
      {} as Record<string, string>,
    )

  // 添加类型断言
  return parseWithErrors(MetadataSchema, metadata) as FileMetadata
}
