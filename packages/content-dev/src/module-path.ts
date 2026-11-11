import { fileURLToPath } from 'node:url'

const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js'

function siblingModuleUrl(name: string): string {
  return new URL(`./${name}${extension}`, import.meta.url).href
}

export function siblingModulePath(name: string): string {
  return fileURLToPath(siblingModuleUrl(name))
}
