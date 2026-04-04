import * as vscode from 'vscode'
import { CONFIG } from '../shared/constants'

function resolveSandboxUrl(): string {
  const config = vscode.workspace.getConfiguration(CONFIG.section)
  const configured = config.get<string>(CONFIG.battleSandboxUrl)
  if (configured && configured.trim().length > 0) {
    return configured.trim()
  }
  return 'http://127.0.0.1:4174/#/local-battle'
}

function renderBattleSandboxHtml(url: string): string {
  const safeUrl = url.replace(/\"/g, '&quot;')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root { color-scheme: light dark; }
    html, body { margin: 0; height: 100%; overflow: hidden; }
    body { font-family: var(--vscode-font-family, ui-sans-serif); }
    .root { height: 100%; display: grid; grid-template-rows: auto 1fr; }
    .toolbar { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--vscode-editorWidget-border); }
    .url { flex: 1; min-width: 0; font-size: 12px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    iframe { border: 0; width: 100%; height: 100%; background: #fff; }
  </style>
</head>
<body>
  <div class="root">
    <div class="toolbar">
      <div class="url">${safeUrl}</div>
      <button id="reload">Reload</button>
      <button id="openExternal">Open External</button>
    </div>
    <iframe id="sandbox" src="${safeUrl}" allow="clipboard-read; clipboard-write"></iframe>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const iframe = document.getElementById('sandbox');

    document.getElementById('reload').addEventListener('click', () => {
      iframe.src = iframe.src;
    });

    document.getElementById('openExternal').addEventListener('click', () => {
      vscode.postMessage({ type: 'openExternal' });
    });
  </script>
</body>
</html>`
}

export function openBattleSandboxPanel(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'arcadiaBattleSandbox',
    'Arcadia Battle Sandbox',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  )

  const url = resolveSandboxUrl()
  panel.webview.html = renderBattleSandboxHtml(url)

  const listener = panel.webview.onDidReceiveMessage(async message => {
    if (message?.type !== 'openExternal') return
    await vscode.env.openExternal(vscode.Uri.parse(url))
  })

  panel.onDidDispose(() => {
    listener.dispose()
  })

  context.subscriptions.push(panel)
}
