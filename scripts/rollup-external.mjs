import { posix, win32 } from 'node:path'

/** Keep package imports external while bundling resolved source paths on every host. */
export function isExternalDependency(id) {
  return !id.startsWith('.') && id.charCodeAt(0) !== 0 && !posix.isAbsolute(id) && !win32.isAbsolute(id)
}
