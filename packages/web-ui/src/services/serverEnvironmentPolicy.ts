import type { ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'

/** Older descriptors represent the existing server-authoritative path. Admission is still enforced by the server. */
export function allowsServerExecution(environment: Pick<ServerEnvironmentDescriptor, 'executionPolicy'>): boolean {
  return environment.executionPolicy === undefined || environment.executionPolicy === 'server'
}

export function requireServerExecution(environment: Pick<ServerEnvironmentDescriptor, 'executionPolicy'>): void {
  if (!allowsServerExecution(environment)) throw new Error('此环境仅允许玩家主机运行，不能用于服务器对战')
}

export function allowsPeerExecution(environment: Pick<ServerEnvironmentDescriptor, 'peerRevision'>): boolean {
  return !!environment.peerRevision
}

export function roomEnvironmentLabel(environment: ServerEnvironmentDescriptor): string {
  return (
    environment.environmentName ||
    environment.packages.map(pack => `${pack.name} ${pack.version}`).join('、') ||
    '官方基础环境'
  )
}
