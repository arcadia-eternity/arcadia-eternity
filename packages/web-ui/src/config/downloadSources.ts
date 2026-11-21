import type { DesktopDownload } from '@/types/download'

export const releasesUrl = 'https://github.com/arcadia-eternity/arcadia-eternity/releases'

export function getDownloadSources(version: string) {
  const tag = import.meta.env.VITE_DESKTOP_RELEASE_TAG || `arcadia-eternity-v${version}`
  const github = { name: 'GitHub Releases', base: `${releasesUrl}/download/${encodeURIComponent(tag)}` }
  const cdn: string | undefined = import.meta.env.VITE_CDN_BASE_URL?.trim().replace(/\/+$/, '')
  const enabled: string[] = (import.meta.env.VITE_DOWNLOAD_SOURCES || 'github')
    .split(',')
    .map((id: string) => id.trim())
  if (!cdn || !enabled.includes('custom-cdn')) return [github]
  const mirror = { name: 'CDN', base: `${cdn}/v${encodeURIComponent(version)}` }
  return enabled.includes('github') ? [mirror, github] : [mirror]
}

const targets = [
  { platform: 'windows', architecture: 'x64', format: 'exe' },
  { platform: 'windows', architecture: 'x64', format: 'zip' },
  { platform: 'macos', architecture: 'arm64', format: 'zip' },
  { platform: 'macos', architecture: 'x64', format: 'zip' },
  { platform: 'linux', architecture: 'x64', format: 'AppImage' },
] as const

export function getDesktopDownloads(version: string, base: string): DesktopDownload[] {
  const os = { windows: 'win', macos: 'mac', linux: 'linux' }
  const prefix = `Arcadia-Eternity-${version.replaceAll('+', '-')}`
  return targets.map(target => ({
    ...target,
    url: `${base}/${prefix}-${os[target.platform]}-${target.architecture}.${target.format}`,
  }))
}
