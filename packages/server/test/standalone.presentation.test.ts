import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSingleProcessApp } from '../src/standalone/app'
import { createNpmFixture } from './fixtures/npm'

it('publishes remote URLs without downloading and streams package files without cache, including HEAD and Range', async () => {
  const fixture = await createNpmFixture({ presentation: true })
  const app = createSingleProcessApp({ port: 0, host: '127.0.0.1', corsOrigins: [] })
  try {
    const first = await app.environments.prepareNpm(fixture.directory)
    await app.start()
    const base = `http://127.0.0.1:${app.address!.port}`
    expect(first.remoteResources).toEqual([
      {
        projectId: 'example-slow',
        id: 'animation',
        url: 'http://127.0.0.1:1/not-fetched.swf',
        mime: 'application/x-shockwave-flash',
      },
    ])
    const content = app.environments.content(first.id)
    expect(content.species.find(pet => pet.id === 'example-slow:pet')?.presentation?.battle?.renderer).toBe('seer2-swf')
    expect(content.locales?.bundles.en.species['example-slow:pet']).toEqual({ name: 'Display pet' })
    expect(content.locales?.defaultLocale).toBe('zh-CN')
    expect(content.locales?.bundles['zh-CN'].species.pet_dilan).toMatchObject({ name: '迪兰' })
    expect(content.locales?.bundles['zh-CN']).not.toHaveProperty('webui')
    expect(content.locales?.bundles['zh-CN']).not.toHaveProperty('battle')
    expect(content.species.find(pet => pet.id === 'pet_dilan')?.presentation?.battle?.source).toMatch(/^https:\/\//)
    expect(content.skills.every(skill => !Object.hasOwn(skill, 'effect'))).toBe(true)
    expect(content.marks.every(mark => !Object.hasOwn(mark, 'effect') && !Object.hasOwn(mark, 'config'))).toBe(true)
    const builtin = app.environments.list().find(entry => !entry.packages.length)!
    const official = app.environments.content(builtin.id)
    expect(official.locales?.bundles['zh-CN'].species.pet_dilan).toMatchObject({ name: '迪兰' })
    const resource = first.resources.find(asset => asset.id === 'icon')!
    const response = await fetch(`${base}${resource.url}`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('image/png')
    expect(response.headers.get('etag')).toBeNull()
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.asset)
    const head = await fetch(`${base}${resource.url}`, { method: 'HEAD' })
    expect(head.headers.get('content-length')).toBe(String(fixture.asset.length))
    expect(await head.text()).toBe('')
    const partial = await fetch(`${base}${resource.url}`, { headers: { Range: 'bytes=0-7' } })
    expect(partial.status).toBe(206)
    const outside = await fetch(`${base}${resource.url}`, { headers: { Range: 'bytes=999999-' } })
    expect(outside.status).toBe(416)
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(fixture.asset.subarray(0, 8))
    expect((await fetch(`${base}/api/v1/environments/${first.id}/resources`)).headers.get('cache-control')).toBe(
      'no-store',
    )
    await writeFile(join(fixture.installedDirectory, 'assets/icon.png'), Buffer.from('changed'))
    // The fixed npm environment still owns its original package file; no resource cache is involved.
    expect(Buffer.from(await (await fetch(`${base}${resource.url}`)).arrayBuffer())).toEqual(fixture.asset)
    await expect(app.environments.prepareNpm(fixture.directory)).rejects.toThrow('RESOURCE_INTEGRITY')
    expect(app.environments.descriptor(first.id).id).toBe(first.id)
  } finally {
    await app.stop()
    await fixture.dispose()
  }
}, 30_000)
