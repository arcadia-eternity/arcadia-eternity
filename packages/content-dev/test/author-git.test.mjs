import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:https'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { authorGit, cloneAuthorRepository } from '../src/author-git.ts'
import { ManagedProjects } from '../src/managed-projects.ts'
import { AuthorWorkspace } from '../src/workspace.ts'

const exec = promisify(execFile)
const manifest = JSON.stringify({
  name: 'sample',
  version: '1.0.0',
  arcadia: { projectId: 'sample', namespace: 'example' },
})
const git = (cwd, ...args) => exec('git', args, { cwd })

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-author-git-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'package.json'), manifest)
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(() => workspace.close())
  const run = (operation, input) => authorGit(workspace, { ...input, operation })
  assert.equal((await run('status')).repository, false)
  await run('init')
  await git(root, 'config', 'user.name', 'Local test')
  await git(root, 'config', 'user.email', 'local@example.invalid')
  return { root, workspace, run }
}

test('the real index, worktree and reopened project retain separate changes', async t => {
  const { root, workspace, run } = await fixture(t)
  const file = '外部 文件.txt'
  await writeFile(join(root, file), 'first\n')
  await run('stage', { file })
  assert.ok((await run('unstage', { file })).files.find(row => row.path === file)?.untracked)
  await run('stage-files', { files: [file, 'package.json'] })
  await run('commit', { message: 'initial content' })
  await writeFile(join(root, file), 'second\n')
  await run('stage', { file })
  await writeFile(join(root, file), 'third\n')
  assert.match((await run('diff', { file, staged: true })).patch, /\+second/)
  assert.match((await run('diff', { file })).patch, /\+third/)
  const reopened = await AuthorWorkspace.open(root, { watch: false })
  try {
    assert.deepEqual(await authorGit(reopened, { operation: 'status' }), await run('status'))
  } finally {
    await reopened.close()
  }
  await assert.rejects(run('stage', { file: '../escape' }))
  workspace.setDirty(file, true)
  await assert.rejects(run('commit', { message: 'wrong revision' }), /草稿/)
  workspace.setDirty(file, false)
  await run('stage', { file })
  await run('commit', { message: 'external change' })
  assert.ok((await run('tag', { tag: 'v1.0.0' })).tags.includes('v1.0.0'))
  await git(root, 'switch', '-c', 'conflict')
  await writeFile(join(root, file), 'branch\n')
  await git(root, 'commit', '-am', 'branch change')
  await git(root, 'switch', 'main')
  await writeFile(join(root, file), 'main\n')
  await git(root, 'commit', '-am', 'main change')
  await assert.rejects(git(root, 'merge', 'conflict'))
  assert.ok((await run('status')).files.find(row => row.path === file)?.conflict)
  await assert.rejects(run('commit', { message: 'unresolved' }), /冲突/)
  await writeFile(join(root, '.git/hooks/pre-commit'), '')
  await assert.rejects(run('stage', { file }), /钩子/)
})

test('a new creator can commit without a local Git identity', async t => {
  const { root, run } = await fixture(t)
  await git(root, 'config', 'user.name', '')
  await git(root, 'config', 'user.email', '')
  const identity = { name: 'creator', email: '1234+creator@users.noreply.github.com' }
  assert.equal((await run('status')).head, '')
  await run('stage', { file: 'package.json' })
  const state = await run('commit', { message: '初始内容包', fallbackIdentity: identity })
  assert.match(state.head, /^[a-f0-9]{40,64}$/)
  assert.equal(
    (await git(root, 'show', '-s', '--format=%an <%ae>')).stdout.trim(),
    'creator <1234+creator@users.noreply.github.com>',
  )
  assert.equal((await git(root, 'config', 'user.email')).stdout.trim(), '')
})

