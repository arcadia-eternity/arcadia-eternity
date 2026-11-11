import { expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePackEntriesFromRef, resolvePackPathFromRef } from '../../pack'

it('resolves built-in packs from package metadata and keeps the legacy root layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-pack-references-'))
  const oldPacks = process.env.ARCADIA_PACKS_DIR
  try {
    const packs = join(root, 'packs')
    const artifact = join(packs, 'base')
    const artifactManifest = join(artifact, 'dist', 'pack.json')
    const legacy = join(packs, 'legacy')
    const legacyManifest = join(legacy, 'pack.json')
    const manifest = (id: string) =>
      JSON.stringify({
        id,
        version: '1.0.0',
        engine: 'seer2-v2',
        data: { effects: [], marks: [], skills: [], species: [] },
      })
    await mkdir(join(artifact, 'dist'), { recursive: true })
    await writeFile(
      join(artifact, 'package.json'),
      JSON.stringify({ name: '@arcadia-eternity/data-pack-base', arcadiaEternityPack: 'dist/pack.json' }),
    )
    await writeFile(artifactManifest, manifest('arcadia-eternity.base'))
    await mkdir(legacy)
    await writeFile(legacyManifest, manifest('fixture.legacy'))
    process.env.ARCADIA_PACKS_DIR = packs

    expect(await resolvePackPathFromRef('builtin:base')).toMatch(/packs\/base\/dist\/pack\.json$/)
    expect(await resolvePackEntriesFromRef('builtin:workspace')).toEqual([artifactManifest, legacyManifest])
  } finally {
    if (oldPacks === undefined) delete process.env.ARCADIA_PACKS_DIR
    else process.env.ARCADIA_PACKS_DIR = oldPacks
    await rm(root, { recursive: true, force: true })
  }
})
