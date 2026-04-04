function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function createEditableTextWebviewHtml(options: {
  title: string
  subtitle: string
  initialText: string
  saveCommandLabel: string
}): string {
  const { title, subtitle, initialText, saveCommandLabel } = options

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: var(--vscode-font-family, ui-sans-serif); }
    .root { height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }
    header { padding: 10px 12px; border-bottom: 1px solid var(--vscode-editorWidget-border); }
    h1 { margin: 0; font-size: 13px; font-weight: 600; }
    p { margin: 4px 0 0; font-size: 12px; opacity: .85; }
    textarea {
      width: 100%;
      height: 100%;
      border: 0;
      margin: 0;
      padding: 12px;
      box-sizing: border-box;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font: 12px/1.5 var(--vscode-editor-font-family, ui-monospace, monospace);
      resize: none;
      outline: none;
    }
    footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-editorWidget-border);
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="root">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(subtitle)}</p>
    </header>
    <textarea id="editor">${escapeHtml(initialText)}</textarea>
    <footer>
      <button id="save">${escapeHtml(saveCommandLabel)}</button>
    </footer>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const editor = document.getElementById('editor');
    const saveButton = document.getElementById('save');

    saveButton.addEventListener('click', () => {
      vscode.postMessage({
        type: 'save',
        content: editor.value,
      });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message?.type === 'update') {
        const selectionStart = editor.selectionStart;
        const selectionEnd = editor.selectionEnd;
        editor.value = String(message.content ?? '');
        editor.selectionStart = selectionStart;
        editor.selectionEnd = selectionEnd;
      }
    });
  </script>
</body>
</html>`
}
