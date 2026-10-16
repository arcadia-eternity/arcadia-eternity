import { z } from 'zod'
export type FileMetadata = {
  metaType: 'effect' | 'mark' | 'skill' | 'species'
  version: string
}

export const MetadataSchema = z.object({
  metaType: z.enum(['effect', 'mark', 'skill', 'species']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
}) satisfies z.ZodType<FileMetadata>

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
  return MetadataSchema.parse(metadata) as FileMetadata
}
