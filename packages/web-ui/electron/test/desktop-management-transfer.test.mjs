import { test } from 'node:test'
import assert from 'node:assert/strict'
import { managementRequest } from '../desktop-management.mjs'

test('only workspace import IPC accepts a large transfer body', () => {
  const body = { archive: 'a'.repeat(2 * 1024 * 1024) }
  for (const path of ['/workspaces/local/import', '/api/management/v1/workspaces/local/import'])
    assert.deepEqual(managementRequest({ method: 'POST', path, body }).body, body)
  for (const path of ['/operations', '/workspaces/local/import/extra', '/workspaces/local/prepare'])
    assert.throws(() => managementRequest({ method: 'POST', path, body }), /管理请求过大/)
  assert.throws(() => managementRequest({ method: 'PATCH', path: '/workspaces/local/import', body }), /管理请求过大/)
})
