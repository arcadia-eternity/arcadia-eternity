import { authorCall } from './types'

export interface TerminalCommands {
  shell: 'posix' | 'powershell'
  commandPaths: { arcadia?: string; 'arcadia-content': string }
}

export function readTerminalCommands() {
  return authorCall<TerminalCommands>({ action: 'terminal-command-paths' })
}

export function shellCommand(path: string, shell: TerminalCommands['shell']) {
  return shell === 'powershell' ? "& '" + path.replaceAll("'", "''") + "'" : "'" + path.replaceAll("'", "'\\''") + "'"
}
