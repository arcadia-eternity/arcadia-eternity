export type ManagementMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface ManagementIpcRequest {
  method: ManagementMethod
  path: string
  body?: unknown
  headers?: Record<string, string>
}

export interface ManagementIpcResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export type ManagementIpcBridge = (request: ManagementIpcRequest) => Promise<ManagementIpcResponse>