test('linked repository metadata and read-only workspaces refuse writes', async t => {
  const { root, run } = await fixture(t)
  const readonly = await AuthorWorkspace.open(root, { watch: false, readOnly: true })
  try {
    await assert.rejects(authorGit(readonly, { operation: 'stage', file: 'package.json' }), /只读/)
  } finally {
    await readonly.close()
  }
  const parent = join(root, '.git/refs/heads/outside')
  await symlink(tmpdir(), parent, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(run('status'), /之外/)
})

test('package edits preserve identity and reject stale versions and invalid dependencies', async t => {
  const { workspace } = await fixture(t)
  const change = async input =>
    workspace.editPackage({ expectedVersion: (await workspace.read('package.json')).version, ...input })
  const stale = (await workspace.read('package.json')).version
  await change({ field: 'dependency', name: '@sample/dependency', value: '^2.1.0' })
  await assert.rejects(workspace.editPackage({ expectedVersion: stale, field: 'version', value: '2.0.0' }), /外部修改/)
  await assert.rejects(change({ field: 'dependency', name: 'bad', value: 'file:../bad' }))
  await change({ field: 'version', value: '2.0.0' })
  await change({ field: 'dependency', name: '@sample/dependency', value: null })
  assert.deepEqual(JSON.parse((await workspace.read('package.json')).text), {
    ...JSON.parse(manifest),
    version: '2.0.0',
  })
})

// Exercise the same HTTPS transport as the desktop without touching a hosted repository.
test('HTTPS clone, fetch, clean pull, explicit branch and tag pushes use a disposable remote', async t => {
  const { root, workspace, run } = await fixture(t)
  const host = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-git-origin-')))
  t.after(() => rm(host, { recursive: true, force: true }))
  await git(host, 'init', '--bare', '--initial-branch=main', 'origin.git')
  await git(join(host, 'origin.git'), 'config', 'http.receivepack', 'true')
  await exec(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      'key.pem',
      '-out',
      'cert.pem',
    ],
    { cwd: host },
  )
  const credential = 'disposable-git-test'
  const authorization = 'Basic ' + Buffer.from('x-access-token:' + credential).toString('base64')
  let requireCredential = false
  let denied = false
  const server = createServer(
    { key: await readFile(join(host, 'key.pem')), cert: await readFile(join(host, 'cert.pem')) },
    (req, res) => {
      if (requireCredential && req.headers.authorization !== authorization) {
        res.writeHead(401).end()
        return
      }
      if (denied) {
        res.writeHead(403).end()
        return
      }
      const url = new URL(req.url, 'https://localhost')
      const backend = spawn('git', ['http-backend'], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: host,
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: url.pathname,
          REQUEST_METHOD: req.method,
          QUERY_STRING: url.search.slice(1),
          CONTENT_TYPE: req.headers['content-type'] || '',
          REMOTE_USER: 'creator',
        },
      })
      req.pipe(backend.stdin)
      const chunks = []
      backend.stdout.on('data', chunk => chunks.push(chunk))
      backend.on('close', () => {
        const bytes = Buffer.concat(chunks),
          split = bytes.indexOf('\r\n\r\n')
        if (split < 0) {
          res.writeHead(500).end()
          return
        }
        for (const header of bytes.subarray(0, split).toString().split('\r\n')) {
          const colon = header.indexOf(':')
          const name = header.slice(0, colon),
            value = header.slice(colon + 1).trim()
          if (name === 'Status') res.statusCode = Number(value.split(' ')[0])
          else res.setHeader(name, value)
        }
        res.end(bytes.subarray(split + 4))
      })
    },
  )
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const oldCA = process.env.GIT_SSL_CAINFO
  process.env.GIT_SSL_CAINFO = join(host, 'cert.pem')
  t.after(() => {
    if (oldCA) process.env.GIT_SSL_CAINFO = oldCA
    else delete process.env.GIT_SSL_CAINFO
  })
  const url = 'https://127.0.0.1:' + server.address().port + '/origin.git'
  await run('stage', { file: 'package.json' })
  await run('commit', { message: 'initial' })
  await run('bind', { url })
  await assert.rejects(run('push', { destination: 'other' }), /重新确认/)
  await run('push', { destination: await run('push-target') })
  await run('tag', { tag: 'v1.0.0' })
  await run('push-tag', { destination: await run('tag-target') })
  assert.match((await git(join(host, 'origin.git'), 'tag')).stdout, /v1\.0\.0/)
  const copy = join(host, 'copy')
  await cloneAuthorRepository(copy, url)
  const cloned = await AuthorWorkspace.open(copy, { watch: false })
  t.after(() => cloned.close())
  await writeFile(join(root, 'external.txt'), 'remote change\n')
  await run('stage', { file: 'external.txt' })
  assert.equal((await run('commit', { message: 'update' })).ahead, 1)
  await run('push', { destination: await run('push-target') })
  assert.equal((await authorGit(cloned, { operation: 'fetch' })).behind, 1)
  cloned.setDirty('package.json', true)
  await assert.rejects(authorGit(cloned, { operation: 'pull' }), /草稿/)
  cloned.setDirty('package.json', false)
  await authorGit(cloned, { operation: 'pull' })
  assert.equal(await readFile(join(copy, 'external.txt'), 'utf8'), 'remote change\n')
  requireCredential = true
  const tokenFor = async target => {
    assert.equal(target, url)
    return credential
  }
  const appCopy = join(host, 'app-copy')
  await cloneAuthorRepository(appCopy, url, undefined, tokenFor)
  assert.equal(await readFile(join(appCopy, 'external.txt'), 'utf8'), 'remote change\n')
  assert.equal((await git(appCopy, 'remote', 'get-url', 'origin')).stdout.trim(), url)
  assert.doesNotMatch(await readFile(join(appCopy, '.git/config'), 'utf8'), /disposable-git-test|extraheader/i)
  await authorGit(workspace, { operation: 'push', destination: await run('push-target') }, undefined, tokenFor)
  await authorGit(cloned, { operation: 'fetch' }, undefined, tokenFor)
  await authorGit(cloned, { operation: 'pull' }, undefined, tokenFor)
  requireCredential = false
  const built = join(root, 'release')
  await mkdir(built)
  await writeFile(
    join(built, 'package.json'),
    JSON.stringify({
      name: 'prebuilt-example',
      version: '1.0.0',
      files: ['content.json'],
      scripts: { prepare: 'exit 91' },
      arcadia: { content: 'content.json', projectId: 'test', namespace: 'test', sdkApi: 2 },
    }),
  )
  await writeFile(join(built, 'content.json'), '{"data":{"skills":[],"species":[],"marks":[]}}')
  await git(root, 'add', 'release')
  await run('commit', { message: 'include prebuilt directory' })
  await run('push', { destination: await run('push-target') })
  const commit = (await git(root, 'rev-parse', 'HEAD')).stdout.trim()
  const installer = new ManagedProjects(join(host, 'consumer'), { offline: true })
  try {
    await installer.withSourceArchive(
      { kind: 'git', url, commit, artifactPath: 'release' },
      new AbortController().signal,
      async (file, provenance) => {
        assert.equal(provenance.commit, commit)
        assert.equal(provenance.name, 'prebuilt-example')
        assert.equal(provenance.artifactPath, 'release')
        assert.ok((await readFile(file)).length > 0)
      },
    )
  } finally {
    await installer.close()
  }
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(authorGit(workspace, { operation: 'fetch' }, cancelled.signal))
  denied = true
  await assert.rejects(run('fetch'), /403/)
  await new Promise(resolve => server.close(resolve))
  await assert.rejects(run('fetch'))
})

test('release dashboard resolves the local push repository, commit, package filename and matching clean tag', async t => {
  const { run, root, workspace } = await fixture(t)
  await run('bind', { url: 'https://github.com/example/content.git' })
  await run('stage', { file: 'package.json' })
  await run('commit', { message: 'verified source' })
  await run('tag', { tag: 'v1.0.0' })
  const target = await run('github-target')
  assert.deepEqual(target, {
    repository: 'example/content',
    manifestVersion: (await workspace.read('package.json')).version,
    packageRepositoryMatches: false,
    head: (await git(root, 'rev-parse', 'HEAD')).stdout.trim(),
    tag: 'v1.0.0',
    tagged: true,
    filename: 'sample-1.0.0.tgz',
  })
  await git(root, 'remote', 'add', 'fork', 'https://github.com/creator/fork.git')
  await git(root, 'update-ref', 'refs/remotes/fork/main', target.head)
  await git(root, 'branch', '--set-upstream-to=fork/main', 'main')
  assert.equal((await run('github-target')).repository, 'creator/fork')
  assert.match(await run('push-target'), /creator\/fork/)
  await writeFile(join(root, 'dirty.txt'), 'new material')
  assert.equal((await run('github-target')).tagged, false)
})
