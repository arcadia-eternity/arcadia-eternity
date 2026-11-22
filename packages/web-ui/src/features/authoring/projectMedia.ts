import { mediaKindForResource } from '../../../shared/media-formats.mjs'
import type { DraftMediaSource } from '@/services/mediaLoader'
import { authorCall, type ContentRow } from './types'

export function projectMedia(project: string | undefined, file: string, record?: ContentRow, revision?: number) {
  const kind = mediaKindForResource({
    kind: typeof record?.kind === 'string' ? record.kind : undefined,
    mime: typeof record?.mime === 'string' ? record.mime : undefined,
    source: file,
    tags: Array.isArray(record?.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
  })
  const source: DraftMediaSource = {
    scope: project ?? '',
    url: file,
    revision,
    sha256: typeof record?.sha256 === 'string' ? record.sha256 : undefined,
    read: /^https?:/i.test(file)
      ? undefined
      : async () => {
          const result = await authorCall<{ bytes: Uint8Array }>({ action: 'media', id: project, file })
          return result.bytes
        },
  }
  return { kind, source }
}
