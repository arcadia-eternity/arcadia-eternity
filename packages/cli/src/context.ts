export interface CommandContext {
  cwd: string
  signal: AbortSignal
  stdout(text: string): Promise<void>
  stderr(text: string): Promise<void>
}
