import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectAuthorPreview, previewEndpoint } from '../authorPreview'

const endpoint = 'http://127.0.0.1:8123/' + 'a'.repeat(48)
afterEach(() => vi.unstubAllGlobals())

describe('author preview transport', () => {
  it('accepts only a local preview capability', () => {
    expect(previewEndpoint(endpoint)).toBe(endpoint)
    for (const value of [
      endpoint.replace('127.0.0.1', 'remote.example'),
      endpoint + '?secret=1',
      'file:///tmp/code',
      'http://127.0.0.1:8123/source',
    ])
      expect(() => previewEndpoint(value)).toThrow()
  })
  it('resumes message delivery after a transient poll failure and ready retry', async () => {
    let eventRequests = 0
    const request = vi.fn(async (input: string) => {
      const route = input.slice(endpoint.length + 1)
      if (route === 'content') return new Response(JSON.stringify({ content: { species: [], skills: [], marks: [] } }))
      if (route === 'open') return new Response(JSON.stringify({ result: { cursor: 0 } }))
      if (route.startsWith('events')) {
        if (++eventRequests === 1) throw new TypeError('connection interrupted')
        return new Response(
          JSON.stringify({
            cursor: 1,
            events:
              eventRequests === 2 ? [{ cursor: 1, message: { type: 'battleStart', data: {}, sequenceId: 1 } }] : [],
          }),
        )
      }
      return new Response(JSON.stringify({ result: null }))
    })
    vi.stubGlobal('fetch', request)
    const failed = vi.fn(),
      messages = vi.fn()
    const { system } = await connectAuthorPreview(endpoint, failed)
    system.BattleEvent(messages)
    try {
      await system.ready()
      await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
      await system.ready()
      await vi.waitFor(() => expect(messages).toHaveBeenCalledOnce())
      expect(request).toHaveBeenCalledWith(
        `${endpoint}/content`,
        expect.objectContaining({
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        }),
      )
    } finally {
      await system.cleanup()
    }
  })
})
