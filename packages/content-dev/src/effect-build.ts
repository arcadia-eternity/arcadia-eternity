import { readFile, writeFile, mkdir, rename, realpath, lstat, rm } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path'
import { compileEffectModule } from '@arcadia-eternity/pack-loader/effect-build'

/** Build closed effect text without evaluating author code. The installed artifact is consumed by environment preparation. */
export async function buildEffects(root: string): Promise<void> {
  root = await realpath(root)
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const directory = pkg.arcadia?.effectSources
  if (directory === undefined) return
  if (
    typeof directory !== 'string' ||
    !directory ||
    typeof pkg.arcadia.effectArtifact !== 'string' ||
    pkg.arcadia.effects
  )
    throw new Error('effectSources requires an effectArtifact destination and no effects entry')
  const source = resolve(root, directory),
    destination = resolve(root, pkg.arcadia.effectArtifact)
  for (const path of [source, destination]) {
    const rel = relative(resolve(root), path)
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Effect path escapes project')
  }
  const canonicalSource = await realpath(source)
  const sourceLocation = relative(root, canonicalSource)
  if (sourceLocation === '..' || sourceLocation.startsWith(`..${sep}`) || isAbsolute(sourceLocation))
    throw new Error('Effect source escapes project')
  let parent = root
  for (const segment of relative(root, dirname(destination)).split(sep).filter(Boolean)) {
    parent = resolve(parent, segment)
    await mkdir(parent, { recursive: true })
    const info = await lstat(parent)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Effect output must use regular project directories')
  }
  const artifact = await compileEffectModule(source, root, pkg.name)
  const temporary = `${destination}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(artifact) + '\n', { flag: 'wx' })
  try {
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

export { effectDiscoveryPlugin } from '@arcadia-eternity/pack-loader/effect-build'
