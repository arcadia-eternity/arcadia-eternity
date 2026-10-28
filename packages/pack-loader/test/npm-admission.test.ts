import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readNpmAdmission } from '../src/npm/admission'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function admission(record: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-admission-'))
  roots.push(root)
  const file = join(root, 'approval.json')
  await writeFile(file, JSON.stringify(record))
  return file
}
it('reads the explicit profile without a redundant installation digest', async () => {
  const file = await admission({ format: 'arcadia.npm-admission', version: 2, profile: 'local-development' })
  expect(await readNpmAdmission(file)).toEqual({ policy: { profile: 'local-development' } })
})
it.each([{ version: 1 }, { installationDigest: 'a'.repeat(64) }, { profile: 'unknown' }])(
  'rejects obsolete or invalid approval fields: %j',
  async change => {
    const file = await admission({
      format: 'arcadia.npm-admission',
      version: 2,
      profile: 'local-development',
      ...change,
    })
    await expect(readNpmAdmission(file)).rejects.toMatchObject({
      diagnostics: [{ code: 'NPM_ADMISSION', path: file, message: expect.any(String) }],
    })
  },
)
