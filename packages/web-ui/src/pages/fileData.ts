import { DATA_SCHEMA_MAP, SCHEMA_MAP } from '@test-battle/schema'
export type FileData<T> = {
  metadata: {
    metaType: keyof typeof DATA_SCHEMA_MAP
    version: string
  }
  preservedComments: string[]
  data: T[]
}

export type ErrorDetail = {
  path: string
  code: string
  message: string
}
