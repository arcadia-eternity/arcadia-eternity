export type MediaKind = 'image' | 'audio' | 'swf'
export const mediaLimits: Readonly<Record<MediaKind, number>>
export function mediaMimeForFile(file: string): string | undefined
export function mediaKindForMime(mime?: string): MediaKind | undefined
export function mediaKindForResource(row: {
  kind?: string
  mime?: string
  source: string
  tags?: readonly string[]
}): MediaKind | undefined
export function inspectMedia(kind: MediaKind, bytes: Uint8Array): string
export function validateSwfFile(buffer: ArrayBuffer): Promise<void>
