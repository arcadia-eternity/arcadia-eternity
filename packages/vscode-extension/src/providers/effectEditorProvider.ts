import * as vscode from 'vscode'
import { VIEW_TYPES } from '../shared/constants'
import { createEditableTextWebviewHtml } from './webviewTemplate'

async function writeFullDocumentText(document: vscode.TextDocument, content: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit()
  const lastLine = document.lineAt(document.lineCount - 1)
  const fullRange = new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length)
  edit.replace(document.uri, fullRange, content)
  await vscode.workspace.applyEdit(edit)
  await document.save()
}

export class EffectEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = VIEW_TYPES.effectEditor

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new EffectEditorProvider(context)
    return vscode.window.registerCustomEditorProvider(EffectEditorProvider.viewType, provider)
  }

  constructor(private readonly context: vscode.ExtensionContext) {
    void this.context
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
    }

    const updateWebview = () => {
      if (!webviewPanel.webview.html) {
        webviewPanel.webview.html = createEditableTextWebviewHtml({
          title: 'Arcadia Effect Editor',
          subtitle: vscode.workspace.asRelativePath(document.uri),
          initialText: document.getText(),
          saveCommandLabel: 'Save Effect',
        })
        return
      }

      webviewPanel.webview.postMessage({
        type: 'update',
        content: document.getText(),
      })
    }

    const documentListener = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() !== document.uri.toString()) return
      updateWebview()
    })

    webviewPanel.onDidDispose(() => {
      documentListener.dispose()
    })

    webviewPanel.webview.onDidReceiveMessage(async message => {
      if (message?.type !== 'save') return

      try {
        await writeFullDocumentText(document, String(message.content ?? ''))
        void vscode.window.showInformationMessage('Effect saved')
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        void vscode.window.showErrorMessage(`Failed to save effect: ${detail}`)
      }
    })

    updateWebview()
  }
}
