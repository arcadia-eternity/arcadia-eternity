import { lstat, readdir, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { errorCode, type UnknownRecord } from './types.ts'
import type { AuthorWorkspace } from './workspace.ts'

type GitTokenProvider = (url: string) => Promise<string>

function client(root: string, signal?: AbortSignal, disableHooks = true, transportEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {
    ...(process.env.GIT_SSL_CAINFO ? { GIT_SSL_CAINFO: process.env.GIT_SSL_CAINFO } : {}),
    ...transportEnv,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_CEILING_DIRECTORIES: dirname(root),
    GIT_OPTIONAL_LOCKS: '0',
  }
  return simpleGit({
    baseDir: root,
    strict: true,
    allowEnvironment: Object.keys(env),
    allowConfig: [
      'core.hooksPath',
      'core.fsmonitor',
      'submodule.recurse',
      ...(transportEnv.GIT_CONFIG_COUNT
        ? ['credential.helper', 'http.followRedirects', transportEnv.GIT_CONFIG_KEY_0!]
        : []),
    ],
    config: [
      ...(disableHooks ? ['core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null')] : []),
      'core.fsmonitor=false',
      'submodule.recurse=false',
    ],
    abort: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]),
  }).env({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_|^(EDITOR|PAGER)$/i.test(key))),
    ...env,
    GCM_INTERACTIVE: 'never',
  })
}

function httpsRemote(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('https://'))
    throw new Error('请输入 HTTPS 仓库地址')
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash) throw new Error('仓库地址不能包含凭据、查询参数或片段')
  return url.href
}

// The credential is supplied by the desktop for this specific URL and transfer only.
async function transferClient(root: string, url: string, signal?: AbortSignal, tokenFor?: GitTokenProvider) {
  if (!tokenFor) return client(root, signal)
  const token = await tokenFor(url)
  const encoded = Buffer.from('x-access-token:' + token).toString('base64')
  return client(root, signal, true, {
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'http.' + url + '.extraHeader',
    GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + encoded,
    GIT_CONFIG_KEY_1: 'http.followRedirects',
    GIT_CONFIG_VALUE_1: 'false',
    GIT_CONFIG_KEY_2: 'credential.helper',
    GIT_CONFIG_VALUE_2: '',
  })
}

export async function cloneAuthorRepository(
  directory: string,
  url: unknown,
  signal?: AbortSignal,
  tokenFor?: GitTokenProvider,
) {
  const remote = httpsRemote(url)
  const transport = await transferClient(dirname(directory), remote, signal, tokenFor)
  await transport.clone(remote, directory, ['--no-recurse-submodules', ...(tokenFor ? ['--no-checkout'] : [])])
  if (tokenFor) {
    const local = client(directory, signal)
    if ((await local.branchLocal()).all.length) await local.reset(['--hard', 'HEAD'])
  }
}

// A source project may sit inside a larger repository. Never operate on that parent
// or follow a gitfile to metadata outside the directory selected by the author.
async function repository(root: string, git: SimpleGit) {
  const meta = join(root, '.git')
  const entry = await lstat(meta).catch(error => {
    if (errorCode(error) !== 'ENOENT') throw error
  })
  if (!entry) return false
  if (!entry.isDirectory()) throw new Error('链接工作树请通过外部编辑器管理')
  // Metadata is local state too. A redirected ref, index or object directory can
  // otherwise turn an ordinary commit or fetch into a write outside this root.
  for (const child of await readdir(meta, { withFileTypes: true })) {
    if (child.isSymbolicLink() || child.name === 'commondir')
      throw new Error('Git 元数据包含外部链接，请通过外部编辑器管理')
  }
  for (const directory of ['refs', 'logs', 'objects']) {
    const entries = await readdir(join(meta, directory), { recursive: true, withFileTypes: true }).catch(error => {
      if (errorCode(error) !== 'ENOENT') throw error
      return []
    })
    if (
      entries.some(
        file =>
          file.isSymbolicLink() || (directory === 'objects' && ['alternates', 'http-alternates'].includes(file.name)),
      )
    )
      throw new Error('Git 引用或对象位于项目目录之外')
  }
  const keys = await git.raw([
    'config',
    '--file',
    join(meta, 'config'),
    '--no-includes',
    '--null',
    '--name-only',
    '--list',
  ])
  // Repository-local filters, includes, alternate work trees and command helpers
  // can alter even a status read. Global credential helpers belong to the OS user.
  const supported =
    /^(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|hookspath|ignorecase|precomposeunicode|autocrlf|symlinks|quotepath)|user\.(?:name|email|signingkey)|branch\..+\.(?:remote|merge|rebase|vscode-merge-base)|remote\.[\w.-]+\.(?:url|fetch|pushurl)|pull\.(?:rebase|ff)|push\.default|gui\.(?:wmstate|geometry))$/i
  if (keys.split('\0').some(key => key && !supported.test(key)))
    throw new Error('仓库使用自定义 Git 配置，请通过外部编辑器管理')
  if ((await realpath((await git.revparse(['--path-format=absolute', '--git-common-dir'])).trim())) !== meta)
    throw new Error('Git 元数据位于项目目录之外')
  return true
}

