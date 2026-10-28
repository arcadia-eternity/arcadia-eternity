import { expect, test, type Page, type Route } from 'playwright/test'

const apiBase = 'http://localhost:8102/api/v1'
const serverInfo = {
  serverId: 'g3-browser-test',
  bootId: 'g3-boot',
  authModes: ['guest', 'account'],
  accountProviders: ['email', 'github'],
  protocolVersion: 1,
}
const identities = [{ providerId: 'email', issuer: 'mailto', subject: 'player@example.com' }]

function accountSession(profile: { id: string; name: string }) {
  return {
    serverId: serverInfo.serverId,
    bootId: serverInfo.bootId,
    sessionId: 'account-session',
    seatId: 'account-seat',
    token: 'account-token',
    principal: { kind: 'account', accountId: 'account-1' },
    profile,
    expiresAt: Date.now() + 600_000,
  }
}

async function mockAccountApi(page: Page, completedProfiles: { id: string; name: string }[]) {
  await page.route(`${apiBase}/**`, route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders })
    const send = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers: corsHeaders, body: JSON.stringify(body) })
    if (path === '/server-info') return send(serverInfo)
    if (path === '/auth/email/challenges')
      return send({ challengeId: 'challenge-1', expiresAt: Date.now() + 600_000 }, 201)
    if (path === '/auth/email/complete' || path === '/auth/github/complete') {
      const profile = request.postDataJSON().profile as { id: string; name: string }
      completedProfiles.push(profile)
      if (!profile?.id || !profile?.name) return send({ code: 'INVALID_PROFILE' }, 400)
      return send({ session: accountSession(profile) }, 201)
    }
    if (path === '/account/identities') return send({ identities })
    return send({ code: 'NOT_MOCKED' }, 404)
  })
}

test('first-time email verification creates an account with a valid local profile', async ({ page }) => {
  const completedProfiles: { id: string; name: string }[] = []
  await mockAccountApi(page, completedProfiles)
  await page.goto('/account')
  await expect(page.getByText('登录或创建服务器账号')).toBeVisible()
  await expect(page.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible()
  await page.locator('input[type="email"]').fill('player@example.com')
  await page.getByRole('button', { name: '发送登录验证码' }).click()
  await page.locator('input[autocomplete="one-time-code"]').fill('12345678')
  await page.getByRole('button', { name: '验证并登录' }).click()
  await expect(page.getByText('已绑定的登录方式')).toBeVisible()
  expect(completedProfiles).toHaveLength(1)
  expect(completedProfiles[0].id).toBeTruthy()
  expect(completedProfiles[0].name).toBeTruthy()
})

test('GitHub callback is scrubbed before delayed game assets load and uses an initialized profile', async ({
  page,
}) => {
  const completedProfiles: { id: string; name: string }[] = []
  await mockAccountApi(page, completedProfiles)
  await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), {
    key: `server-github:${encodeURIComponent(apiBase)}:${serverInfo.serverId}`,
    value: {
      state: 'pending-state',
      browserSecret: 'tab-held-secret',
      intent: 'login',
      expiresAt: Date.now() + 600_000,
    },
  })

  let releaseRuffle: (() => void) | undefined
  let assetReferer: string | undefined
  await page.route('**/ruffle/ruffle.js*', async (route: Route) => {
    assetReferer = route.request().headers().referer
    await new Promise<void>(resolve => {
      releaseRuffle = resolve
    })
    await route.abort()
  })

  await page.goto('/account?code=one-time-code&state=pending-state', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => Boolean(releaseRuffle)).toBe(true)
  expect(page.url()).not.toContain('one-time-code')
  expect(page.url()).not.toContain('pending-state')
  expect(assetReferer).not.toContain('one-time-code')
  releaseRuffle!()
  await expect(page.getByText('已绑定的登录方式')).toBeVisible()
  expect(completedProfiles).toHaveLength(1)
  expect(completedProfiles[0].id).toBeTruthy()
  expect(completedProfiles[0].name).toBeTruthy()
})
