import type { ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'

/** Older descriptors represent the existing server-authoritative path. Admission is still enforced by the server. */
export function allowsServerExecution(environment: Pick<ServerEnvironmentDescriptor, 'executionPolicy'>): boolean {
  return environment.executionPolicy === undefined || environment.executionPolicy === 'server'
}

export function requireServerExecution(environment: Pick<ServerEnvironmentDescriptor, 'executionPolicy'>): void {
  if (!allowsServerExecution(environment)) throw new Error('此环境仅允许玩家主机运行，不能用于服务器对战')
}
