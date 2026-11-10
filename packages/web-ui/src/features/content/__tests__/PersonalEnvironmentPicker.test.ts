import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { PersonalEnvironmentReference } from '@arcadia-eternity/protocol'
import type { PreparedPersonalEnvironment } from '@/services/personalEnvironment'
import PersonalEnvironmentPicker from '../PersonalEnvironmentPicker.vue'

const services = vi.hoisted(() => ({
  create: vi.fn(),
  parse: vi.fn(),
  encode: vi.fn(),
  download: vi.fn(),
  read: vi.fn(),
}))
vi.mock('@/services/personalEnvironment', () => ({
  createPersonalEnvironmentBundle: services.create,
  parsePersonalEnvironmentBundle: services.parse,
  encodePersonalEnvironmentBundle: services.encode,
  downloadPersonalEnvironment: services.download,
  PERSONAL_ENVIRONMENT_MAX_BYTES: 128 * 1024 * 1024,
  PERSONAL_ENVIRONMENT_DOWNLOAD_MAX_BYTES: 64 * 1024 * 1024,
}))
vi.mock('@/services/resourceTransport', () => ({ readResourceBytes: services.read }))
const originalUrl = URL
const pages: VueWrapper[] = []
const button = (page: VueWrapper, text: string) => page.findAll('button').find(item => item.text() === text)!
function reference(id = 'a'.repeat(64), https = false): PersonalEnvironmentReference {
  return {
    kind: 'personal',
    protocolVersion: 1,
    descriptor: {
      id,
      protocolVersion: 1,
      executionPolicy: 'peer',
      peerRevision: `revision-${id.slice(0, 4)}`,
      runtime: {} as PersonalEnvironmentReference['descriptor']['runtime'],
      packages: [{ name: '@friend/ice', version: '1.0.0', projectId: 'ice', namespace: 'ice' }],
      resourceRevision: 'resource-1',
      resources: [],
    },
    rules: { schemaVersion: 1 },
    source: https
      ? { kind: 'https', url: 'https://share.example/environment.json' }
      : { kind: 'file', name: 'environment.json' },
  }
}
function prepared(id?: string): PreparedPersonalEnvironment {
  const ref = reference(id)
  return {
    reference: ref,
    environment: { revision: ref.descriptor.peerRevision },
    content: { species: [], skills: [], marks: [] },
    acceptance: {
      environmentId: ref.descriptor.id,
      protocolVersion: 1,
      resourceRevision: 'resource-1',
      resourcesReady: true,
    },
    bundle: { portable: 'fixture' },
    release: vi.fn(),
  } as unknown as PreparedPersonalEnvironment
}
function open(props: Record<string, unknown> = {}) {
  const page = mount(PersonalEnvironmentPicker, { props })
  pages.push(page)
  return page
}
async function chooseFile(
  page: VueWrapper,
  file = new File(['{"format":"test"}'], 'environment.json', { type: 'application/json' }),
) {
  const input = page.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  Object.values(services).forEach(mock => mock.mockReset())
  services.parse.mockResolvedValue(prepared())
  services.create.mockResolvedValue({ portable: 'capture' })
  services.download.mockResolvedValue(prepared())
  services.read.mockResolvedValue(new TextEncoder().encode('{"format":"download"}'))
  services.encode.mockReturnValue('{"portable":true}')
  vi.stubGlobal('arcadiaDesktop', undefined)
  vi.stubGlobal('arcadiaRemotePlay', undefined)
  vi.stubGlobal(
    'URL',
    Object.assign(class extends originalUrl {}, {
      createObjectURL: vi.fn(() => 'blob:personal-download'),
      revokeObjectURL: vi.fn(),
    }),
  )
})
afterEach(() => {
  pages.splice(0).forEach(page => page.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('personal challenge environment picker', () => {
  it('shows the fixed environment without automatic fetching or remote-window desktop access', () => {
    const capture = vi.fn()
    vi.stubGlobal('arcadiaRemotePlay', { capturePersonalEnvironment: capture })
    const page = open({ expected: reference(undefined, true) })
    expect(page.text()).toContain('@friend/ice')
    expect(page.text()).toContain('revision-aaaa')
    expect(page.text()).toContain('双方需接受同一版本才能准备')
    expect(services.download).not.toHaveBeenCalled()
    expect(services.read).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
    expect(page.findAll('button').some(item => item.text() === '使用并接受本机环境')).toBe(false)
    expect(page.find('.url-form').exists()).toBe(false)
  })

  it('rejects oversized files before reading and emits a clear error', async () => {
    const page = open()
    const file = new File(['{}'], 'huge.json')
    Object.defineProperty(file, 'size', { value: 128 * 1024 * 1024 + 1 })
    await chooseFile(page, file)
    expect(services.parse).not.toHaveBeenCalled()
    expect(page.emitted('prepared')).toBeUndefined()
    expect(page.emitted('error')![0]![0]).toContain('128 MiB')
  })

  it('transfers accepted material ownership to its parent without aborting its signal on disable or unmount', async () => {
    const result = prepared()
    services.parse.mockImplementation(async (_raw, _source, signal: AbortSignal) => {
      signal.addEventListener('abort', result.release, { once: true })
      return result
    })
    const page = open({ expected: reference() })
    await chooseFile(page)
    await vi.waitFor(() => expect(page.emitted('prepared')).toHaveLength(1))
    const call = services.parse.mock.calls[0]!
    expect(call[0]).toBe('{"format":"test"}')
    expect(call[1]).toEqual({ kind: 'file', name: 'environment.json' })
    expect(page.emitted('prepared')![0]![0]).toBe(result)
    await page.setProps({ disabled: true, expected: reference('b'.repeat(64)) })
    page.unmount()
    expect((call[2] as AbortSignal).aborted).toBe(false)
    expect(result.release).not.toHaveBeenCalled()
    result.release()
    expect(result.release).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])(
    'enforces expected version identity unless replacement is explicitly allowed (%s)',
    async allowReplace => {
      const result = prepared('b'.repeat(64))
      services.parse.mockResolvedValue(result)
      const page = open({ expected: reference(), allowReplace })
      await chooseFile(page)
      await vi.waitFor(() => expect(services.parse).toHaveBeenCalled())
      await flushPromises()
      if (allowReplace) {
        expect(page.emitted('prepared')![0]![0]).toBe(result)
        expect(result.release).not.toHaveBeenCalled()
      } else {
        expect(page.emitted('prepared')).toBeUndefined()
        expect(result.release).toHaveBeenCalledTimes(1)
        expect(page.get('[role="alert"]').text()).toContain('版本不同')
      }
    },
  )

  it.each(['expected', 'disabled', 'unmount'] as const)(
    'cancels pending work and releases a late result on %s change',
    async change => {
      const late = deferred<PreparedPersonalEnvironment>()
      const result = prepared()
      services.parse.mockReturnValue(late.promise)
      const page = open({ expected: reference() })
      await chooseFile(page)
      await vi.waitFor(() => expect(services.parse).toHaveBeenCalled())
      const signal = services.parse.mock.calls[0]![2] as AbortSignal
      if (change === 'unmount') page.unmount()
      else if (change === 'expected') await page.setProps({ expected: reference('b'.repeat(64)) })
      else await page.setProps({ disabled: true })
      expect(signal.aborted).toBe(true)
      late.resolve(result)
      await flushPromises()
      expect(result.release).toHaveBeenCalledTimes(1)
      expect(page.emitted('prepared')).toBeUndefined()
      expect(page.emitted('error')).toBeUndefined()
    },
  )

  it('downloads an expected HTTPS reference only after explicit acceptance', async () => {
    const expected = reference(undefined, true)
    const page = open({ expected })
    expect(services.download).not.toHaveBeenCalled()
    await button(page, '下载并接受房间环境').trigger('click')
    await flushPromises()
    expect(services.download).toHaveBeenCalledWith(expected, expect.any(AbortSignal))
    expect(services.read).not.toHaveBeenCalled()
    expect(page.emitted('prepared')).toHaveLength(1)
  })

  it('validates a new HTTPS link before bounded downloading and passes its source to the parser', async () => {
    const page = open()
    await page.get('input[type="url"]').setValue('http://share.example/environment.json')
    await page.get('.url-form').trigger('submit')
    expect(services.read).not.toHaveBeenCalled()
    expect(page.get('[role="alert"]').text()).toContain('HTTPS')
    await page.get('input[type="url"]').setValue('https://share.example/environment.json')
    await page.get('.url-form').trigger('submit')
    await flushPromises()
    expect(services.read).toHaveBeenCalledWith('https://share.example/environment.json', {
      signal: expect.any(AbortSignal),
      maxBytes: 64 * 1024 * 1024,
    })
    expect(services.parse).toHaveBeenCalledWith(
      '{"format":"download"}',
      { kind: 'https', url: 'https://share.example/environment.json' },
      expect.any(AbortSignal),
    )
    expect(page.emitted('prepared')).toHaveLength(1)
  })

  it('captures local contents only through the trusted desktop API and never builds after cancellation', async () => {
    const late = deferred<unknown>()
    const capture = vi.fn(() => late.promise)
    vi.stubGlobal('arcadiaDesktop', { capturePersonalEnvironment: capture })
    const page = open()
    await button(page, '使用并接受本机环境').trigger('click')
    expect(capture).toHaveBeenCalledTimes(1)
    await button(page, '取消准备').trigger('click')
    late.resolve({ environment: { revision: 'capture' }, content: {}, runtime: {}, packages: [] })
    await flushPromises()
    expect(services.create).not.toHaveBeenCalled()
    expect(services.parse).not.toHaveBeenCalled()
    expect(page.emitted('prepared')).toBeUndefined()
    expect(page.emitted('error')).toBeUndefined()
  })

  it('prepares a trusted desktop capture with the fixed room rules', async () => {
    const capture = { environment: { revision: 'capture' }, content: {}, runtime: {}, packages: [] }
    vi.stubGlobal('arcadiaDesktop', { capturePersonalEnvironment: vi.fn().mockResolvedValue(capture) })
    const expected = reference()
    const page = open({ expected })
    await button(page, '使用并接受本机环境').trigger('click')
    await flushPromises()
    expect(services.create).toHaveBeenCalledWith(capture, expected.rules, expect.any(AbortSignal))
    expect(services.parse).toHaveBeenCalledWith(
      { portable: 'capture' },
      { kind: 'file', name: 'personal-environment.arcadia.json' },
      expect.any(AbortSignal),
    )
    expect(page.emitted('prepared')).toHaveLength(1)
  })

  it('exports only on click from the portable bundle and revokes the temporary download URL', async () => {
    const result = prepared()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(`arcadia-environment-${'a'.repeat(12)}.json`)
      expect(this.href).toBe('blob:personal-download')
    })
    const page = open({ prepared: result })
    expect(services.encode).not.toHaveBeenCalled()
    await button(page, '导出已接受的环境').trigger('click')
    expect(services.encode).toHaveBeenCalledWith(result.bundle)
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a[download]')).toBeNull()
    page.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:personal-download')
    expect(result.release).not.toHaveBeenCalled()
    expect(services.download).not.toHaveBeenCalled()
    expect(services.read).not.toHaveBeenCalled()
  })
})
