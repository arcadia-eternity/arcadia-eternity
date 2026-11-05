import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { ContentWorkspace } from '../src/content-workspace.mjs'
import { ManagedProjects } from '../src/managed-projects.mjs'

test(
  'editing registry package versions resolves new locked bytes while previous versions stay unchanged',
  { timeout: 60000 },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-managed-registry-'))
    let workspace, projects, server
    t.after(async () => {
      await projects?.close()
      await workspace?.close()
      if (server?.listening) {
        server.closeAllConnections()
        await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
      }
      await rm(root, { recursive: true, force: true })
    })
    const key = join(root, 'key.pem'),
      cert = join(root, 'cert.pem')
    const config = join(root, 'openssl.conf')
    await writeFile(
      config,
      '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\n',
    )
    await promisify(execFile)(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-config', config],
      { timeout: 10000 },
    )
    const archives = new Map()
    for (const version of ['1.0.0', '2.0.0']) {
      const cwd = join(root, version)
      await mkdir(join(cwd, 'package'), { recursive: true })
      await writeFile(
        join(cwd, 'package/package.json'),
        JSON.stringify({
          name: 'registry-probe',
          version,
          scripts: { postinstall: 'node -e "throw new Error(\'author script executed\')"' },
        }),
      )
      await writeFile(join(cwd, 'package/content.json'), JSON.stringify({ power: version === '1.0.0' ? 40 : 99 }))
      await writeFile(join(cwd, 'package/index.js'), 'throw new Error("module must never execute")')
      const file = join(cwd, 'package.tgz')
      await create({ cwd, file, gzip: true, portable: true }, ['package'])
      archives.set(version, await readFile(file))
    }
    const requests = []
    let origin
    server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
      requests.push(request.url)
      if (request.url === '/registry-probe') {
        const versions = Object.fromEntries(
          [...archives].map(([version, bytes]) => [
            version,
            {
              name: 'registry-probe',
              version,
              dist: {
                tarball: origin + '/registry-probe-' + version + '.tgz',
                integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
              },
            },
          ]),
        )
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ name: 'registry-probe', versions, 'dist-tags': { latest: '2.0.0' } }))
        return
      }
      const match = /^\/registry-probe-(1\.0\.0|2\.0\.0)\.tgz$/.exec(request.url)
      if (!match) {
        response.statusCode = 404
        response.end()
        return
      }
      response.setHeader('content-type', 'application/octet-stream')
      response.end(archives.get(match[1]))
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    origin = 'https://localhost:' + server.address().port
    const npmrc = join(root, 'test.npmrc')
    await writeFile(npmrc, 'cafile=' + cert + '\nstrict-ssl=true\nfetch-retries=0\n')
    await writeFile(npmrc + '.global', '')
    workspace = await ContentWorkspace.open(join(root, 'workspace'))
    projects = new ManagedProjects(join(root, 'projects'), {
      registry: origin,
      npmUserConfig: npmrc,
      allowThirdPartyContent: true,
      timeoutMs: 20000,
    })
    const document = {
      schemaVersion: 1,
      id: 'main',
      name: 'Registry test',
      packages: { 'registry-probe': '1.0.0' },
      sources: [],
    }
    let draft = await workspace.saveDraft({ document, expectedRevision: null })
    const validate = async ({ directory }) => {
      const installed = JSON.parse(await readFile(join(directory, 'node_modules/registry-probe/package.json'), 'utf8'))
      const data = JSON.parse(await readFile(join(directory, 'node_modules/registry-probe/content.json'), 'utf8'))
      const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'))
      assert.equal(lock.packages['node_modules/registry-probe'].version, installed.version)
      assert.match(lock.packages['node_modules/registry-probe'].integrity, /^sha512-/)
      await assert.rejects(access(join(directory, 'node_modules/registry-probe/executed')))
      return {
        contentRevision: 'probe:' + installed.version + ':' + data.power,
        packages: [{ name: installed.name, version: installed.version }],
      }
    }
    const first = await projects.prepareVersion(
      workspace,
      { environmentId: 'main', expectedRevision: draft.revision },
      validate,
    )
    draft = await workspace.saveDraft({
      document: { ...document, packages: { 'registry-probe': '2.0.0' } },
      expectedRevision: draft.revision,
    })
    const second = await projects.prepareVersion(
      workspace,
      { environmentId: 'main', expectedRevision: draft.revision },
      validate,
    )
    assert.equal(first.contentRevision, 'probe:1.0.0:40')
    assert.equal(second.contentRevision, 'probe:2.0.0:99')
    assert.notEqual(first.versionId, second.versionId)
    assert.equal(
      JSON.parse(await readFile(join(first.directory, 'node_modules/registry-probe/content.json'), 'utf8')).power,
      40,
    )
    assert.equal(
      JSON.parse(await readFile(join(second.directory, 'node_modules/registry-probe/content.json'), 'utf8')).power,
      99,
    )
    assert.ok(requests.includes('/registry-probe-1.0.0.tgz'))
    assert.ok(requests.includes('/registry-probe-2.0.0.tgz'))
    assert.equal((await workspace.listVersions()).length, 2)
  },
)
