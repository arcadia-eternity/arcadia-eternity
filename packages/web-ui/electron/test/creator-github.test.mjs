import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'
import { Octokit } from '@octokit/rest'
import { CreatorGitHub, creatorAction } from '../creator-github.mjs'

test('device grant, selected repository binding, tag, release status and confirmed dispatch through Octokit', async () => {
  const head = 'a'.repeat(40),
    repository = 'author/content',
    tag = 'v0.1.0',
    filename = 'content-0.1.0.tgz'
  const target = { head, repository, tag, filename, integrity: 'sha512-test' }
  const requests = []
  let allowToken,
    authenticated = 200,
    tagHead = head
  const grantReady = new Promise(resolve => {
    allowToken = resolve
  })
  const json = (data, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json', date: new Date().toUTCString() },
    })
  async function transport(url, options) {
    const path = decodeURIComponent(new URL(url).pathname)
    const body = options.body && JSON.parse(options.body)
    requests.push({ path, method: options.method, body })
    if (path === '/login/device/code') {
      assert.ok(!body.scope && !body.client_secret)
      return json({
        user_code: '1234-5678',
        device_code: 'private-device',
        verification_uri: 'https://github.com/login/device',
        interval: 1,
      })
    }
    if (path === '/login/oauth/access_token') {
      await grantReady
      return json({
        access_token: 'private-test-token',
        scope: '',
        token_type: 'bearer',
        expires_in: 28800,
        refresh_token: 'private-refresh',
        refresh_token_expires_in: 36000,
      })
    }
    assert.match(options.headers.authorization, /private-test-token/)
    if (authenticated !== 200) return json({ message: 'denied' }, authenticated)
    if (path === '/user') return json({ login: 'author' })
    if (path === '/user/installations') return json({ total_count: 1, installations: [{ id: 7 }] })
    if (path === '/user/installations/7/repositories')
      return json({ total_count: 1, repositories: [{ full_name: repository }] })
    if (path === '/user/repos') {
      assert.deepEqual(body, { name: 'content', private: true, auto_init: false })
      return json({ full_name: repository }, 201)
    }
    if (path.endsWith('/actions/runs'))
      return json({
        workflow_runs: [
          {
            id: 12,
            path: '.github/workflows/release-pack.yml',
            head_sha: head,
            status: 'completed',
            conclusion: 'failure',
            name: 'Release content pack',
          },
        ],
      })
    if (path.endsWith('/releases/tags/' + tag))
      return json({
        tag_name: tag,
        draft: false,
        assets: [
          { name: 'unrelated.txt', state: 'uploaded' },
          { name: filename, state: 'uploaded', digest: 'sha256:' + 'a'.repeat(64) },
        ],
      })
    if (path.endsWith('/git/ref/tags/' + tag)) return json({ object: { type: 'tag', sha: 'b'.repeat(40) } })
    if (path.endsWith('/git/tags/' + 'b'.repeat(40))) return json({ object: { type: 'commit', sha: tagHead } })
    if (path.endsWith('/workflows/release-pack.yml/dispatches')) return json(null, 204)
    throw Error('Unexpected route ' + path)
  }
  const service = new CreatorGitHub({
    clientId: 'Iv23li1234567890abcdef',
    makeClient: options =>
      new Octokit({
        ...options,
        log: { debug() {}, info() {}, warn() {}, error() {} },
        request: {
          ...options.request,
          fetch: async (...args) => {
            const response = await transport(...args)
            Object.defineProperty(response, 'url', { value: String(args[0]) })
            return response
          },
        },
      }),
  })
  const bound = []
  const manager = {
    session: () => ({ workspace: { assertWritable() {} } }),
    githubTarget: async () => ({ ...target }),
    git: (id, input) => bound.push(input),
  }
  const action = (operation, input = {}, confirm = async () => true) =>
    creatorAction(
      service,
      manager,
      { id: 'project', operation, ...input },
      { confirm, open: () => assert.fail('browser must stay closed') },
    )
  await action('connect')
  for (let i = 0; !service.account().verification && i < 100; i++) await pause(10)
  assert.deepEqual(service.account().verification, { code: '1234-5678', url: 'https://github.com/login/device' })
  assert.doesNotMatch(JSON.stringify(service.account()), /private-/)
  allowToken()
  for (let i = 0; service.account().connecting && i < 100; i++) await pause(10)
  assert.equal(service.account().login, 'author')
  assert.deepEqual(await action('repositories'), [repository])
  await assert.rejects(action('bind', { repository: 'other/content' }), /授权/)
  await action('bind', { repository })
  assert.deepEqual(bound, [{ operation: 'bind', url: 'https://github.com/author/content.git' }])
  assert.equal(await action('create', { name: 'content', private: true }, async () => false), null)
  assert.equal(await action('create', { name: 'content', private: true }), repository)
  const dashboard = await action('dashboard')
  assert.equal(dashboard.runs[0].conclusion, 'failure')
  assert.equal(dashboard.release.integrity, 'sha256-' + Buffer.from('a'.repeat(64), 'hex').toString('base64'))
  assert.equal(
    dashboard.release.archive,
    'https://github.com/author/content/releases/download/v0.1.0/content-0.1.0.tgz',
  )
  const publish = { jobId: 'verified', publishNpm: false }
  assert.equal(await action('dispatch', publish, async () => false), null)
  await assert.rejects(
    action('dispatch', publish, async () => {
      target.head = 'changed'
      return true
    }),
    /已变化/,
  )
  target.head = head
  tagHead = 'incorrect'
  await assert.rejects(action('dispatch', publish), /标签/)
  tagHead = head
  assert.deepEqual(await action('dispatch', publish), { submitted: true })
  assert.deepEqual(
    requests.filter(request => request.path.endsWith('/dispatches')).map(request => request.body),
    [{ ref: tag, inputs: { publish_npm: 'false', expected_integrity: target.integrity } }],
  )
  await assert.rejects(action('open', { url: 'https://github.com.evil.example/new' }), /地址无效/)
  authenticated = 403
  await assert.rejects(action('repositories'), /权限/)
  authenticated = 401
  await assert.rejects(action('repositories'), /失效/)
  assert.equal(service.account().login, undefined)
})

test('a disconnected device grant cannot restore a session after the browser finishes', async () => {
  let finish
  const waiting = new Promise(resolve => {
    finish = resolve
  })
  const service = new CreatorGitHub({
    clientId: 'Iv23li1234567890abcdef',
    deviceAuth:
      ({ onVerification }) =>
      async () => {
        onVerification({ user_code: 'USER-CODE', verification_uri: 'https://github.com/login/device' })
        return waiting
      },
    makeClient: () => ({
      request() {},
      rest: { users: { getAuthenticated: () => assert.fail('cancelled grant made an authenticated request') } },
    }),
  })
  service.connect()
  assert.equal(service.account().verification.code, 'USER-CODE')
  service.disconnect()
  finish({ token: 'cancelled-credential' })
  await pause(0)
  assert.equal(service.account().login, undefined)
  assert.equal(service.account().verification, undefined)
  await assert.rejects(service.repositories(), /连接/)
})
