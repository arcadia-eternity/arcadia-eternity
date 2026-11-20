import { Octokit } from '@octokit/rest'
import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device'

const workflow = 'release-pack.yml'
const repositoryName = /^[a-z\d][a-z\d-]*\/[a-z\d._-]+$/i
function repositoryParts(fullName) {
  if (typeof fullName !== 'string' || fullName.length > 200 || !repositoryName.test(fullName))
    throw new Error('GitHub 仓库标识无效')
  const [owner, repo] = fullName.split('/')
  return { owner, repo }
}
function failure(error) {
  if (error.status === 401) return '创作授权已失效，请重新连接 GitHub。'
  if (error.status === 403) return 'GitHub 拒绝了操作，请检查创作 App 的仓库权限或 API 配额。'
  if (error.status === 404) return 'GitHub 未找到资源，请检查仓库授权、版本标签和发行工作流。'
  if (error.status === 422) return 'GitHub 拒绝了请求，请检查仓库名称、标签和工作流输入。'
  return 'GitHub 请求未完成，请检查网络与创作 App 配置后重试。'
}

// Device authorization needs only a public client ID. The main process owns the user token
// for this desktop session. No secret, refresh token or repository credential is persisted.
export class CreatorGitHub {
  #client
  #login
  #expires = 0
  #pending
  #verification
  #error
  constructor({ clientId, makeClient = options => new Octokit(options), deviceAuth = createOAuthDeviceAuth } = {}) {
    this.clientId = clientId
    this.makeClient = makeClient
    this.deviceAuth = deviceAuth
  }
  account() {
    if (this.#client && this.#expires <= Date.now()) {
      this.disconnect()
      this.#error = failure({ status: 401 })
    }
    return {
      configured: !!this.clientId,
      login: this.#login,
      connecting: !!this.#pending,
      verification: this.#verification,
      error: this.#error,
    }
  }
  connect(publicId) {
    if (this.account().connecting || this.#client) return this.account()
    const clientId = this.clientId || publicId
    if (typeof clientId !== 'string' || !/^Iv[0-9][A-Za-z0-9.]{10,64}$/.test(clientId))
      throw new Error('请输入专用 GitHub App 的公开 Client ID。')
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60 * 1000)])
    this.#pending = controller
    this.#error = undefined
    const request = this.makeClient({ request: { signal } }).request
    const auth = this.deviceAuth({
      clientType: 'github-app',
      clientId,
      request,
      onVerification: verification => {
        signal.throwIfAborted()
        if (verification.verification_uri !== 'https://github.com/login/device') throw new Error('无效的验证地址')
        this.#verification = { code: verification.user_code, url: verification.verification_uri }
      },
    })
    void (async () => {
      try {
        const grant = await auth({ type: 'oauth' })
        signal.throwIfAborted()
        const client = this.makeClient({ auth: grant.token, request: { timeout: 25000 } })
        const { data } = await client.rest.users.getAuthenticated({ request: { signal } })
        signal.throwIfAborted()
        this.#expires = Math.min(
          Date.now() + 8 * 60 * 60 * 1000,
          grant.expiresAt ? Date.parse(grant.expiresAt) : Infinity,
        )
        this.#client = client
        this.#login = data.login
      } catch (error) {
        if (this.#pending === controller) this.#error = failure(error)
      } finally {
        if (this.#pending === controller) {
          this.#pending = undefined
          this.#verification = undefined
        }
      }
    })()
    return this.account()
  }
  disconnect() {
    this.#pending?.abort()
    this.#pending = undefined
    this.#client = undefined
    this.#verification = undefined
    this.#error = undefined
    this.#login = undefined
  }
  async #using(action) {
    if (!this.account().login) throw new Error('请连接 GitHub 创作账号。')
    const api = this.#client
    try {
      return await action(api)
    } catch (error) {
      if (error.status === 401 && this.#client === api) this.disconnect()
      if (error.status || error.name === 'HttpError' || error.name === 'TypeError') throw new Error(failure(error))
      throw error
    }
  }
  repositories() {
    return this.#using(async api => {
      const installations = await api.paginate('GET /user/installations', { per_page: 100 })
      const repositories = new Set()
      for (const installation of installations) {
        const items = await api.paginate('GET /user/installations/{installation_id}/repositories', {
          installation_id: installation.id,
          per_page: 100,
        })
        for (const item of items) repositories.add(item.full_name)
      }
      return [...repositories].sort()
    })
  }
  async create(name, isPrivate) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(name) || typeof isPrivate !== 'boolean')
      throw new Error('仓库名称或可见性无效')
    return this.#using(
      async api =>
        (await api.rest.repos.createForAuthenticatedUser({ name, private: isPrivate, auto_init: false })).data
          .full_name,
    )
  }
  async dashboard(target) {
    if (!target?.repository) throw new Error('请先绑定 GitHub HTTPS 仓库。')
    const repo = repositoryParts(target.repository)
    return this.#using(async api => {
      const runs = await api.rest.actions.listWorkflowRunsForRepo({
        ...repo,
        head_sha: target.head || undefined,
        per_page: 30,
      })
      let release
      try {
        release = (await api.rest.repos.getReleaseByTag({ ...repo, tag: target.tag })).data
      } catch (error) {
        if (error.status !== 404) throw error
      }
      const asset = release?.assets.find(asset => asset.name === target.filename && asset.state === 'uploaded')
      const archive =
        asset && !release.draft
          ? 'https://github.com/' +
            target.repository +
            '/releases/download/' +
            encodeURIComponent(target.tag) +
            '/' +
            encodeURIComponent(asset.name)
          : undefined
      return {
        runs: runs.data.workflow_runs
          .filter(run => run.path?.split('@')[0] === '.github/workflows/' + workflow || run.head_sha === target.head)
          .slice(0, 12)
          .map(run => ({
            id: run.id,
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
            url: 'https://github.com/' + target.repository + '/actions/runs/' + run.id,
          })),
        release: release && {
          tag: release.tag_name,
          draft: release.draft,
          page: 'https://github.com/' + target.repository + '/releases/tag/' + encodeURIComponent(target.tag),
          archive,
          integrity:
            archive && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)
              ? 'sha256-' + Buffer.from(asset.digest.slice(7), 'hex').toString('base64')
              : undefined,
        },
      }
    })
  }
  dispatch(target, publishNpm) {
    const repo = repositoryParts(target.repository)
    return this.#using(async api => {
      const { data: ref } = await api.rest.git.getRef({ ...repo, ref: 'tags/' + target.tag })
      let object = ref.object
      if (object.type === 'tag') object = (await api.rest.git.getTag({ ...repo, tag_sha: object.sha })).data.object
      if (object.type !== 'commit' || object.sha !== target.head)
        throw new Error('远端标签与已验证提交不同，请检查标签。')
      if (this.#client !== api) throw new Error('GitHub 创作会话已断开')
      await api.rest.actions.createWorkflowDispatch({
        ...repo,
        workflow_id: workflow,
        ref: target.tag,
        inputs: { publish_npm: publishNpm ? 'true' : 'false', expected_integrity: target.integrity },
      })
      return { submitted: true }
    })
  }
}

