export interface NpmPackFile {
  path: string
  size?: number
  mode?: number
}

export interface NpmPackEntry {
  name?: string
  version?: string
  filename: string
  files: NpmPackFile[]
  integrity?: string
  shasum?: string
}

function isFile(value: unknown): value is NpmPackFile {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { path?: unknown }).path === 'string'
  )
}

function isEntry(value: unknown): value is NpmPackEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as { filename?: unknown; files?: unknown }
  return typeof entry.filename === 'string' && Array.isArray(entry.files) && entry.files.every(isFile)
}

/** npm 12 reports `pack --json` as an object keyed by package name; earlier releases use an array. */
export function parseNpmPackOutput(stdout: string): NpmPackEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (cause) {
    throw new Error('npm returned invalid package receipt JSON', { cause })
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === 'object'
      ? Object.values(parsed)
      : undefined
  if (!entries || entries.length === 0 || !entries.every(isEntry))
    throw new Error('npm returned an invalid package receipt')
  return entries
}
