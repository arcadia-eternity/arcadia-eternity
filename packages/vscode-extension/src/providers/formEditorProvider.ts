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

function inferFormKind(relativePath: string): string {
  const path = relativePath.toLowerCase()
  if (path.includes('species')) return 'Species Form'
  if (path.includes('skill')) return 'Skill Form'
  if (path.includes('mark')) return 'Mark Form'
  return 'Arcadia Form'
}

export class FormEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = VIEW_TYPES.formEditor

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new FormEditorProvider(context)
    return vscode.window.registerCustomEditorProvider(FormEditorProvider.viewType, provider)
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

    const relativePath = vscode.workspace.asRelativePath(document.uri)
    const formKind = inferFormKind(relativePath)

    const updateWebview = () => {
      if (!webviewPanel.webview.html) {
        webviewPanel.webview.html = createEditableTextWebviewHtml({
          title: formKind,
          subtitle: `${relativePath} (placeholder, replace with structured form UI)`,
          initialText: document.getText(),
          saveCommandLabel: 'Save Form',
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
        void vscode.window.showInformationMessage('Form data saved')
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        void vscode.window.showErrorMessage(`Failed to save form data: ${detail}`)
      }
    })

    updateWebview()
  }
}