// All external writes pass a native confirmation with the resolved repository and tag.
export async function creatorAction(service, manager, input, { confirm, open }) {
  const { id, operation } = input
  const { workspace } = await manager.session(id)
  await workspace.assertWritable()
  switch (operation) {
    case 'account':
      return service.account()
    case 'connect':
      return service.connect(input.clientId)
    case 'disconnect':
      service.disconnect()
      return service.account()
    case 'open': {
      const url = new URL(input.url)
      if (
        url.origin !== 'https://github.com' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/(?:new|login\/device|settings\/(?:installations|apps\/authorizations)|apps\/[\w-]+\/installations\/new|[\w.-]+\/[\w.-]+\/(?:actions\/runs\/\d+|releases\/tag\/[\w.+%-]+))$/.test(
          url.pathname,
        )
      )
        throw new Error('GitHub 地址无效')
      await open(url.href)
      return
    }
    case 'repositories':
      return service.repositories()
    case 'bind': {
      repositoryParts(input.repository)
      if (!(await service.repositories()).includes(input.repository)) throw new Error('未获得该仓库的创作授权')
      return manager.git(id, { operation: 'bind', url: 'https://github.com/' + input.repository + '.git' })
    }
    case 'create': {
      const { login } = service.account()
      if (
        !login ||
        !(await confirm('创建 GitHub 仓库？', login + '/' + input.name + ' · ' + (input.private ? '私有' : '公开')))
      )
        return null
      if (service.account().login !== login) throw new Error('GitHub 创作会话已变化')
      return service.create(input.name, input.private)
    }
    case 'save-repository': {
      const target = await manager.githubTarget(id)
      if (!target || input.repository !== target.repository || input.manifestVersion !== target.manifestVersion)
        throw new Error('仓库或包声明已变化，请刷新')
      await workspace.editPackage({
        field: 'repository',
        value: 'https://github.com/' + target.repository + '.git',
        expectedVersion: target.manifestVersion,
      })
      return
    }
    case 'dashboard': {
      const target = await manager.githubTarget(id)
      if (!target) return { target }
      try {
        return { target, ...(await service.dashboard(target)) }
      } catch (error) {
        return { target, error: error.message }
      }
    }
    case 'dispatch': {
      if (typeof input.jobId !== 'string' || typeof input.publishNpm !== 'boolean')
        throw new Error('请选择已验证的发行包')
      const { login } = service.account()
      if (!login) throw new Error('请连接 GitHub 创作账号。')
      const target = await manager.githubTarget(id, input.jobId)
      if (
        !(await confirm(
          '发布 GitHub Release？',
          [
            target.repository,
            target.tag,
            target.head,
            target.integrity,
            input.publishNpm ? '同时发布到 npm' : '仅 GitHub Release',
          ].join('\n'),
        ))
      )
        return null
      const current = await manager.githubTarget(id, input.jobId)
      if (
        current.head !== target.head ||
        current.repository !== target.repository ||
        current.integrity !== target.integrity ||
        current.tag !== target.tag
      )
        throw new Error('发行目标已变化，请重新确认')
      if (input.publishNpm && !current.packageRepositoryMatches)
        throw new Error('请先把 GitHub 仓库地址写入包声明，并重新检查发行包')
      if (service.account().login !== login) throw new Error('GitHub 创作会话已变化')
      return service.dispatch(current, input.publishNpm)
    }
    default:
      throw new Error('不支持的 GitHub 创作操作')
  }
}
