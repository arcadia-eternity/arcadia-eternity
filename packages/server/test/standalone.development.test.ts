import { afterEach, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'
import { DevelopmentWorkspace } from '../src/standalone/dev-workspace'
import { createSingleProcessApp } from '../src/standalone/app'

const token = 'local-developer-token-0123456789abcdef'
const paths: string[] = []
const apps: ReturnType<typeof createSingleProcessApp>[] = []
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.stop()))
  await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-dev-workspace-')))
  paths.push(root)
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      arcadia: {
        projectId: 'author',
        namespace: 'author',
        content: 'content.json',
        exports: [{ id: 'slow', sourceKind: 'skill' }],
      },
    }),
  )
  await writeFile(
    join(root, 'content.json'),
    JSON.stringify({
      data: { species: [{ id: 'pet', hidden: { retained: true } }], skills: [], marks: [], behaviors: [] },
      assets: [],
    }),
  )
  return root
}

it('uses the actual source file and rejects stale updates while preserving hidden fields', async () => {
  const root = await fixture(),
    workspace = new DevelopmentWorkspace(root, token)
  const initial = await workspace.read()
  await chmod(join(root, 'content.json'), 0o640)
  expect(initial.project).toMatchObject({
    projectId: 'author',
    namespace: 'author',
    exports: [{ id: 'slow', sourceKind: 'skill' }],
  })
  const content = structuredClone(initial.content) as {
    data: { species: { id: string; hidden: { retained: boolean } }[] }
  }
  content.data.species[0].id = 'changed'
  const saved = await workspace.write(initial.revision, content)
  expect((await stat(join(root, 'content.json'))).mode & 0o777).toBe(0o640)
  expect(saved.revision).not.toBe(initial.revision)
  expect(JSON.parse(await readFile(join(root, 'content.json'), 'utf8')).data.species[0].hidden).toEqual({
    retained: true,
  })
  await expect(workspace.write(initial.revision, content)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  const external = await workspace.read()
  await writeFile(join(root, 'content.json'), JSON.stringify({ external: true }))
  await expect(workspace.write(external.revision, content)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  expect(JSON.parse(await readFile(join(root, 'content.json'), 'utf8'))).toEqual({ external: true })
})

it('serializes cooperating writers and rejects symbolic links', async () => {
  const root = await fixture(),
    a = new DevelopmentWorkspace(root, token),
    b = new DevelopmentWorkspace(root, token)
  const initial = await a.read()
  const results = await Promise.allSettled([
    a.write(initial.revision, { writer: 'a' }),
    b.write(initial.revision, { writer: 'b' }),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  await rm(join(root, 'content.json'))
  await symlink(join(root, 'package.json'), join(root, 'content.json'))
  await expect(a.read()).rejects.toMatchObject({ code: 'DEVELOPMENT_FILE' })
})

it('rejects an abandoned lock until the administrator explicitly removes it', async () => {
  const root = await fixture(),
    workspace = new DevelopmentWorkspace(root, token)
  const initial = await workspace.read()
  await writeFile(join(root, '.arcadia-content.lock'), '')
  await expect(workspace.write(initial.revision, initial.content)).rejects.toMatchObject({ code: 'DEVELOPMENT_BUSY' })
  await rm(join(root, '.arcadia-content.lock'))
  expect((await workspace.write(initial.revision, initial.content)).revision).toMatch(/^[a-f0-9]{64}$/)
})

it('rejects a replaced root and invalid package metadata', async () => {
  const root = await fixture(),
    workspace = new DevelopmentWorkspace(root, token)
  await workspace.read()
  const moved = `${root}-moved`
  paths.push(moved)
  await rename(root, moved)
  await symlink(moved, root)
  await expect(workspace.read()).rejects.toMatchObject({ code: 'DEVELOPMENT_PATH' })
  await rm(root)
  await rename(moved, root)
  await writeFile(join(root, 'package.json'), '{')
  await expect(workspace.read()).rejects.toMatchObject({ code: 'DEVELOPMENT_PACKAGE' })
})

it('rejects duplicate declared effect IDs in the source manifest', async () => {
  const root = await fixture(),
    workspace = new DevelopmentWorkspace(root, token)
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      arcadia: {
        projectId: 'author',
        namespace: 'author',
        content: 'content.json',
        exports: [
          { id: 'same', sourceKind: 'skill' },
          { id: 'same', sourceKind: 'petMark' },
        ],
      },
    }),
  )
  await expect(workspace.read()).rejects.toMatchObject({ code: 'DEVELOPMENT_PACKAGE' })
})

it('exposes editing only on an explicitly enabled loopback server with an independent bearer token', async () => {
  const root = await fixture()
  expect(() =>
    createSingleProcessApp({ development: { directory: root, token }, host: '0.0.0.0', corsOrigins: ['*'] }),
  ).toThrow()
  const app = createSingleProcessApp({
    host: '127.0.0.1',
    port: 0,
    corsOrigins: ['http://localhost:5173'],
    development: { directory: root, token },
  })
  apps.push(app)
  await app.start()
  const url = `http://127.0.0.1:${app.address!.port}/api/v1/development/content`
  expect((await fetch(url)).status).toBe(401)
  const forgedHost = await new Promise<number | undefined>((resolve, reject) => {
    const request = get(url, { headers: { Authorization: `Bearer ${token}`, Host: 'evil.example' } }, response => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('error', reject)
  })
  expect(forgedHost).toBe(401)
  expect(
    (await fetch(url, { headers: { Authorization: `Bearer ${token}`, Origin: 'http://attacker.test' } })).status,
  ).toBe(401)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const read = await fetch(url, { headers })
  expect(read.status).toBe(200)
  const body = (await read.json()) as { revision: string; content: Record<string, unknown> }
  expect(JSON.stringify(body)).not.toContain(token)
  body.content.extraMetadata = 'x'.repeat(40000)
  expect(
    (
      await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ revision: body.revision, content: body.content }),
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ revision: body.revision, content: body.content }),
      })
    ).status,
  ).toBe(409)
  const disabled = createSingleProcessApp({ host: '127.0.0.1', port: 0 })
  apps.push(disabled)
  await disabled.start()
  expect(
    (await fetch(`http://127.0.0.1:${disabled.address!.port}/api/v1/development/content`, { headers })).status,
  ).toBe(404)
}, 30000)

for (const change of [
  { projectId: 'renamed' },
  { namespace: 'renamed' },
  { exports: [{ id: 'other', sourceKind: 'skill' }] },
]) {
  it(`rejects a save after package metadata changes: ${Object.keys(change)[0]}`, async () => {
    const root = await fixture()
    const workspace = new DevelopmentWorkspace(root, token)
    const initial = await workspace.read()
    const original = await readFile(join(root, 'content.json'), 'utf8')
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    Object.assign(manifest.arcadia, change)
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
    await expect(workspace.write(initial.revision, { stale: true })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      status: 409,
    })
    expect(await readFile(join(root, 'content.json'), 'utf8')).toBe(original)
    const refreshed = await workspace.read()
    const saved = await workspace.write(refreshed.revision, refreshed.content)
    expect(saved.revision).toBe((await workspace.read()).revision)
  })
}
