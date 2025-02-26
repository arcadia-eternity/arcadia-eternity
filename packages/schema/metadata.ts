import { z } from 'zod'

export const MetadataSchema = z.object({
  metaType: z.enum(['effect', 'mark', 'skill', 'species']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
})

export type FileMetadata = z.infer<typeof MetadataSchema>

export function extractMetadata(content: string): FileMetadata {
  const metadataLines = content
    .split('\n')
    .filter(line => line.startsWith('# @'))
    .map(line => line.replace(/^#\s*@/, ''))

  const metadata = Object.fromEntries(
    metadataLines.map(line => {
      const [key, ...values] = line.split(/\s+/)
      return [key, values.join(' ')]
    }),
  )

  return MetadataSchema.parse(metadata)
}
