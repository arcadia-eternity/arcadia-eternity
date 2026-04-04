import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import 'monaco-editor/min/vs/editor/editor.main.css'

type MonacoEnvironment = {
  getWorker: (_moduleId: string | undefined, label: string) => Worker
}

declare global {
  interface Window {
    MonacoEnvironment?: MonacoEnvironment
  }
}

function createWorker(label: string): Worker {
  if (label === 'json') return new jsonWorker()
  if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
  if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
  if (label === 'typescript' || label === 'javascript') return new tsWorker()
  return new editorWorker()
}

if (typeof window !== 'undefined' && !window.MonacoEnvironment) {
  window.MonacoEnvironment = {
    getWorker: (_moduleId, label) => createWorker(label),
  }
}

export { monaco }
