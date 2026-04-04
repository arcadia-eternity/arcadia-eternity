import * as vscode from 'vscode'
import type { ArcadiaEditorCapabilities, ArcadiaHostRuntime } from './types'

export function createCapabilities(runtime: ArcadiaHostRuntime): ArcadiaEditorCapabilities {
  const supportsBrowserFsAccess = runtime === 'web'
  return {
    runtime,
    supportsNodeFs: runtime === 'node',
    supportsBrowserFsAccess,
    supportsWorkers: true,
  }
}

export function describeCapabilities(capabilities: ArcadiaEditorCapabilities): string {
  return [
    `runtime=${capabilities.runtime}`,
    `nodeFs=${capabilities.supportsNodeFs}`,
    `browserFsAccess=${capabilities.supportsBrowserFsAccess}`,
    `workers=${capabilities.supportsWorkers}`,
    `workspaceFolders=${vscode.workspace.workspaceFolders?.length ?? 0}`,
  ].join(' | ')
}
