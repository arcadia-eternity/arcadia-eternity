import type * as vscode from 'vscode'
import { activateArcadiaEditor, deactivateArcadiaEditor } from './extension.common'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateArcadiaEditor(context, 'web')
}

export function deactivate(): void {
  deactivateArcadiaEditor()
}
