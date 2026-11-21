import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { version } from '../../../package.json'
import DownloadPage from '../downloadPage.vue'

const release = 'https://github.com/arcadia-eternity/arcadia-eternity/releases'
const assetUrl = (suffix: string) =>
  `${release}/download/arcadia-eternity-v${version}/Arcadia-Eternity-${version.replaceAll('+', '-')}-${suffix}`
const assets = ['win-x64.exe', 'win-x64.zip', 'mac-arm64.zip', 'mac-x64.zip', 'linux-x64.AppImage'].map(assetUrl)
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
const win =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

async function page(userAgent: string, maxTouchPoints = 0, userAgentData?: object) {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints, userAgentData })
  const wrapper = mount(DownloadPage, { global: { mocks: { $t: (_key: string, fallback: string) => fallback } } })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('offers only published desktop files and keeps manual selection for an unknown device', async () => {
  const wrapper = await page('Unknown')
  expect(
    wrapper
      .findAll('a')
      .map(a => a.attributes('href'))
      .filter(url => url?.includes('/download/'))
      .sort(),
  ).toEqual([...assets].sort())
  expect(wrapper.text()).not.toContain('推荐下载')
})

it.each([
  [win, 'x86', '64', 'win-x64.exe'],
  [mac, 'arm', '64', 'mac-arm64.zip'],
  [mac, 'x86', '64', 'mac-x64.zip'],
  ['Mozilla/5.0 (X11; Linux x86_64) Firefox/135.0', undefined, undefined, 'linux-x64.AppImage'],
] as const)('recommends the matching published file for %s / %s', async (ua, architecture, bitness, suffix) => {
  const wrapper = await page(
    ua,
    0,
    architecture ? { getHighEntropyValues: async () => ({ architecture, bitness }) } : undefined,
  )
  expect(wrapper.get('.recommended-download a').attributes('href')).toBe(assetUrl(suffix))
})

it.each([
  [mac, 5, undefined],
  [mac, 0, undefined],
  [
    win,
    0,
    {
      getHighEntropyValues: async () => {
        throw new Error('denied')
      },
    },
  ],
  [win, 0, { getHighEntropyValues: async () => ({ architecture: 'x86', bitness: '32' }) }],
  [win, 0, { getHighEntropyValues: async () => ({ architecture: 'arm', bitness: '64' }) }],
  ['Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile', 5, undefined],
  ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/145.0.0.0 Safari/537.36', 0, undefined],
] as const)('keeps manual selection for ambiguous and unsupported devices', async (ua, touch, hints) => {
  const wrapper = await page(ua, touch, hints)
  expect(wrapper.find('.recommended-download a').exists()).toBe(false)
  expect(wrapper.findAll('a').some(a => a.attributes('href') === assetUrl('mac-arm64.zip'))).toBe(true)
})

it('keeps direct links usable when the GitHub API is unavailable', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetch)
  const wrapper = await page(win)
  expect(wrapper.findAll('a').map(a => a.attributes('href'))).toEqual([...assets, release])
  expect(fetch).not.toHaveBeenCalled()
})

it('allows switching from a configured mirror to the official release', async () => {
  vi.stubEnv('VITE_DOWNLOAD_SOURCES', 'custom-cdn,github')
  vi.stubEnv('VITE_CDN_BASE_URL', 'https://mirror.example/releases/')
  const wrapper = await page('Unknown')
  expect(wrapper.get('.platform-card a').attributes('href')).toBe(
    assetUrl('win-x64.exe').replace(`${release}/download/arcadia-eternity-v`, 'https://mirror.example/releases/v'),
  )
  await wrapper.get('select').setValue(`${release}/download/arcadia-eternity-v${version}`)
  expect(wrapper.get('.platform-card a').attributes('href')).toBe(assetUrl('win-x64.exe'))
})
