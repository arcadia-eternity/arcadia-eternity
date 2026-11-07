import { afterEach, describe, expect, it, vi } from 'vitest'
import { officialAssetUrl } from '../officialAssetUrl'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('officialAssetUrl', () => {
  it('keeps normal builds on their original resource hosts', () => {
    vi.stubEnv('VITE_STATIC_MODE', '')
    expect(officialAssetUrl('https://seer2-resource.yuuinih.com/png/pet/3.png')).toBe(
      'https://seer2-resource.yuuinih.com/png/pet/3.png',
    )
  })

  it('resolves official media under a static subdirectory while retaining custom pack URLs', () => {
    vi.stubEnv('VITE_STATIC_MODE', '1')
    vi.stubEnv('BASE_URL', './')
    vi.stubGlobal('document', { baseURI: 'https://example.test/game/#/battle?dev=true' })
    expect(officialAssetUrl('https://seer2-resource.yuuinih.com/png/pet/3.png')).toBe(
      'https://example.test/game/official-assets/resource/png/pet/3.png',
    )
    expect(officialAssetUrl('https://seer2-pet-resource.yuuinih.com/public/fight/3.swf')).toBe(
      'https://example.test/game/official-assets/pet/public/fight/3.swf',
    )
    expect(officialAssetUrl('https://creator.test/pet.png')).toBe('https://creator.test/pet.png')
    expect(officialAssetUrl('blob:https://example.test/custom')).toBe('blob:https://example.test/custom')
    expect(officialAssetUrl('/assets/custom.png')).toBe('/assets/custom.png')
  })
})
