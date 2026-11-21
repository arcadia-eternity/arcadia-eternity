import type { PresentationManifest } from '@arcadia-eternity/schema'
import type { PackageManifest } from './src/workspace.ts'
export function requireClientRange(source: PackageManifest): void
export function releasePayload(
  source: PackageManifest,
  included: Iterable<string>,
  presentation?: PresentationManifest,
): PackageManifest & { files: string[] }

export function normalizeReleaseArchive(path: string): Promise<{ integrity: string; shasum: string; size: number }>
