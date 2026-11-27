import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { fileWorkshopTrustStore } from '../src/workshop/file-store'
import type { WorkshopTrustState } from '../workshop'

let root: string
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

it('compares and replaces trust state atomically across stores and reclaims locks of exited processes', async () => {
  root = await mkdtemp(join(tmpdir(), 'workshop-store-'))
  // Two stores stand in for two processes: only the file lock orders their read-compare-write.
  const store = fileWorkshopTrustStore(root)
  const other = fileWorkshopTrustStore(root)
  const bump = (current: WorkshopTrustState | undefined): WorkshopTrustState => ({
    root: { signed: ((current?.root.signed as number) ?? 0) + 1, signatures: [] },
  })
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? store : other).update('reg-1', bump)))
  expect(JSON.parse(await readFile(join(root, 'reg-1.json'), 'utf8')).root.signed).toBe(20)
  expect(await readdir(root)).toEqual(['reg-1.json'])
  expect(await store.update('reg-1', () => undefined)).toBe(false)
  await writeFile(join(root, 'reg-1.json.lock'), '999999999')
  expect(await store.update('reg-1', bump)).toBe(true)
  await expect(store.update('../x', bump)).rejects.toThrow('WORKSHOP_REGISTRY_INVALID')
  expect(await store.read('missing')).toBeUndefined()
})
