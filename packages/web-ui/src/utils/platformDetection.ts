import { UAParser } from 'ua-parser-js'
import { isAppleSilicon } from 'ua-parser-js/device-detection'
import { isFrozenUA } from 'ua-parser-js/helpers'
import type { Architecture, Platform } from '@/types/download'

interface BrowserInfo extends Pick<Navigator, 'userAgent' | 'maxTouchPoints'> {
  userAgentData?: {
    mobile?: boolean
    platform?: string
    getHighEntropyValues?(keys: string[]): Promise<{ architecture?: string; bitness?: string }>
  }
}

export async function getPlatformInfo(browser: BrowserInfo = navigator): Promise<{
  platform?: Platform
  architecture?: Architecture
  isMobile: boolean
}> {
  const parsed = new UAParser(browser.userAgent).getResult()
  const hints = browser.userAgentData
  const os = hints?.platform || parsed.os.name
  const mac = os === 'macOS' || os === 'Mac OS'
  if (
    hints?.mobile ||
    parsed.device.type === 'mobile' ||
    parsed.device.type === 'tablet' ||
    ['Android', 'iOS', 'iPadOS', 'Windows Phone'].includes(os ?? '') ||
    (mac && browser.maxTouchPoints > 1)
  )
    return { isMobile: true }

  let platform: Platform | undefined
  if (!parsed.device.type) {
    if (os === 'Windows') platform = 'windows'
    else if (mac) platform = 'macos'
    else if (os === 'Linux' || /\bX11; (?:[^();]+; )?Linux\b/.test(browser.userAgent)) platform = 'linux'
  }
  if (!platform) return { isMobile: false }

  // Reduced Chromium user agents can report x64 on ARM machines.
  const cpu = isFrozenUA(browser.userAgent) ? undefined : parsed.cpu.architecture
  let architecture: Architecture | undefined
  if (cpu === 'amd64' && !mac) architecture = 'x64'
  if (cpu === 'arm64') architecture = 'arm64'

  try {
    const chip = await hints?.getHighEntropyValues?.(['architecture', 'bitness'])
    if (chip?.architecture) {
      architecture = undefined
      if (chip.bitness === '64') {
        if (chip.architecture === 'x86') architecture = 'x64'
        if (chip.architecture === 'arm') architecture = 'arm64'
      }
      return { platform, architecture, isMobile: false }
    }
  } catch {
    // Browsers may withhold client hints. Keep only independent evidence.
  }
  if (mac && !architecture && isAppleSilicon(parsed)) architecture = 'arm64'
  return { platform, architecture, isMobile: false }
}
