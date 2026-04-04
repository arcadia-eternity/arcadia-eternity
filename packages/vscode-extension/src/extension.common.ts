import * as vscode from 'vscode'
import { openBattleSandboxPanel } from './providers/battleSandboxPanel'
import { EffectEditorProvider } from './providers/effectEditorProvider'
import { FormEditorProvider } from './providers/formEditorProvider'
import { createCapabilities, describeCapabilities } from './shared/capabilities'
import { COMMANDS } from './shared/constants'
import { buildQuickOpenItems, openUriInEditor } from './shared/workspaceFiles'
import type { ArcadiaHostRuntime } from './shared/types'

let extensionDisposables: vscode.Disposable[] = []

async function runQuickOpen(): Promise<void> {
  const items = await buildQuickOpenItems()
  if (items.length === 0) {
    void vscode.window.showInformationMessage('No pack files found in current workspace')
    return
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Arcadia Pack Files',
    placeHolder: 'Type to search files, then press Enter to open',
    matchOnDescription: true,
    matchOnDetail: true,
  })

  if (!picked) return
  await openUriInEditor(picked.uriString)
}

function registerWorkspaceWatchers(): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher('**/{pack.json,*.yaml,*.yml,*.json}')

  const onCreate = watcher.onDidCreate(uri => {
    void vscode.window.setStatusBarMessage(`Arcadia: file created ${vscode.workspace.asRelativePath(uri)}`, 2000)
  })
  const onDelete = watcher.onDidDelete(uri => {
    void vscode.window.setStatusBarMessage(`Arcadia: file deleted ${vscode.workspace.asRelativePath(uri)}`, 2000)
  })
  const onChange = watcher.onDidChange(() => {
    // Keep a lightweight heartbeat for future indexer integration.
  })

  return vscode.Disposable.from(watcher, onCreate, onDelete, onChange)
}

export async function activateArcadiaEditor(
  context: vscode.ExtensionContext,
  runtime: ArcadiaHostRuntime,
): Promise<void> {
  const capabilities = createCapabilities(runtime)

  const showCapsCommand = vscode.commands.registerCommand(COMMANDS.showEnvironmentCapabilities, () => {
    void vscode.window.showInformationMessage(`Arcadia Editor: ${describeCapabilities(capabilities)}`)
  })

  const quickOpenCommand = vscode.commands.registerCommand(COMMANDS.quickOpenPackFile, async () => {
    await runQuickOpen()
  })

  const battleSandboxCommand = vscode.commands.registerCommand(COMMANDS.openBattleSandbox, () => {
    openBattleSandboxPanel(context)
  })

  const effectEditor = EffectEditorProvider.register(context)
  const formEditor = FormEditorProvider.register(context)
  const workspaceWatcher = registerWorkspaceWatchers()

  extensionDisposables = [
    showCapsCommand,
    quickOpenCommand,
    battleSandboxCommand,
    effectEditor,
    formEditor,
    workspaceWatcher,
  ]

  context.subscriptions.push(...extensionDisposables)

  void vscode.window.setStatusBarMessage(
    `Arcadia Editor ready (${capabilities.runtime})`,
    3500,
  )
}

export function deactivateArcadiaEditor(): void {
  for (const disposable of extensionDisposables) {
    disposable.dispose()
  }
  extensionDisposables = []
}
