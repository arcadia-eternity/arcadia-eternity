import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InstalledNpmPackage } from '../src/npm/inspect'
import { createDraft } from '../src/works/model'
import { preparePresentation } from '../src/npm/resources'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
function pkg(namespace: string): InstalledNpmPackage {
  return {
    name: namespace,
    version: '1.0.0',
    location: `node_modules/${namespace}`,
    dependencies: {},
    manifest: { formatVersion: 1, projectId: namespace, namespace, content: 'content.json', assets: {} },
    draft: createDraft(namespace, namespace, namespace),
    presentation: { version: 1, defaultLocale: 'zh-CN', resources: [], locales: {} },
  }
}

it('keeps HTTP resources as declarations without any network request or materialization', async () => {
  const remote = pkg('remote')
  const url = 'http://127.0.0.1:1/no-download.swf'
  remote.presentation!.resources.push({ kind: 'http', id: url, source: url })
  remote.draft!.data.species.push({ id: 'pet', presentation: { battle: { renderer: 'seer2-swf', source: url } } })
  const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network during prepare'))
  const result = await preparePresentation('/unused', [remote])
  expect(result[0].resources).toEqual([])
  expect(result[0].manifest.resources[0].source).toBe(url)
  expect(request).not.toHaveBeenCalled()
})

it('checks package-file integrity and requires an installed dependency for cross-package media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-presentation-'))
  roots.push(root)
  const consumer = pkg('consumer'),
    provider = pkg('provider')
  const bytes = Buffer.from('resource')
  const file = join(root, provider.location, 'assets/icon.png')
  await mkdir(join(root, provider.location, 'assets'), { recursive: true })
  await writeFile(file, bytes)
  provider.presentation!.resources.push({
    kind: 'file',
    id: 'assets/icon.png',
    source: 'assets/icon.png',
    mime: 'image/png',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
  consumer.draft!.data.species.push({
    id: 'pet',
    presentation: { icon: { namespace: 'provider', path: 'assets/icon.png' } },
  })
  await expect(preparePresentation(root, [consumer, provider])).rejects.toThrow('RESOURCE_REFERENCE')
  consumer.dependencies.provider = provider.location
  expect((await preparePresentation(root, [consumer, provider]))[1].resources[0].file).toBe(file)
  await writeFile(file, 'modified')
  await expect(preparePresentation(root, [consumer, provider])).rejects.toThrow('RESOURCE_INTEGRITY')
})

it('rejects locale entries that do not belong to the package content', async () => {
  const content = pkg('demo')
  content.presentation!.locales = { 'zh-CN': { skill: { missing: { name: 'missing' } } } }
  await expect(preparePresentation('/unused', [content])).rejects.toThrow('LOCALE_REFERENCE')
})
