import { describe, expect, it, vi, afterEach } from 'vitest'
import { PackLoader } from '../src/loader'

describe('PackLoader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads builtin base pack via node-fs source', async () => {
    const loader = new PackLoader()
    const result = await loader.load('builtin:base', { source: 'node-fs', validateReferences: true })
    const summary = loader.summarize(result)

    expect(summary.effectCount).toBeGreaterThan(0)
    expect(summary.markCount).toBeGreaterThan(0)
    expect(summary.skillCount).toBeGreaterThan(0)
    expect(summary.speciesCount).toBeGreaterThan(0)
    expect(summary.packId).toBe('arcadia-eternity.base')
    expect(summary.lockfileIssueCount).toBe(0)
  })

  it('loads pack from http source', async () => {
    const base = 'https://example.com/packs/demo'
    const files: Record<string, string> = {
      [`${base}/pack.json`]: JSON.stringify({
        id: 'demo.pack',
        version: '1.0.0',
        engine: 'seer2-v2',
        data: {
          effects: ['effect.yaml'],
          marks: ['mark.yaml'],
          skills: ['skill.yaml'],
          species: ['species.yaml'],
        },
      }),
      [`${base}/pack-lock.yaml`]: `lockfileVersion: 1
generatedAt: '2026-03-10T12:00:00.000Z'
importers:
  .:
    specifiers:
      demo.pack: https://example.com/packs/demo/pack.json
    dependencies:
      demo.pack:
        specifier: https://example.com/packs/demo/pack.json
        version: 1.0.0
        packageKey: /demo.pack@1.0.0
packages:
  /demo.pack@1.0.0:
    name: demo.pack
    version: 1.0.0
    kind: data
    engine: seer2-v2
    source: https://example.com/packs/demo/pack.json
    entry: pack.json
    provenance: http
`,
      [`${base}/effect.yaml`]: `- id: effect_demo
  trigger: OnDamage
  priority: 0
  apply:
    type: addPower
    target: useSkillContext
    value: 1
`,
      [`${base}/mark.yaml`]: `- id: mark_demo
  effect:
    - effect_demo
`,
      [`${base}/skill.yaml`]: `- id: skill_demo
  element: Water
  category: Special
  target: opponent
  power: 50
  rage: 0
  accuracy: 100
  effect:
    - effect_demo
`,
      [`${base}/species.yaml`]: `- id: pet_demo
  num: 1
  element: Water
  baseStats:
    hp: 100
    atk: 80
    def: 80
    spa: 80
    spd: 80
    spe: 80
`,
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const key = String(input)
        const body = files[key]
        if (body === undefined) {
          return new Response('not found', { status: 404 })
        }
        return new Response(body, { status: 200 })
      }),
    )

    const loader = new PackLoader()
    const result = await loader.load(base, { source: 'http' })
    const summary = loader.summarize(result)

    expect(summary.packId).toBe('demo.pack')
    expect(summary.effectCount).toBe(1)
    expect(summary.markCount).toBe(1)
    expect(summary.skillCount).toBe(1)
    expect(summary.speciesCount).toBe(1)
    expect(summary.hasLockfile).toBe(true)
    expect(summary.lockfileIssueCount).toBe(0)
    expect(result.lockfile?.lockfileVersion).toBe(1)
    expect(result.lockfileIssues).toEqual([])
    expect(result.errors).toHaveLength(0)
  })

  it('fails http load when lockfile mismatches in enforce mode', async () => {
    const base = 'https://example.com/packs/bad'
    const files: Record<string, string> = {
      [`${base}/pack.json`]: JSON.stringify({
        id: 'bad.pack',
        version: '1.0.0',
        engine: 'seer2-v2',
        data: {
          effects: [],
          marks: [],
          skills: [],
          species: [],
        },
      }),
      [`${base}/pack-lock.yaml`]: `lockfileVersion: 1
generatedAt: '2026-03-10T12:00:00.000Z'
importers:
  .:
    dependencies:
      bad.pack:
        specifier: https://example.com/packs/bad/pack.json
        version: 9.9.9
        packageKey: /bad.pack@9.9.9
packages:
  /bad.pack@9.9.9:
    name: bad.pack
    version: 9.9.9
    kind: data
    engine: seer2-v2
    source: https://example.com/packs/bad/pack.json
    entry: pack.json
    provenance: http
`,
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const key = String(input)
        const body = files[key]
        if (body === undefined) {
          return new Response('not found', { status: 404 })
        }
        return new Response(body, { status: 200 })
      }),
    )

    const loader = new PackLoader()
    await expect(
      loader.load(base, { source: 'http', enforceLockfile: true }),
    ).rejects.toThrow(/Pack lockfile validation failed/)
  })
})
