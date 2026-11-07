export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 2,
    readonly source?: string,
  ) {
    super(message)
  }
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
}
export function diagnostic(error: unknown) {
  return error instanceof CliError
    ? { code: error.code, message: error.message, ...(error.source ? { source: error.source } : {}) }
    : { code: 'RUNTIME_FAILED', message: message(error) }
}
