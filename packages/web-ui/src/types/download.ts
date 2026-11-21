export type Platform = 'windows' | 'macos' | 'linux'
export type Architecture = 'x64' | 'arm64'

export interface DesktopDownload {
  platform: Platform
  architecture: Architecture
  format: 'exe' | 'zip' | 'AppImage'
  url: string
}
