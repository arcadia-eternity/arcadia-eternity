import * as vscode from 'vscode'
import { PACK_FILE_GLOBS } from './constants'
import type { QuickOpenItem } from './types'

async function listWorkspaceFileUris(): Promise<vscode.Uri[]> {
  const all = await Promise.all(PACK_FILE_GLOBS.map(glob => vscode.workspace.findFiles(glob)))
  const merged = all.flat()
  const dedup = new Map<string, vscode.Uri>()
  for (const uri of merged) {
    dedup.set(uri.toString(), uri)
  }
  return [...dedup.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function toRelativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false)
}

export async function buildQuickOpenItems(): Promise<QuickOpenItem[]> {
  const uris = await listWorkspaceFileUris()
  return uris.map(uri => {
    const relativePath = toRelativePath(uri)
    const parts = relativePath.split('/')
    const label = parts.pop() ?? relativePath
    const description = parts.join('/') || '/'

    return {
      label,
      description,
      detail: relativePath,
      uriString: uri.toString(),
    }
  })
}

export async function openUriInEditor(uriString: string): Promise<void> {
  const uri = vscode.Uri.parse(uriString)
  const doc = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(doc, { preview: false })
}