async function trackingRemote(git: SimpleGit, branch: string | null) {
  const upstream = branch
    ? await git.raw(['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', 'refs/heads/' + branch])
    : ''
  const [tracking, remoteRef] = upstream.trim().split('\0')
  const remotes = (await git.getRemotes(false)).map(item => item.name)
  const target = tracking || (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : '')
  return { target, remoteRef }
}

async function status(git: SimpleGit) {
  const state = await git.status(['--no-renames', '--untracked-files=all', '--ignore-submodules=all'])
  const head = (await git.raw(['rev-parse', '--revs-only', 'HEAD'])).trim()
  return {
    repository: true,
    head,
    branch: state.current,
    detached: state.detached,
    upstream: state.tracking,
    hasRemote: (await git.getRemotes(false)).length > 0,
    tags: state.isClean() && head ? (await git.tag(['--points-at', 'HEAD'])).trim().split('\n').filter(Boolean) : [],
    ahead: state.ahead,
    behind: state.behind,
    files: state.files.map(file => ({
      path: file.path,
      staged: file.index !== ' ' && file.index !== '?',
      changed: file.working_dir !== ' ',
      untracked: file.working_dir === '?',
      conflict: state.conflicted.includes(file.path),
    })),
  }
}

export async function authorGit(
  workspace: AuthorWorkspace,
  input: UnknownRecord,
  signal?: AbortSignal,
  tokenFor?: GitTokenProvider,
) {
  if (typeof input.operation !== 'string') throw new Error('不支持的 Git 操作')
  if (input.operation === 'status' || input.operation === 'diff') {
    await workspace.path('package.json')
  } else await workspace.assertWritable()
  const git = client(workspace.root, signal)
  const exists = await repository(workspace.root, git)
  if (input.operation === 'status') return exists ? status(git) : { repository: false }
  if (!exists) {
    if (input.operation !== 'init') throw new Error('请先初始化 Git 仓库')
    await git.init(['--initial-branch=main'])
    return status(git)
  }
  const state = await status(git)
  if (!['diff', 'push-target', 'tag-target', 'github-target'].includes(input.operation)) {
    const hooks = await client(workspace.root, signal, false).getConfig('core.hooksPath')
    const entries = await readdir(join(workspace.root, '.git/hooks')).catch(error => {
      if (errorCode(error) !== 'ENOENT') throw error
      return []
    })
    if (hooks.value || entries.some(name => !name.endsWith('.sample') && !name.startsWith('.')))
      throw new Error('此仓库已配置 Git 钩子，请通过外部编辑器完成写操作')
  }
  if (input.operation === 'github-target') {
    const { target: remote } = await trackingRemote(git, state.branch)
    if (!/^[\w][\w.-]*$/.test(remote)) return null
    const raw = (await git.raw(['remote', 'get-url', '--push', '--all', remote])).trim()
    const match = /^https:\/\/github\.com\/([a-z0-9-]+\/[a-z0-9._-]+?)(?:\.git)?\/?$/i.exec(raw)
    if (!match) return null
    const declared = await workspace.read('package.json')
    const manifest = JSON.parse(declared.text) as {
      name: string
      version: string
      repository?: string | { url?: string }
    }
    const url = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
    const packageRepositoryMatches =
      typeof url === 'string' && url.replace(/^git\+/, '').replace(/\.git$/, '') === 'https://github.com/' + match[1]
    const tag = 'v' + manifest.version
    const head = state.head || undefined
    return {
      repository: match[1],
      manifestVersion: declared.version,
      packageRepositoryMatches,
      head,
      tag,
      tagged: state.tags.includes(tag),
      filename: manifest.name.replace(/^@/, '').replace('/', '-') + '-' + manifest.version + '.tgz',
    }
  }
  if (input.operation === 'stage-files') {
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > 2000)
      throw new Error('请选择 1–2000 个文件')
    const changed = new Set(state.files.filter(file => file.changed && !file.conflict).map(file => file.path))
    const files: string[] = []
    for (const file of input.files) {
      if (typeof file !== 'string' || !changed.has(file)) throw new Error('文件状态已改变，请刷新')
      await workspace.path(file, { create: true })
      files.push(file)
    }
    await git.add(['--', ...files])
  } else if (['stage', 'unstage', 'diff'].includes(input.operation)) {
    const row = state.files.find(item => item.path === input.file)
    if (!row) throw new Error('文件状态已改变，请刷新')
    await workspace.path(row.path, { create: true })
    if (input.operation === 'diff') {
      if (row.untracked) return { text: (await workspace.read(row.path)).text }
      const patch = await git.diff([
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        ...(input.staged === true ? ['--cached'] : []),
        '--',
        row.path,
      ])
      if (Buffer.byteLength(patch) > 1024 * 1024) throw new Error('差异超过 1 MiB，请在外部编辑器查看')
      return { patch }
    }
    if (input.operation === 'stage') await git.add(['--', row.path])
    else await git.reset(['--', row.path])
  } else if (input.operation === 'commit') {
    if (
      workspace.hasDirtyFiles ||
      typeof input.message !== 'string' ||
      !input.message.trim() ||
      input.message.length > 4000 ||
      state.files.some(file => file.conflict)
    )
      throw new Error('请先保存草稿、处理冲突并填写提交说明')
    const identity = input.fallbackIdentity as { name?: string; email?: string } | undefined
    if (
      identity?.name &&
      identity.email &&
      (!(await git.getConfig('user.name')).value || !(await git.getConfig('user.email')).value)
    ) {
      const commitGit = client(workspace.root, signal, true, {
        GIT_AUTHOR_NAME: identity.name,
        GIT_COMMITTER_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_EMAIL: identity.email,
      })
      await commitGit.commit(input.message)
    } else await git.commit(input.message)
  } else if (input.operation === 'tag') {
    if (state.files.length || workspace.hasDirtyFiles) throw new Error('请先保存并提交所有修改')
    if (typeof input.tag !== 'string' || !/^v?[0-9][\w.+-]{0,100}$/.test(input.tag)) throw new Error('版本标签无效')
    await git.tag(['--', input.tag])
  } else if (input.operation === 'bind') {
    await git.addRemote('origin', httpsRemote(input.url))
  } else if (['fetch', 'pull', 'push', 'push-target', 'push-tag', 'tag-target'].includes(input.operation)) {
    if (state.detached || !state.branch) throw new Error('请先切换到本地分支')
    const { target, remoteRef } = await trackingRemote(git, state.branch)
    if (!/^[\w][\w.-]*$/.test(target)) throw new Error('请选择 HTTPS 远端')
    const tagPush = input.operation === 'push-tag' || input.operation === 'tag-target'
    const pushing = tagPush || input.operation === 'push' || input.operation === 'push-target'
    const urls = (await git.raw(['remote', 'get-url', ...(pushing ? ['--push'] : []), '--all', target]))
      .trim()
      .split('\n')
    if (urls.length !== 1) throw new Error('多个远端地址请在外部编辑器中管理')
    const url = httpsRemote(urls[0])
    const ref = remoteRef || 'refs/heads/' + state.branch
    if (!ref.startsWith('refs/heads/')) throw new Error('远端分支无效')
    let pushRef = 'refs/heads/' + state.branch + ':' + ref
    let destination = url + ' · ' + ref.slice(11)
    if (tagPush) {
      const tag = 'v' + JSON.parse((await workspace.read('package.json')).text).version
      if (workspace.hasDirtyFiles || !state.tags.includes(tag)) throw new Error('请先提交修改并创建当前版本标签')
      pushRef = 'refs/tags/' + tag + ':refs/tags/' + tag
      destination = url + ' · ' + tag
    }
    if (pushing) destination += ' · ' + (await git.revparse([pushRef.split(':')[0]])).trim()
    if (input.operation === 'push-target' || input.operation === 'tag-target') return destination
    if (pushing && input.destination !== destination) throw new Error('远端地址或分支已改变，请重新确认推送')
    const transport = await transferClient(workspace.root, url, signal, tokenFor)
    if (pushing) {
      await transport.push(target, pushRef, [...(tagPush ? [] : ['--set-upstream']), '--no-follow-tags'])
    } else if (input.operation === 'fetch')
      await transport.fetch(target, '+refs/heads/*:refs/remotes/' + target + '/*', ['--no-tags'])
    else {
      if (workspace.hasDirtyFiles || state.files.length) throw new Error('拉取前请先保存草稿并提交修改')
      await transport.fetch(target, ref, ['--no-tags'])
      if (workspace.hasDirtyFiles || (await status(git)).files.length) throw new Error('下载期间有修改，请先保存并提交')
      await git.merge(['--ff-only', 'FETCH_HEAD'])
    }
  } else throw new Error('不支持的 Git 操作')
  return status(git)
}
