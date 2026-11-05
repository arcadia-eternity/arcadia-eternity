import { describe, expect, it } from 'vitest'
import { connectionPresentation } from '../connectionPresentation'

describe('connection identity', () => {
  it('shows offline even when a default or previous endpoint is selected', () => {
    expect(
      connectionPresentation({
        connected: false,
        endpoint: 'https://play.example.com',
        pageOrigin: 'https://play.example.com',
      }),
    ).toMatchObject({ label: '离线', kind: 'offline' })
  })
  it.each(['https://test-battle.fly.dev', 'https://player.example.com'])(
    'recognizes a website server by origin, not operator: %s',
    origin => {
      expect(connectionPresentation({ connected: true, endpoint: origin, pageOrigin: origin })).toMatchObject({
        kind: 'website',
        detail: `已连接当前网页的服务器：${origin}`,
      })
    },
  )
  it('shows the actual separate backend instead of claiming it lives at the website URL', () => {
    expect(
      connectionPresentation({
        connected: true,
        endpoint: 'https://api.player.example.com',
        pageOrigin: 'https://play.player.example.com',
      }),
    ).toMatchObject({ kind: 'remote', label: '远程 · api.player.example.com' })
  })
  it('identifies an explicit desktop connection as remote', () => {
    expect(
      connectionPresentation({
        connected: true,
        endpoint: 'https://player.example.com',
        pageOrigin: 'arcadia-client://app',
      }),
    ).toMatchObject({ kind: 'remote' })
  })
  it('recognizes the trusted running local server without classifying every loopback address as owned', () => {
    const input = { connected: true, endpoint: 'http://127.0.0.1:8102', pageOrigin: 'arcadia-client://app' }
    expect(connectionPresentation(input).kind).toBe('remote')
    expect(connectionPresentation({ ...input, localEndpoint: input.endpoint }).kind).toBe('local')
  })
})
