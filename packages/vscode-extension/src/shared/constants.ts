export const COMMANDS = {
  quickOpenPackFile: 'arcadiaEditor.quickOpenPackFile',
  openBattleSandbox: 'arcadiaEditor.openBattleSandbox',
  showEnvironmentCapabilities: 'arcadiaEditor.showEnvironmentCapabilities',
} as const

export const VIEW_TYPES = {
  effectEditor: 'arcadia.effectEditor',
  formEditor: 'arcadia.formEditor',
} as const

export const CONFIG = {
  section: 'arcadiaEditor',
  battleSandboxUrl: 'battleSandboxUrl',
} as const

export const PACK_FILE_GLOBS = [
  '**/pack.json',
  '**/*.yaml',
  '**/*.yml',
  '**/*.json',
] as const
