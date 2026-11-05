export type ManagedSource =
  | { kind: 'archive'; file: string }
  | { kind: 'directory'; directory: string }
  | { kind: 'url'; url: string; integrity?: string }
  | { kind: 'git'; url: string; commit: string; artifactPath?: string }
export interface SourceAcquisitionOptions {
  destination: string
  signal?: AbortSignal
  maxBytes?: number
  maxFiles?: number
  timeoutMs?: number
}
export function acquireSource(
  source: ManagedSource,
  options: SourceAcquisitionOptions,
): Promise<{
  directory: string
  provenance: Record<string, string>
}>
